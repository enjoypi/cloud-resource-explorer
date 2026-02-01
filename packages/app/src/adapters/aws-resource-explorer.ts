import { ResourceExplorer2Client, ListResourcesCommand, SearchCommand } from "@aws-sdk/client-resource-explorer-2";
import { log } from "../utils/index.js";
import { resolveAWSCredentials } from "./aws-client-factory.js";
import { extractProject } from "./profile-adapter.js";
import { PAGINATION } from "../constants.js";

const AWS_RESOURCE_TYPE_MAP: Record<string, string[]> = {
  compute: ["ec2:instance", "ecs:service", "ecs:cluster", "ecs:task-definition", "lambda:function"],
  storage: ["s3:bucket", "s3:accesspoint"],
  ebs: ["ec2:volume", "ec2:snapshot"],
  filesys: ["efs:file-system", "fsx:file-system", "fsx:backup"],
  network: [
    "ec2:vpc", "ec2:subnet", "ec2:security-group", "ec2:route-table",
    "ec2:internet-gateway", "ec2:natgateway", "ec2:elastic-ip",
    "ec2:network-acl", "ec2:vpn-gateway", "ec2:vpn-connection",
    "ec2:transit-gateway", "ec2:vpc-endpoint", "ec2:vpc-peering-connection",
  ],
  slb: [
    "elasticloadbalancing:loadbalancer", "elasticloadbalancing:loadbalancer/app",
    "elasticloadbalancing:loadbalancer/net", "elasticloadbalancing:targetgroup",
  ],
  database: ["rds:db", "rds:cluster", "dynamodb:table", "rds:global-cluster"],
  cache: ["elasticache:cluster", "elasticache:replicationgroup", "elasticache:globalreplicationgroup"],
  cdn: ["cloudfront:distribution", "cloudfront:function"],
  dns: ["route53:hostedzone", "route53:healthcheck"],
  container: ["ecs:cluster", "eks:cluster", "ecr:repository", "ecs:capacity-provider"],
  iam: ["iam:user", "iam:role", "iam:group", "iam:policy", "iam:instance-profile"],
  kms: ["kms:key"],
  queue: ["sqs:queue"],
  notify: ["sns:topic"],
};

async function createExplorerClient(profileName: string, accountId?: string, viewArn?: string) {
  const region = viewArn ? viewArn.split(":")[3] : "us-east-1";
  const credentials = await resolveAWSCredentials(profileName, accountId);
  return new ResourceExplorer2Client({ credentials, region });
}

export interface ResourceCount { type: string; resourceType: string; count: number; complete: boolean; }
export interface SearchResult { arn: string; resourceType: string; region: string; accountId: string; properties: Record<string, any>; }

export async function searchAWSResourcesByIP(
  profileName: string, ip: string, accountId?: string, viewArn?: string
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  try {
    const client = await createExplorerClient(profileName, accountId, viewArn);
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new SearchCommand({ QueryString: ip, ViewArn: viewArn, MaxResults: PAGINATION.MAX_RESULTS, NextToken: nextToken }));
      for (const r of resp.Resources || []) {
        const props: Record<string, any> = {};
        for (const p of r.Properties || []) props[p.Name || ""] = p.Data;
        results.push({ arn: r.Arn || "", resourceType: r.ResourceType || "", region: r.Region || "", accountId: r.OwningAccountId || "", properties: props });
      }
      nextToken = resp.NextToken;
    } while (nextToken);
  } catch (e: any) { log.warn(`AWS Resource Explorer 搜索失败: ${e.message}`); }
  return results;
}

export async function countAWSResources(
  profileName: string, type: string, region: string, accountId?: string, viewArn?: string
): Promise<ResourceCount[]> {
  const resourceTypes = AWS_RESOURCE_TYPE_MAP[type];
  if (!resourceTypes) { log.debug(`未知 AWS 资源类型：${type}`); return []; }
  const counts: ResourceCount[] = [];
  try {
    const client = await createExplorerClient(profileName, accountId, viewArn);
    for (const resourceType of resourceTypes) {
      try {
        let queryString = `resourcetype:${resourceType}`;
        if (region !== "global" && !viewArn) queryString += ` region:${region}`;
        const resp = await client.send(new SearchCommand({ QueryString: queryString, ViewArn: viewArn, MaxResults: 1 }));
        const total = resp.Count?.TotalResources ?? 0;
        const complete = resp.Count?.Complete ?? true;
        if (total > 0) { counts.push({ type, resourceType, count: Number(total), complete }); log.debug(`  ${resourceType}: ${total}${complete ? "" : "+"}`); }
      } catch (e: any) { log.debug(`AWS Resource Explorer 计数失败 ${profileName}/${type}/${resourceType}: ${e.message}`); }
    }
  } catch (e: any) { log.warn(`AWS Resource Explorer 客户端创建失败 ${profileName}: ${e.message}`); }
  return counts;
}

export async function collectAWSResourcesByExplorer(
  profileName: string, type: string, region: string, accountId?: string, viewArn?: string
): Promise<any[]> {
  const resourceTypes = AWS_RESOURCE_TYPE_MAP[type];
  if (!resourceTypes) { log.debug(`未知 AWS 资源类型：${type}`); return []; }
  const rawItems: any[] = [];
  try {
    const client = await createExplorerClient(profileName, accountId, viewArn);
    for (const resourceType of resourceTypes) {
      try {
        let filterString = `resourcetype:${resourceType}`;
        if (region !== "global" && !viewArn) filterString += ` region:${region}`;
        let nextToken: string | undefined;
        do {
          const resp = await client.send(new ListResourcesCommand({ Filters: { FilterString: filterString }, MaxResults: PAGINATION.MAX_RESULTS, NextToken: nextToken, ViewArn: viewArn }));
          const items = resp.Resources || [];
          rawItems.push(...items);
          nextToken = resp.NextToken;
          if (items.length > 0) log.debug(`  ${resourceType}: +${items.length} (nextToken: ${!!nextToken})`);
        } while (nextToken);
      } catch (e: any) { log.debug(`AWS Resource Explorer 采集失败 ${profileName}/${type}/${resourceType}: ${e.message}`); }
    }
  } catch (e: any) { log.warn(`AWS Resource Explorer 客户端创建失败 ${profileName}: ${e.message}`); }
  log.debug(`AWS Resource Explorer ${profileName}/${type}/${region}: ${rawItems.length}`);
  return rawItems;
}

export { extractPropertyFields, extractIdFromArn } from "./aws-property-extract.js";
export { convertAWSResourceExplorerRaw } from "./aws-property-extract.js";
