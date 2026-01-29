import { EC2Client, DescribeRegionsCommand } from "@aws-sdk/client-ec2";
import { fromIni } from "@aws-sdk/credential-providers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "../utils/index.js";
import type { Profile, Resource, SSOSession, CollectTask } from "../entities/index.js";
import { getAliyunProfiles, createAliyunConfig } from "./aliyun-credentials.js";
import { convertAWSResourceExplorerRaw, countAWSResources, type ResourceCount } from "./aws-resource-explorer.js";
import { parseAWSSSOSessions } from "./aws-sso.js";

export interface ProfileAdapter {
  discoverProfiles(cloud: "aws" | "aliyun"): Promise<Profile[]>;
  discoverSSOSessions(): Promise<SSOSession[]>;
  validateSSOSession(session: SSOSession): Promise<boolean>;
  getAvailableRegions(profile: Profile, type: string): Promise<string[]>;
  getAccountId(profile: Profile): Promise<string>;
  collectRaw(task: CollectTask): Promise<any[]>;
  convertRaw(raw: any[], task: CollectTask): Resource[];
  countResources(task: CollectTask): Promise<ResourceCount[]>;
}

export function extractProject(tags: Record<string, string>): string {
  const project = tags["project"] || tags["Project"];
  if (project) return project;
  for (const key of Object.keys(tags)) {
    if (key.toLowerCase().includes("project")) return tags[key];
  }
  return "";
}

function tagsArrayToObject(tagList: any[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const t of tagList || []) {
    const key = t.key || t.tagKey || t.Key;
    const value = t.value || t.tagValue || t.Value;
    if (key && value) tags[key] = value;
  }
  return tags;
}

export class SDKProfileAdapter implements ProfileAdapter {
  async discoverProfiles(cloud: "aws" | "aliyun"): Promise<Profile[]> {
    log.debug(` Discovering ${cloud} profiles...`);
    try {
      return cloud === "aws" ? this.discoverAWSProfiles() : this.discoverAliyunProfiles();
    } catch (e) { log.debug(` Profile discovery error:`, e); return []; }
  }

  async discoverSSOSessions(): Promise<SSOSession[]> {
    return parseAWSSSOSessions().map(s => ({ ...s, isValid: true }));
  }

  async validateSSOSession(session: SSOSession): Promise<boolean> {
    const cachePath = path.join(os.homedir(), ".aws", "sso", "cache");
    if (!fs.existsSync(cachePath)) return false;
    try {
      for (const file of fs.readdirSync(cachePath).filter(f => f.endsWith(".json"))) {
        const c = JSON.parse(fs.readFileSync(path.join(cachePath, file), "utf-8"));
        if (c.startUrl === session.startUrl && c.expiresAt && new Date(c.expiresAt) > new Date()) return true;
      }
    } catch {}
    return false;
  }

  async getAvailableRegions(profile: Profile, _type: string): Promise<string[]> {
    return profile.cloud === "aws" ? this.getAWSRegions(profile.name) : this.getAliyunRegions(profile.name);
  }

  async getAccountId(profile: Profile): Promise<string> {
    if (profile.accountId) return profile.accountId;
    try {
      if (profile.cloud === "aws") {
        const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
        const client = new STSClient({ credentials: fromIni({ profile: profile.name }), region: "us-east-1" });
        return (await client.send(new GetCallerIdentityCommand({}))).Account || "";
      }
      const config = await createAliyunConfig(profile.name, "cn-hangzhou");
      if (!config) return "";
      const stsModule = await import("@alicloud/sts20150401");
      const STS = (stsModule.default as any).default || stsModule.default;
      return (await new STS(config).getCallerIdentity({})).body?.accountId || "";
    } catch { return ""; }
  }

  async collectRaw(task: CollectTask): Promise<any[]> {
    const { profile, type, region, resourceDirectoryId, viewArn } = task;
    if (profile.cloud === "aws") return this.collectAWSRaw(profile.name, type, region, profile.accountId, viewArn);
    return this.collectAliyunRaw(profile.name, type, region, resourceDirectoryId);
  }

  convertRaw(raw: any[], task: CollectTask): Resource[] {
    const { profile, type, region } = task;
    if (profile.cloud === "aws") return this.convertAWSRaw(raw, profile.name, type, region);
    return this.convertAliyunRaw(raw, profile.name, type);
  }

