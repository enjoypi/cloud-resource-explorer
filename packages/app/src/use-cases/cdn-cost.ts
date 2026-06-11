import type { Config, Profile, ProviderConfig, CdnCostRecord, CdnCostError } from "../entities/index.js";
import { ACCOUNT_TOTAL_DOMAIN } from "../entities/index.js";
import type { ProfileAdapter } from "../adapters/profile-adapter.js";
import type { CacheAdapter } from "../adapters/cache-adapter.js";
import { filterProfiles } from "./collect.js";
import { log } from "../utils/index.js";

export interface CdnUsageRow { month: string; trafficGB: number; requests: number; }
export interface CdnCostRow { month: string; accountId: string; cost: number; currency: string; }
export interface CdnDistribution { id: string; domain: string; }
export interface CdnBillRow {
  month: string; accountId: string; domain: string; product: string;
  trafficGB: number | null; requests: number | null; cost: number; currency: string;
}

export interface AwsCdnCostPort {
  listAccountIds(profile: Profile, viewArn?: string): Promise<string[]>;
  listDistributions(profileName: string, accountId: string): Promise<CdnDistribution[]>;
  getDistributionMonthlyUsage(profileName: string, accountId: string, distributionId: string, months: string[]): Promise<CdnUsageRow[]>;
  getMonthlyCostByAccount(profileName: string, accountId: string, months: string[]): Promise<CdnCostRow[]>;
}

export interface AliyunCdnCostPort {
  listRdAccountIds(profileName: string): Promise<string[]>;
  getMonthlyBill(profileName: string, billOwnerId: string | undefined, month: string, bssEndpoint: string): Promise<CdnBillRow[]>;
}

export interface CdnCostInput {
  config: Config;
  profileAdapter: ProfileAdapter;
  cacheAdapter: CacheAdapter;
  aws: AwsCdnCostPort;
  aliyun: AliyunCdnCostPort;
  now?: Date;
}
export interface CdnCostOutput { records: CdnCostRecord[]; errors: CdnCostError[]; }

const CACHE_TYPE = "cdncost";

