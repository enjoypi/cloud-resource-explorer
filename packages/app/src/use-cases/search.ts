import type { Resource } from "../entities/index.js";
import type { CacheAdapter } from "../adapters/cache-adapter.js";
import { log } from "../utils/index.js";

export interface SearchInput {
  query: string;
  cacheAdapter: CacheAdapter;
  cacheDir: string;
}

export interface SearchResult {
  resources: Resource[];
  matchCount: number;
}

function matchesQuery(resource: Resource, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  if (resource.id.toLowerCase().includes(lowerQuery)) return true;
  if (resource.name.toLowerCase().includes(lowerQuery)) return true;
  if (resource.ip?.toLowerCase().includes(lowerQuery)) return true;
  if (resource.dns?.toLowerCase().includes(lowerQuery)) return true;
  const tagValues = Object.values(resource.tags || {}).join(" ").toLowerCase();
  return tagValues.includes(lowerQuery);
}

export async function searchResources(input: SearchInput): Promise<SearchResult> {
  const { query, cacheAdapter, cacheDir } = input;
  const resources: Resource[] = [];

  const fs = await import("node:fs");
  if (!fs.existsSync(cacheDir)) {
    log.warn(`缓存目录不存在: ${cacheDir}`);
    return { resources: [], matchCount: 0 };
  }

  for (const file of fs.readdirSync(cacheDir)) {
    if (!file.endsWith(".json")) continue;
    const parts = file.replace(".json", "").split("_");
    if (parts.length < 3) continue;
    const [profile, type, ...regionParts] = parts;
    const region = regionParts.join("_");
    const raw = cacheAdapter.getRaw(profile, type, region);
    if (!raw) continue;

    for (const item of raw) {
      const resource: Resource = {
        cloud: item.cloud || "unknown",
        profile,
        accountId: item.accountId,
        type,
        id: item.resourceId || item.id || "",
        name: item.resourceName || item.name || "",
        region: item.regionId || region,
        project: "",
        tags: item.tags || {},
        ip: item.ip,
        dns: item.dns,
        collectedAt: new Date(),
      };
      if (matchesQuery(resource, query)) resources.push(resource);
    }
  }

  log.debug(`搜索 "${query}": 找到 ${resources.length} 个匹配资源`);
  return { resources, matchCount: resources.length };
}
