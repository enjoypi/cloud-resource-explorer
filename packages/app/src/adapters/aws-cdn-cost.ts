import { fromIni } from "@aws-sdk/credential-providers";
import { listSSOAccounts, parseAWSSSOSessions, parseAWSProfileSSORef, getSSOCredentials } from "./aws-sso.js";
import { log } from "../utils/index.js";
import { CDN_COST } from "../constants.js";
import type { Profile } from "../entities/index.js";
import type { AwsCdnCostPort, CdnUsageRow, CdnCostRow, CdnDistribution } from "../use-cases/cdn-cost.js";

// CloudFront 为全局服务，其 API/CloudWatch 指标/Cost Explorer 均挂在 us-east-1
const CLOUDFRONT_HOME_REGION = "us-east-1";
const CW_NAMESPACE = "AWS/CloudFront";
const CE_SERVICE_NAME = "Amazon CloudFront";

export function monthRangeUTC(months: string[]): { start: Date; end: Date } {
  const [sy, sm] = months[0].split("-").map(Number);
  const [ey, em] = months[months.length - 1].split("-").map(Number);
  return { start: new Date(Date.UTC(sy, sm - 1, 1)), end: new Date(Date.UTC(ey, em, 1)) };
}

export function monthOfTimestampUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Cost Explorer 不接受未来的 End 日期，账期含本月时钳制到明天（UTC，End 为开区间） */
export function clampEndToTomorrowUTC(end: Date, now: Date): Date {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return end.getTime() > tomorrow.getTime() ? tomorrow : end;
}

interface Datapoint { Timestamp?: Date; Sum?: number; }

export function aggregateDatapointsByMonth(bytes: Datapoint[], requests: Datapoint[], months: string[]): CdnUsageRow[] {
  const byMonth = new Map<string, { bytes: number; requests: number }>();
  const add = (points: Datapoint[], field: "bytes" | "requests") => {
    for (const p of points) {
      if (!p.Timestamp || p.Sum === undefined) continue;
      const month = monthOfTimestampUTC(new Date(p.Timestamp));
      if (!months.includes(month)) continue;
      const acc = byMonth.get(month) ?? { bytes: 0, requests: 0 };
      acc[field] += p.Sum;
      byMonth.set(month, acc);
    }
  };
  add(bytes, "bytes");
  add(requests, "requests");
  return months
    .filter(m => byMonth.has(m))
    .map(m => {
      const acc = byMonth.get(m)!;
      return { month: m, trafficGB: Math.round(acc.bytes / CDN_COST.BYTES_PER_GB * 1000) / 1000, requests: Math.round(acc.requests) };
    });
}

export function convertCostGroups(resultsByTime: any[]): CdnCostRow[] {
  const rows: CdnCostRow[] = [];
  for (const rbt of resultsByTime) {
    const month = rbt.TimePeriod?.Start?.slice(0, 7);
    if (!month) continue;
    for (const group of rbt.Groups ?? []) {
      const accountId = group.Keys?.[0];
      const metric = group.Metrics?.UnblendedCost;
      if (!accountId || !metric?.Amount) continue;
      const cost = parseFloat(metric.Amount);
      if (!cost) continue;
      rows.push({ month, accountId, cost, currency: metric.Unit || "USD" });
    }
  }
  return rows;
}

/** 从 Resource Explorer 原始结果中提取拥有 distribution 的账号 ID（去重） */
export function extractDistributionAccountIds(rawItems: Array<{ Arn?: string; OwningAccountId?: string }>): string[] {
  const ids = new Set<string>();
  for (const item of rawItems) {
    if (item.Arn?.includes(":distribution/") && item.OwningAccountId) ids.add(item.OwningAccountId);
  }
  return [...ids];
}

// 跨账号取 CloudWatch/CloudFront 数据：profile 本身或其引用的 sso-session 都能换取成员账号凭证
async function resolveAccountCredentials(profileName: string, accountId: string): Promise<any> {
  const sessions = parseAWSSSOSessions();
  let session = sessions.find(s => s.name === profileName);
  let roleName = session?.roleName;
  if (!session) {
    const ref = parseAWSProfileSSORef(profileName);
    if (ref?.sessionName) {
      session = sessions.find(s => s.name === ref.sessionName);
      roleName = ref.roleName ?? session?.roleName;
    }
  }
  if (session) {
    const creds = await getSSOCredentials(session, accountId, roleName || "ReadOnlyAccess");
    if (creds) return creds;
  }
  return fromIni({ profile: profileName });
}