  async countResources(task: CollectTask): Promise<ResourceCount[]> {
    const { profile, type, region, viewArn } = task;
    if (profile.cloud === "aws") {
      return countAWSResources(profile.name, type, region, profile.accountId, viewArn);
    }
    // 阿里云暂不支持计数，返回空数组
    return [];
  }

  private discoverAWSProfiles(): Profile[] {
    const configPath = path.join(os.homedir(), ".aws", "config");
    const credPath = path.join(os.homedir(), ".aws", "credentials");
    const configContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
    const credContent = fs.existsSync(credPath) ? fs.readFileSync(credPath, "utf-8") : "";
    const profiles: Profile[] = [];
    const names = new Set<string>();
    for (const c of [configContent, credContent]) {
      for (const m of c.matchAll(/\[(?:profile\s+)?([^\]]+)\]/g)) {
        if (!m[1].startsWith("sso-session")) names.add(m[1]);
      }
    }
    for (const name of names) profiles.push({ name, cloud: "aws" as const, isValid: true });
    for (const session of parseAWSSSOSessions()) {
      if (!names.has(session.name)) {
        profiles.push({
          name: session.name, cloud: "aws" as const, isValid: true,
          ssoSession: { name: session.name, startUrl: session.startUrl, region: session.region, isValid: true },
        });
      }
    }
    return profiles;
  }

  private discoverAliyunProfiles(): Profile[] {
    return getAliyunProfiles().filter(p => p.name).map(p => ({
      name: p.name, cloud: "aliyun" as const, isValid: true,
      cloudSSOSession: p.mode === "CloudSSO" ? { profileName: p.name, isValid: true } : undefined,
    }));
  }

  private async getAWSRegions(profileName: string): Promise<string[]> {
    try {
      const client = new EC2Client({ credentials: fromIni({ profile: profileName }), region: "us-east-1" });
      const resp = await client.send(new DescribeRegionsCommand({}));
      return resp.Regions?.map(r => r.RegionName!).filter(Boolean) || [];
    } catch { return ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1"]; }
  }

  private async getAliyunRegions(profileName: string): Promise<string[]> {
    try {
      const config = await createAliyunConfig(profileName, "cn-hangzhou");
      if (!config) return ["cn-hangzhou", "cn-shanghai", "cn-beijing", "cn-shenzhen"];
      const ecsModule = await import("@alicloud/ecs20140526");
      const ECS = (ecsModule.default as any).default || ecsModule.default;
      const resp = await new ECS(config).describeRegions(new ecsModule.DescribeRegionsRequest({}));
      return resp.body?.regions?.region?.map((r: any) => r.regionId!) || [];
    } catch { return ["cn-hangzhou", "cn-shanghai", "cn-beijing", "cn-shenzhen"]; }
  }

  private async collectAliyunRaw(profile: string, type: string, region: string, rdId?: string): Promise<any[]> {
    const { collectAliyunResourcesByCenter, collectMultiAccountResourcesByCenter } = await import("./aliyun-resource-center.js");
    return rdId ? collectMultiAccountResourcesByCenter(profile, type, region, rdId) : collectAliyunResourcesByCenter(profile, type, region);
  }

  private convertAliyunRaw(raw: any[], profile: string, type: string): Resource[] {
    return raw.map(item => ({
      cloud: "aliyun" as const, profile, accountId: item.accountId, type,
      id: item.resourceId || "", name: item.resourceName || item.resourceId || "",
      region: item.regionId || "global", project: extractProject(tagsArrayToObject(item.tags)),
      tags: tagsArrayToObject(item.tags), status: item.status, collectedAt: new Date(),
      createdAt: item.createTime || undefined,
    }));
  }

  private async collectAWSRaw(profile: string, type: string, region: string, accountId?: string, viewArn?: string): Promise<any[]> {
    const { collectAWSResourcesByExplorer } = await import("./aws-resource-explorer.js");
    return collectAWSResourcesByExplorer(profile, type, region, accountId, viewArn);
  }

  private convertAWSRaw(raw: any[], profile: string, type: string, region: string): Resource[] {
    return convertAWSResourceExplorerRaw(raw, profile, type, region) as Resource[];
  }
}
