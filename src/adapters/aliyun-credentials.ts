import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import * as CredentialModule from "@alicloud/credentials";
import { Config as OpenApiConfig } from "@alicloud/openapi-client";
import { log } from "../utils/index.js";

const Credential = (CredentialModule.default as any).default || CredentialModule.default;
const CredentialConfig = (CredentialModule as any).Config;

function sanitizeProfileName(name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`无效的 profile 名称: ${name}`);
  return name;
}

interface AliyunProfile {
  name: string;
  mode?: string;
  access_key_id?: string;
  access_key_secret?: string;
  sts_token?: string;
}

interface CloudSSOCredential {
  access_key_id: string;
  access_key_secret: string;
  sts_token: string;
  sts_expiration?: number;
}

export function getAliyunProfiles(): AliyunProfile[] {
  const configPath = path.join(os.homedir(), ".aliyun", "config.json");
  if (!fs.existsSync(configPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")).profiles || [];
  } catch { return []; }
}

function getCloudSSOCredential(profileName: string): CloudSSOCredential | null {
  try {
    const safeName = sanitizeProfileName(profileName);
    const config = JSON.parse(execSync(`aliyun configure get --profile ${safeName}`, { encoding: "utf-8", timeout: 10000 }));
    if (config.mode === "CloudSSO" && config.access_key_id && config.access_key_secret && config.sts_token) {
      log.debug(` CloudSSO credential found for ${profileName}`);
      return {
        access_key_id: config.access_key_id,
        access_key_secret: config.access_key_secret,
        sts_token: config.sts_token,
        sts_expiration: config.sts_expiration,
      };
    }
    return null;
  } catch (e) {
    log.debug(` Failed to get CloudSSO credential for ${profileName}:`, e);
    return null;
  }
}

export interface CredentialValidation {
  profile: string;
  valid: boolean;
  expiredAt?: Date;
  refreshCommand?: string;
}

export function validateAliyunCredential(profileName: string): CredentialValidation {
  const result: CredentialValidation = { profile: profileName, valid: false };
  try {
    const safeName = sanitizeProfileName(profileName);
    const config = JSON.parse(execSync(`aliyun configure get --profile ${safeName}`, { encoding: "utf-8", timeout: 10000 }));
    if (config.mode === "CloudSSO") {
      if (!config.access_key_id || !config.sts_token) {
        result.refreshCommand = `aliyun configure --mode CloudSSO --profile ${profileName}`;
        return result;
      }
      if (config.sts_expiration) {
        const expiredAt = new Date(config.sts_expiration * 1000);
        result.expiredAt = expiredAt;
        if (expiredAt < new Date()) {
          result.refreshCommand = `aliyun configure --mode CloudSSO --profile ${profileName}`;
          return result;
        }
      }
    }
    result.valid = true;
  } catch {
    result.refreshCommand = `aliyun configure --mode CloudSSO --profile ${profileName}`;
  }
  return result;
}

export async function createAliyunConfig(profileName: string, regionId: string): Promise<OpenApiConfig | null> {
  try {
    const ssoCredential = getCloudSSOCredential(profileName);
    if (ssoCredential) {
      const credential = new Credential(new CredentialConfig({
        type: "sts",
        accessKeyId: ssoCredential.access_key_id,
        accessKeySecret: ssoCredential.access_key_secret,
        securityToken: ssoCredential.sts_token,
      }));
      return new OpenApiConfig({ credential, regionId });
    }
    process.env.ALIBABA_CLOUD_PROFILE = profileName;
    return new OpenApiConfig({ credential: new Credential(), regionId });
  } catch (e) {
    log.debug(` Failed to create credential for ${profileName}:`, e);
    return null;
  }
}