async function listAccountIds(profile: Profile, viewArn?: string): Promise<string[]> {
  if (profile.ssoSession) {
    const accounts = await listSSOAccounts({ name: profile.ssoSession.name, startUrl: profile.ssoSession.startUrl, region: profile.ssoSession.region });
    if (accounts.length > 0) return accounts.map(a => a.accountId);
  }
  // 组织视图一次查出哪些账号有 distribution，免去逐账号配置 profile
  if (viewArn) {
    const { collectAWSResourcesByExplorer } = await import("./aws-resource-explorer.js");
    const raw = await collectAWSResourcesByExplorer(profile.name, "cdn", "global", profile.accountId, viewArn);
    const ids = extractDistributionAccountIds(raw);
    if (ids.length > 0) {
      log.debug("Resource Explorer 发现含 distribution 的账号", { feature: "cdn-cost", profile: profile.name, accounts: ids });
      return ids;
    }
  }
  return profile.accountId ? [profile.accountId] : [];
}

async function listDistributions(profileName: string, accountId: string): Promise<CdnDistribution[]> {
  const { CloudFrontClient, ListDistributionsCommand } = await import("@aws-sdk/client-cloudfront");
  const client = new CloudFrontClient({ credentials: await resolveAccountCredentials(profileName, accountId), region: CLOUDFRONT_HOME_REGION });
  const dists: CdnDistribution[] = [];
  let marker: string | undefined;
  do {
    const resp = await client.send(new ListDistributionsCommand({ Marker: marker }));
    for (const item of resp.DistributionList?.Items ?? []) {
      if (!item.Id) continue;
      const aliases = item.Aliases?.Items?.filter(Boolean) ?? [];
      dists.push({ id: item.Id, domain: aliases.length > 0 ? aliases.join(" ") : item.DomainName || item.Id });
    }
    marker = resp.DistributionList?.NextMarker;
  } while (marker);
  log.debug("CloudFront Distribution 列表", { feature: "cdn-cost", profile: profileName, accountId, count: dists.length });
  return dists;
}

async function getDistributionMonthlyUsage(
  profileName: string, accountId: string, distributionId: string, months: string[],
): Promise<CdnUsageRow[]> {
  const { CloudWatchClient, GetMetricStatisticsCommand } = await import("@aws-sdk/client-cloudwatch");
  const client = new CloudWatchClient({ credentials: await resolveAccountCredentials(profileName, accountId), region: CLOUDFRONT_HOME_REGION });
  const { start, end } = monthRangeUTC(months);
  const fetchMetric = (metricName: string) => client.send(new GetMetricStatisticsCommand({
    Namespace: CW_NAMESPACE, MetricName: metricName,
    Dimensions: [{ Name: "DistributionId", Value: distributionId }, { Name: "Region", Value: "Global" }],
    StartTime: start, EndTime: end, Period: CDN_COST.CW_PERIOD_SECONDS, Statistics: ["Sum"],
  }));
  const [bytes, requests] = await Promise.all([fetchMetric("BytesDownloaded"), fetchMetric("Requests")]);
  const rows = aggregateDatapointsByMonth(bytes.Datapoints ?? [], requests.Datapoints ?? [], months);
  log.debug("CloudFront 用量", { feature: "cdn-cost", profile: profileName, accountId, distributionId, rows: rows.length });
  return rows;
}

async function getMonthlyCostByAccount(profileName: string, accountId: string, months: string[]): Promise<CdnCostRow[]> {
  const { CostExplorerClient, GetCostAndUsageCommand } = await import("@aws-sdk/client-cost-explorer");
  const client = new CostExplorerClient({ credentials: await resolveAccountCredentials(profileName, accountId), region: CLOUDFRONT_HOME_REGION });
  const { start, end: rangeEnd } = monthRangeUTC(months);
  const end = clampEndToTomorrowUTC(rangeEnd, new Date());
  const resultsByTime: any[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: start.toISOString().slice(0, 10), End: end.toISOString().slice(0, 10) },
      Granularity: "MONTHLY",
      Filter: { Dimensions: { Key: "SERVICE", Values: [CE_SERVICE_NAME] } },
      GroupBy: [{ Type: "DIMENSION", Key: "LINKED_ACCOUNT" }],
      Metrics: ["UnblendedCost"],
      NextPageToken: token,
    }));
    resultsByTime.push(...(resp.ResultsByTime ?? []));
    token = resp.NextPageToken;
  } while (token);
  const rows = convertCostGroups(resultsByTime);
  log.debug("Cost Explorer CloudFront 费用", { feature: "cdn-cost", profile: profileName, accountId, rows: rows.length });
  return rows;
}

export const awsCdnCostPort: AwsCdnCostPort = { listAccountIds, listDistributions, getDistributionMonthlyUsage, getMonthlyCostByAccount };
