import type { Config, Resource, Profile, CollectTask, CollectError, CollectErrorType, SSOSessionError, ProviderConfig } from "../entities/index.js";
import type { ProfileAdapter } from "../adapters/profile-adapter.js";
import type { CacheAdapter } from "../adapters/cache-adapter.js";
import { log } from "../utils/index.js";

export interface CollectInput { config: Config; profileAdapter: ProfileAdapter; cacheAdapter: CacheAdapter; }
export interface CollectOutput { resources: Resource[]; errors: CollectError[]; ssoErrors: SSOSessionError[]; }

const GLOBAL_RESOURCE_TYPES = ["storage", "cdn", "dns", "iam"];
const ALL_RESOURCE_TYPES = ["compute", "storage", "ebs", "filesys", "network", "slb", "database", "cache", "cdn", "dns", "container", "iam", "kms", "queue", "notify"];

export function isGlobalResource(type: string): boolean { return GLOBAL_RESOURCE_TYPES.includes(type); }
export function expandTypes(types: string[]): string[] { return types.includes("all") ? ALL_RESOURCE_TYPES : types; }

export function filterByProvider(accounts: any[], providerConfig: ProviderConfig): any[] {
  let result = accounts;
  if (providerConfig.accounts.length > 0) result = result.filter(a => providerConfig.accounts.includes(a.accountId || a.id));
  if (providerConfig.excludeAccounts.length > 0) result = result.filter(a => !providerConfig.excludeAccounts.includes(a.accountId || a.id));
  return result;
}

export function filterProfiles(profiles: Profile[], config: Config): Profile[] {
  return profiles.filter((p) => {
    const providerConfig = p.cloud === "aliyun" ? config.aliyun : config.aws;
    if (providerConfig.profiles.length > 0 && !providerConfig.profiles.includes(p.name)) return false;
    return !providerConfig.excludeProfiles.includes(p.name);
  });
}

export function createRegionGetter(regionCache: Map<string, string[]>, config: Config) {
  return (profile: Profile, _type: string): string[] => {
    const key = `${profile.name}:${profile.cloud}`;
    let regions = regionCache.get(key) || [];
    const providerConfig = profile.cloud === "aliyun" ? config.aliyun : config.aws;
    if (providerConfig.regions.length > 0) regions = regions.filter((r) => providerConfig.regions.includes(r));
    if (providerConfig.excludeRegions.length > 0) regions = regions.filter((r) => !providerConfig.excludeRegions.includes(r));
    return regions;
  };
}

export async function initProfilesAndRegions(
  config: Config, profileAdapter: ProfileAdapter
): Promise<{ profiles: Profile[]; regionCache: Map<string, string[]> }> {
  const clouds: ("aws" | "aliyun")[] = config.cloud === "all" ? ["aws", "aliyun"] : [config.cloud];
  let allProfiles: Profile[] = [];
  for (const cloud of clouds) allProfiles.push(...await profileAdapter.discoverProfiles(cloud));
  allProfiles = filterProfiles(allProfiles, config);

  const regionCache = new Map<string, string[]>();
  for (const profile of allProfiles) {
    try {
      const [regions, accountId] = await Promise.all([
        profileAdapter.getAvailableRegions(profile, "compute"),
        profileAdapter.getAccountId(profile),
      ]);
      regionCache.set(`${profile.name}:${profile.cloud}`, regions);
      profile.accountId = accountId;
    } catch (e) {
      log.debug(`获取 ${profile.name} 区域失败:`, e);
      regionCache.set(`${profile.name}:${profile.cloud}`, []);
    }
  }
  return { profiles: allProfiles, regionCache };
}