/** UTC 账期：最近 N 个完整月 + 本月（至今），升序 */
export function monthsToCollect(completeMonths: number, now: Date): string[] {
  const months: string[] = [];
  for (let i = completeMonths; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export function filterAccountIds(accountIds: string[], providerConfig: ProviderConfig): string[] {
  let result = accountIds;
  if (providerConfig.accounts.length > 0) result = result.filter(id => providerConfig.accounts.includes(id));
  if (providerConfig.excludeAccounts.length > 0) result = result.filter(id => !providerConfig.excludeAccounts.includes(id));
  return result;
}

export async function collectCdnCost(input: CdnCostInput): Promise<CdnCostOutput> {
  const { config, profileAdapter, cacheAdapter, aws, aliyun } = input;
  const now = input.now ?? new Date();
  const months = monthsToCollect(config.cdnCost.months, now);
  // 缓存键带账期数，调整 months 配置后不会误用旧缓存
  const cacheRegion = `m${months.length}`;
  log.debug("开始 CDN 用量费用采集", { feature: "cdn-cost", action: "start", months });

  const clouds: ("aws" | "aliyun")[] = config.cloud === "all" ? ["aws", "aliyun"] : [config.cloud];
  let profiles: Profile[] = [];
  for (const cloud of clouds) profiles.push(...await profileAdapter.discoverProfiles(cloud));
  profiles = filterProfiles(profiles, config).filter(p => p.isValid);

  const records: CdnCostRecord[] = [];
  const errors: CdnCostError[] = [];
  for (const profile of profiles) {
    if (!config.forceRefresh && cacheAdapter.isValid(profile.name, CACHE_TYPE, cacheRegion, config.cacheTtl)) {
      const cached = cacheAdapter.getRaw(profile.name, CACHE_TYPE, cacheRegion);
      if (cached) { records.push(...cached as CdnCostRecord[]); continue; }
    }
    if (!profile.accountId) {
      try { profile.accountId = await profileAdapter.getAccountId(profile); }
      catch (e) { log.debug("获取账号 ID 失败", { feature: "cdn-cost", profile: profile.name, error: String(e) }); }
    }
    const profileRecords = profile.cloud === "aws"
      ? await collectAwsProfile(profile, config, months, aws, errors, now)
      : await collectAliyunProfile(profile, config, months, aliyun, errors, now);
    cacheAdapter.setRaw(profile.name, CACHE_TYPE, cacheRegion, profileRecords);
    records.push(...profileRecords);
  }
  log.debug("CDN 用量费用采集完成", { feature: "cdn-cost", action: "done", records: records.length, errors: errors.length });
  return { records, errors };
}

async function collectAwsProfile(
  profile: Profile, config: Config, months: string[],
  aws: AwsCdnCostPort, errors: CdnCostError[], now: Date,
): Promise<CdnCostRecord[]> {
  const records: CdnCostRecord[] = [];
  const collectedAt = now.toISOString();
  const base = { cloud: "aws" as const, profile: profile.name, product: "CloudFront", collectedAt };

  let accountIds: string[] = [];
  try {
    accountIds = filterAccountIds(await aws.listAccountIds(profile, config.aws.resourceExplorerViewArn), config.aws);
  } catch (e) {
    errors.push({ cloud: "aws", profile: profile.name, scope: "accounts", message: String(e) });
  }

  // 费用：CloudFront 在 Cost Explorer 只有账号级粒度，从聚合账号一次查全组织
  const ceAccountId = config.aws.resourceExplorerViewArn?.split(":")[4] || profile.accountId || accountIds[0] || "";
  try {
    const costRows = await aws.getMonthlyCostByAccount(profile.name, ceAccountId, months);
    for (const row of costRows) {
      if (filterAccountIds([row.accountId], config.aws).length === 0) continue;
      records.push({ ...base, accountId: row.accountId, month: row.month, domain: ACCOUNT_TOTAL_DOMAIN, trafficGB: null, requests: null, cost: row.cost, currency: row.currency });
    }
  } catch (e) {
    errors.push({ cloud: "aws", profile: profile.name, scope: "cost-explorer", message: String(e) });
  }

  // 用量：逐账号列出 Distribution，从 CloudWatch 取流量与请求数
  for (const accountId of accountIds) {
    try {
      for (const dist of await aws.listDistributions(profile.name, accountId)) {
        const usage = await aws.getDistributionMonthlyUsage(profile.name, accountId, dist.id, months);
        for (const u of usage) {
          records.push({ ...base, accountId, month: u.month, domain: dist.domain, trafficGB: u.trafficGB, requests: u.requests, cost: null, currency: "" });
        }
      }
    } catch (e) {
      errors.push({ cloud: "aws", profile: profile.name, scope: accountId, message: String(e) });
    }
  }
  return records;
}

async function collectAliyunProfile(
  profile: Profile, config: Config, months: string[],
  aliyun: AliyunCdnCostPort, errors: CdnCostError[], now: Date,
): Promise<CdnCostRecord[]> {
  const records: CdnCostRecord[] = [];
  const collectedAt = now.toISOString();

  let rdAccountIds: string[] = [];
  try { rdAccountIds = await aliyun.listRdAccountIds(profile.name); }
  catch (e) { log.debug("资源目录账号获取失败", { feature: "cdn-cost", profile: profile.name, error: String(e) }); }

  // 管理账号代查成员账单（BillOwnerId）；非管理账号查自身（undefined）
  const owners: (string | undefined)[] = rdAccountIds.length > 0
    ? filterAccountIds(rdAccountIds, config.aliyun)
    : [undefined];

  for (const owner of owners) {
    for (const month of months) {
      try {
        const rows = await aliyun.getMonthlyBill(profile.name, owner, month, config.cdnCost.aliyunBssEndpoint);
        for (const row of rows) {
          records.push({
            cloud: "aliyun", profile: profile.name,
            accountId: row.accountId || owner || profile.accountId || "",
            month: row.month, product: row.product, domain: row.domain,
            trafficGB: row.trafficGB, requests: row.requests, cost: row.cost, currency: row.currency, collectedAt,
          });
        }
      } catch (e) {
        errors.push({ cloud: "aliyun", profile: profile.name, scope: `${owner ?? "self"}/${month}`, message: String(e) });
      }
    }
  }
  return records;
}
