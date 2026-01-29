import { ElastiCacheClient, DescribeCacheClustersCommand, DescribeReplicationGroupsCommand } from "@aws-sdk/client-elasticache";
import { resolveAWSCredentials } from "./aws-client-factory.js";
import type { Resource } from "../entities/index.js";
import type { CacheAdapter } from "./cache-adapter.js";
import { log } from "../utils/index.js";

interface GroupKey { profile: string; accountId: string; region: string; }

function groupResources(resources: Resource[]): Map<string, { key: GroupKey; items: Resource[] }> {
  const map = new Map<string, { key: GroupKey; items: Resource[] }>();
  for (const r of resources) {
    if (r.cloud !== "aws" || !r.type.startsWith("elasticache:")) continue;
    const k = `${r.profile}|${r.accountId}|${r.region}`;
    if (!map.has(k)) map.set(k, { key: { profile: r.profile, accountId: r.accountId || "", region: r.region }, items: [] });
    map.get(k)!.items.push(r);
  }
  return map;
}

async function createClient(profile: string, accountId: string, region: string) {
  const credentials = await resolveAWSCredentials(profile, accountId);
  return new ElastiCacheClient({ credentials, region });
}

async function fetchClusters(client: ElastiCacheClient): Promise<any[]> {
  const all: any[] = [];
  let marker: string | undefined;
  do {
    const resp = await client.send(new DescribeCacheClustersCommand({
      ShowCacheNodeInfo: true, MaxRecords: 100, Marker: marker,
    }));
    all.push(...(resp.CacheClusters || []));
    marker = resp.Marker;
  } while (marker);
  return all;
}

async function fetchReplicationGroups(client: ElastiCacheClient): Promise<any[]> {
  const all: any[] = [];
  let marker: string | undefined;
  do {
    const resp = await client.send(new DescribeReplicationGroupsCommand({
      MaxRecords: 100, Marker: marker,
    }));
    all.push(...(resp.ReplicationGroups || []));
    marker = resp.Marker;
  } while (marker);
  return all;
}

function enrichFromClusters(items: Resource[], clusters: any[]) {
  const clusterMap = new Map<string, any>();
  for (const c of clusters) clusterMap.set(c.CacheClusterId, c);
  for (const r of items) {
    if (r.type !== "elasticache:cluster") continue;
    const c = clusterMap.get(r.id);
    if (!c) continue;
    r.spec = c.CacheNodeType;
    r.engine = c.Engine ? `${c.Engine} ${c.EngineVersion || ""}`.trim() : undefined;
    r.status = c.CacheClusterStatus;
    r.nodeCount = c.NumCacheNodes;
    if (c.CacheClusterCreateTime) r.createdAt = new Date(c.CacheClusterCreateTime).toISOString();
  }
}

function enrichFromRepGroups(items: Resource[], groups: any[]) {
  const groupMap = new Map<string, any>();
  for (const g of groups) groupMap.set(g.ReplicationGroupId, g);
  for (const r of items) {
    if (r.type !== "elasticache:replicationgroup") continue;
    const g = groupMap.get(r.id);
    if (!g) continue;
    r.spec = g.CacheNodeType;
    r.status = g.Status;
    const members = g.MemberClusters?.length || g.NodeGroups?.length;
    if (members) r.nodeCount = members;
  }
}

const CACHE_TYPE = "elasticache-detail";

export async function enrichElastiCacheResources(
  resources: Resource[], cacheAdapter: CacheAdapter, cacheTtl: number, forceRefresh: boolean
): Promise<void> {
  const groups = groupResources(resources);
  if (groups.size === 0) return;
  log.info(`补充 ElastiCache 详情: ${groups.size} 组`);

  for (const [, { key, items }] of groups) {
    const { profile, accountId, region } = key;
    try {
      let raw: { clusters: any[]; repGroups: any[] } | null = null;
      if (!forceRefresh && cacheAdapter.isValid(profile, CACHE_TYPE, region, cacheTtl)) {
        const cached = cacheAdapter.getRaw(profile, CACHE_TYPE, region);
        if (cached) raw = cached as any;
      }
      if (!raw) {
        log.info(`查询 ElastiCache 详情 ${profile}/${region}...`);
        const client = await createClient(profile, accountId, region);
        const [clusters, repGroups] = await Promise.all([fetchClusters(client), fetchReplicationGroups(client)]);
        raw = { clusters, repGroups };
        cacheAdapter.setRaw(profile, CACHE_TYPE, region, raw as any);
      }
      enrichFromClusters(items, raw.clusters);
      enrichFromRepGroups(items, raw.repGroups);
    } catch (e: any) {
      log.warn(`ElastiCache 详情查询失败 ${profile}/${region}: ${e.message}`);
      log.debug(e.stack);
    }
  }
}