export function generateTasks(
  profiles: Profile[], types: string[],
  getRegions: (profile: Profile, type: string) => string[],
  rdInfoMap?: Map<string, { accounts: any[]; resourceDirectoryId: string }>,
  viewArn?: string
): CollectTask[] {
  const tasks: CollectTask[] = [];
  for (const profile of profiles) {
    if (!profile.isValid) continue;
    const rdInfo = rdInfoMap?.get(profile.name);
    for (const type of types) {
      if (isGlobalResource(type)) {
        tasks.push({ profile, type, region: "global", ...(rdInfo ? { resourceDirectoryId: rdInfo.resourceDirectoryId } : { viewArn }) });
      } else {
        for (const region of getRegions(profile, type)) {
          tasks.push({ profile, type, region, ...(rdInfo ? { resourceDirectoryId: rdInfo.resourceDirectoryId } : { viewArn }) });
        }
      }
    }
  }
  return tasks;
}

interface TaskResult<R> { result: R; cached: boolean; }

async function runWithConcurrency<T, R>(
  items: T[], concurrency: number, sleepMin: number, sleepMax: number,
  fn: (item: T) => Promise<TaskResult<R>>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let running = 0;
  const queue: (() => void)[] = [];
  const acquire = (): Promise<void> => new Promise(resolve => {
    if (running < concurrency) { running++; resolve(); }
    else queue.push(() => { running++; resolve(); });
  });
  const release = async (needSleep: boolean) => {
    if (needSleep) {
      const ms = sleepMin * 1000 + Math.random() * (sleepMax - sleepMin) * 1000;
      if (ms > 0) { log.debug(`[Rate limit] Sleeping ${(ms/1000).toFixed(1)}s...`); await sleep(ms); }
    }
    running--;
    if (queue.length > 0) queue.shift()!();
  };
  await Promise.all(items.map(async (item, index) => {
    await acquire();
    let cached = false;
    try {
      const { result, cached: c } = await fn(item);
      results[index] = result;
      cached = c;
    } finally { await release(!cached); }
  }));
  return results;
}

function classifyError(error: unknown): CollectErrorType {
  const msg = String(error).toLowerCase();
  if (msg.includes("auth") || msg.includes("credential") || msg.includes("access denied")) return "AUTH_FAILED";
  if (msg.includes("rate") || msg.includes("throttl") || msg.includes("too many")) return "RATE_LIMITED";
  if (msg.includes("timeout") || msg.includes("timed out")) return "TIMEOUT";
  if (msg.includes("api") || msg.includes("request")) return "API_ERROR";
  return "UNKNOWN";
}

