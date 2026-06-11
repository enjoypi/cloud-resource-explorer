import { createAliyunConfig } from "./aliyun-credentials.js";
import { log } from "../utils/index.js";
import { CDN_COST } from "../constants.js";
import { ACCOUNT_TOTAL_DOMAIN } from "../entities/index.js";
import type { AliyunCdnCostPort, CdnBillRow } from "../use-cases/cdn-cost.js";

// 财务托管（trusteeship）下 DescribeInstanceBill 拿不到加速域名：instanceID 形如
// "成员账号ID;大区"（如 5024168270807259;AP1），最细只到成员账号×大区，故无域名级明细
const PRODUCT_CODES = ["cdn", "dcdn"] as const;

// instanceID 拆出分号后的大区码作为 domain 维度；无大区后缀的归集行用 ACCOUNT_TOTAL
function parseRegion(instanceID: string): string {
  const idx = instanceID.indexOf(";");
  return idx >= 0 ? instanceID.slice(idx + 1) : ACCOUNT_TOTAL_DOMAIN;
}

// 计费项用量单位换算表：流量统一为 GB，请求数统一为次
const TRAFFIC_UNIT_TO_GB: Record<string, number> = { GB: 1, MB: 1 / 1024, TB: 1024 };
const REQUEST_UNIT_TO_COUNT: Record<string, number> = { "万次": 10000, "次": 1 };

export function parseUsage(usage?: string, unit?: string): { trafficGB: number; requests: number } {
  const value = parseFloat(usage ?? "");
  if (!unit || Number.isNaN(value)) return { trafficGB: 0, requests: 0 };
  if (unit in TRAFFIC_UNIT_TO_GB) return { trafficGB: value * TRAFFIC_UNIT_TO_GB[unit], requests: 0 };
  if (unit in REQUEST_UNIT_TO_COUNT) return { trafficGB: 0, requests: value * REQUEST_UNIT_TO_COUNT[unit] };
  return { trafficGB: 0, requests: 0 };
}

export function convertBillItems(items: any[], month: string): CdnBillRow[] {
  const grouped = new Map<string, CdnBillRow & { hasTraffic: boolean; hasRequests: boolean }>();
  for (const item of items) {
    if (!item.instanceID) continue;
    // 资源归属账号取 ownerID（成员账号），回退 billAccountID（付款账号）兼容单账号
    const accountId = item.ownerID || item.billAccountID || "";
    const region = parseRegion(item.instanceID);
    const key = `${accountId}|${region}|${item.productCode}`;
    let row = grouped.get(key);
    if (!row) {
      row = {
        month, accountId, domain: region,
        product: item.productName || String(item.productCode || "").toUpperCase(),
        trafficGB: 0, requests: 0, cost: 0, currency: item.currency || "CNY",
        hasTraffic: false, hasRequests: false,
      };
      grouped.set(key, row);
    }
    row.cost += item.pretaxAmount || 0;
    const { trafficGB, requests } = parseUsage(item.usage, item.usageUnit);
    if (trafficGB > 0) { row.trafficGB = (row.trafficGB ?? 0) + trafficGB; row.hasTraffic = true; }
    if (requests > 0) { row.requests = (row.requests ?? 0) + requests; row.hasRequests = true; }
  }
  return [...grouped.values()].map(({ hasTraffic, hasRequests, ...row }) => ({
    ...row,
    trafficGB: hasTraffic ? Math.round((row.trafficGB ?? 0) * 1000) / 1000 : null,
    requests: hasRequests ? Math.round(row.requests ?? 0) : null,
  }));
}

// 阿里云国内站与国际站账号必须调用各自站点的 BSS endpoint，错配返回 NotApplicable
const SITE_ENDPOINTS = ["business.aliyuncs.com", "business.ap-southeast-1.aliyuncs.com"];
const SITE_MISMATCH_PATTERN = "caller site matches the api domain";

export function isSiteMismatchError(e: unknown): boolean {
  return String(e).toLowerCase().includes(SITE_MISMATCH_PATTERN);
}

export function alternateEndpoint(endpoint: string): string {
  return endpoint === SITE_ENDPOINTS[0] ? SITE_ENDPOINTS[1] : SITE_ENDPOINTS[0];
}

export async function queryWithSiteFallback<T>(
  preferred: string,
  query: (endpoint: string) => Promise<T>,
  onResolved: (endpoint: string) => void,
): Promise<T> {
  try {
    const result = await query(preferred);
    onResolved(preferred);
    return result;
  } catch (e) {
    if (!isSiteMismatchError(e)) throw e;
    const fallback = alternateEndpoint(preferred);
    const result = await query(fallback);
    onResolved(fallback);
    return result;
  }
}

async function createBssClient(profileName: string, endpoint: string): Promise<{ client: any; module: any } | null> {
  const config = await createAliyunConfig(profileName, "cn-hangzhou");
  if (!config) return null;
  config.endpoint = endpoint;
  const bssModule = await import("@alicloud/bssopenapi20171214");
  const Bss = (bssModule as any).default?.default || (bssModule as any).default || bssModule;
  return { client: new Bss(config), module: bssModule };
}

// 各 profile 实际站点的探测结果，命中后同 profile 后续请求不再试错
const resolvedEndpoints = new Map<string, string>();

async function getMonthlyBill(
  profileName: string, billOwnerId: string | undefined, month: string, bssEndpoint: string,
): Promise<CdnBillRow[]> {
  const preferred = resolvedEndpoints.get(profileName) ?? bssEndpoint;
  return queryWithSiteFallback(
    preferred,
    endpoint => queryBill(profileName, billOwnerId, month, endpoint),
    endpoint => resolvedEndpoints.set(profileName, endpoint),
  );
}

async function queryBill(
  profileName: string, billOwnerId: string | undefined, month: string, bssEndpoint: string,
): Promise<CdnBillRow[]> {
  const bss = await createBssClient(profileName, bssEndpoint);
  if (!bss) throw new Error(`无法创建阿里云凭证: ${profileName}`);
  const items: any[] = [];
  for (const productCode of PRODUCT_CODES) {
    let nextToken: string | undefined;
    do {
      const request = new (bss.module as any).DescribeInstanceBillRequest({
        billingCycle: month, productCode, isBillingItem: true,
        maxResults: CDN_COST.BSS_PAGE_SIZE, nextToken,
        billOwnerId: billOwnerId ? Number(billOwnerId) : undefined,
      });
      const resp = await bss.client.describeInstanceBill(request);
      items.push(...(resp.body?.data?.items ?? []));
      nextToken = resp.body?.data?.nextToken || undefined;
    } while (nextToken);
  }
  const rows = convertBillItems(items, month);
  log.debug("阿里云 CDN 账单", { feature: "cdn-cost", profile: profileName, billOwnerId, month, items: items.length, rows: rows.length });
  return rows;
}

async function listRdAccountIds(profileName: string): Promise<string[]> {
  const { collectAliyunRDAccounts } = await import("./aliyun-resource-directory.js");
  const accounts = await collectAliyunRDAccounts(profileName);
  return accounts.map((a: any) => a.accountId || a.id).filter(Boolean);
}

export const aliyunCdnCostPort: AliyunCdnCostPort = { listRdAccountIds, getMonthlyBill };