export async function collect(input: CollectInput): Promise<CollectOutput> {
  const { config, profileAdapter, cacheAdapter } = input;
  const resources: Resource[] = [];
  const errors: CollectError[] = [];
  const ssoErrors: SSOSessionError[] = [];

  const clouds: ("aws" | "aliyun")[] = config.cloud === "all" ? ["aws", "aliyun"] : [config.cloud];
  log.debug(`目标云平台: ${clouds.join(", ")}`);

  const { profiles: allProfilesInit, regionCache } = await initProfilesAndRegions(config, profileAdapter);
  let allProfiles = allProfilesInit;
  log.debug(`发现 ${allProfiles.length} 个 profiles`);

  const ssoSessions = await profileAdapter.discoverSSOSessions();
  for (const session of ssoSessions) {
    const isValid = await profileAdapter.validateSSOSession(session);
    if (!isValid) {
      const affectedProfiles = allProfiles.filter((p) => p.ssoSession?.name === session.name).map((p) => p.name);
      if (affectedProfiles.length > 0) {
        ssoErrors.push({ session, affectedProfiles, errorType: "EXPIRED" });
        allProfiles = allProfiles.filter((p) => p.ssoSession?.name !== session.name);
      }
    }
  }

  const getRegions = createRegionGetter(regionCache, config);
  const rdInfoMap = new Map<string, { accounts: any[]; resourceDirectoryId: string }>();

  if (clouds.includes("aliyun")) {
    const { collectAliyunRDAccounts, getResourceDirectoryId } = await import("../adapters/aliyun-resource-directory.js");
    for (const profile of allProfiles.filter(p => p.cloud === "aliyun" && p.cloudSSOSession)) {
      const accounts = await collectAliyunRDAccounts(profile.name);
      if (accounts.length > 0) {
        resources.push(...accounts);
        const rdId = await getResourceDirectoryId(profile.name);
        let rdAccounts = filterByProvider(accounts.map(a => ({ accountId: a.accountId || a.id, displayName: a.name, status: a.status || "Active" })), config.aliyun);
        if (rdAccounts.length > 0 && rdId) rdInfoMap.set(profile.name, { accounts: rdAccounts, resourceDirectoryId: rdId });
      }
    }
  }

  if (clouds.includes("aws")) {
    const { listSSOAccounts } = await import("../adapters/aws-sso.js");
    const { listAWSOrganizationAccounts, convertAWSAccountsToResources } = await import("../adapters/aws-organizations.js");
    let awsProfiles = allProfiles.filter(p => p.cloud === "aws");

    for (const profile of awsProfiles) {
      if (profile.ssoSession) {
        const ssoAccounts = await listSSOAccounts({ name: profile.ssoSession.name, startUrl: profile.ssoSession.startUrl, region: profile.ssoSession.region });
        if (ssoAccounts.length > 0) {
          resources.push(...ssoAccounts.map(a => ({ cloud: "aws" as const, profile: profile.name, accountId: a.accountId, type: "sso-account", id: a.accountId, name: a.accountName, region: "global", project: "", tags: { email: a.emailAddress }, status: "ACTIVE", collectedAt: new Date() })));
          const viewArn = config.aws.resourceExplorerViewArn;
          const aggregatorAccountId = viewArn ? viewArn.split(":")[4] : undefined;
          const filteredAccounts = filterByProvider(ssoAccounts.map(a => ({ accountId: a.accountId, accountName: a.accountName })), config.aws);
          const aggregatorAccount = aggregatorAccountId ? filteredAccounts.find(a => a.accountId === aggregatorAccountId) : filteredAccounts[0];
          if (aggregatorAccount) profile.accountId = aggregatorAccount.accountId;
          break;
        }
      }
    }

    for (const profile of awsProfiles.filter(p => !p.ssoSession)) {
      const orgAccounts = await listAWSOrganizationAccounts(profile.name);
      if (orgAccounts.length > 0) { resources.push(...convertAWSAccountsToResources(orgAccounts, profile.name)); break; }
    }

    awsProfiles = awsProfiles.filter(p => {
      if (!p.accountId) return true;
      if (config.aws.accounts.length > 0 && !config.aws.accounts.includes(p.accountId)) return false;
      return !config.aws.excludeAccounts.includes(p.accountId);
    });
    allProfiles = allProfiles.filter(p => p.cloud !== "aws" || awsProfiles.some(f => f.name === p.name));
  }

  const expandedTypes = expandTypes(config.types);
  const tasks = generateTasks(allProfiles, expandedTypes, getRegions, rdInfoMap, config.aws.resourceExplorerViewArn);
  log.debug(`创建 ${tasks.length} 个采集任务`);

  type CollectResult = { resources: Resource[]; error?: CollectError };
  const collectTask = async (task: CollectTask): Promise<TaskResult<CollectResult>> => {
    const { profile, type, region } = task;
    if (!config.forceRefresh && cacheAdapter.isValid(profile.name, type, region, config.cacheTtl)) {
      const cached = cacheAdapter.getRaw(profile.name, type, region);
      if (cached) return { result: { resources: profileAdapter.convertRaw(cached, task) }, cached: true };
    }
    try {
      log.info(`采集 ${profile.name}/${type}/${region}...`);
      const raw = await profileAdapter.collectRaw(task);
      cacheAdapter.setRaw(profile.name, type, region, raw);
      return { result: { resources: profileAdapter.convertRaw(raw, task) }, cached: false };
    } catch (e) {
      return { result: { resources: [], error: { task, errorType: classifyError(e), message: String(e) } }, cached: false };
    }
  };

  const results = await runWithConcurrency(tasks, config.concurrency, config.sleepMin, config.sleepMax, collectTask);
  for (const result of results) {
    resources.push(...result.resources);
    if (result.error) errors.push(result.error);
  }

  log.debug(`采集完成: ${resources.length} 资源, ${errors.length} 错误`);
  return { resources, errors, ssoErrors };
}
