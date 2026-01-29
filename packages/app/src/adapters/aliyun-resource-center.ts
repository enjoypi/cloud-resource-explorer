import * as $ResourceCenter20221201 from '@alicloud/resourcecenter20221201';
import { log, logAliyunAuthError } from "../utils/index.js";
import { createAliyunConfig } from "./aliyun-credentials.js";

const RESOURCE_TYPE_MAP: Record<string, string[]> = {
  compute: ["ACS::ECS::Instance", "ACS::ECI::ContainerGroup", "ACS::SWAS::Instance", "ACS::ECP::Instance"],
  storage: ["ACS::OSS::Bucket"],
  ebs: ["ACS::ECS::Disk", "ACS::EBS::DedicatedBlockStorageCluster"],
  filesys: ["ACS::NAS::FileSystem"],
  network: [
    "ACS::VPC::VPC", "ACS::VPC::VSwitch", "ACS::ECS::SecurityGroup",
    "ACS::VPC::RouteTable", "ACS::VPC::NetworkAcl", "ACS::NAT::NatGateway",
    "ACS::EIP::EipAddress", "ACS::CBWP::CommonBandwidthPackage",
    "ACS::VPN::VpnGateway", "ACS::VPN::VpnConnection",
    "ACS::ExpressConnect::VirtualBorderRouter", "ACS::CEN::CenInstance",
  ],
  slb: ["ACS::SLB::LoadBalancer", "ACS::ALB::LoadBalancer", "ACS::NLB::LoadBalancer", "ACS::Ga::Accelerator"],
  database: [
    "ACS::RDS::DBInstance", "ACS::PolarDB::DBCluster", "ACS::MongoDB::DBInstance",
    "ACS::GPDB::DBInstance", "ACS::OceanBase::Instance", "ACS::Lindorm::Instance",
    "ACS::HBase::Cluster", "ACS::ClickHouse::DBCluster", "ACS::SelectDB::DBInstance",
  ],
  cache: ["ACS::Redis::DBInstance"],
  cdn: ["ACS::CDN::Domain", "ACS::DCDN::Domain"],
  dns: ["ACS::Alidns::Domain", "ACS::PrivateZone::Zone"],
  container: ["ACS::ACK::Cluster", "ACS::CR::Instance", "ACS::CR::Repository"],
  iam: ["ACS::RAM::User", "ACS::RAM::Role", "ACS::RAM::Group", "ACS::RAM::Policy"],
  kms: ["ACS::KMS::Key"],
  queue: ["ACS::MessageService::Queue", "ACS::RocketMQ::Instance", "ACS::AliKafka::Instance"],
  notify: ["ACS::MessageService::Topic", "ACS::RocketMQ::Topic", "ACS::Ons::Topic"],
};

async function createResourceCenterClient(profileName: string): Promise<any | null> {
  try {
    const config = await createAliyunConfig(profileName, "cn-hangzhou");
    if (!config) return null;
    config.endpoint = "resourcecenter.aliyuncs.com";
    const rcModule = await import('@alicloud/resourcecenter20221201');
    const RC = (rcModule as any).default?.default || (rcModule as any).default || rcModule;
    return new RC(config);
  } catch (e: any) {
    logAliyunAuthError(profileName, e);
    return null;
  }
}

export async function collectAliyunResourcesByCenter(
  profileName: string, type: string, region: string
): Promise<any[]> {
  const client = await createResourceCenterClient(profileName);
  if (!client) return [];
  const resourceTypes = RESOURCE_TYPE_MAP[type];
  if (!resourceTypes) { log.debug(`未知资源类型：${type}`); return []; }
  const rawItems: any[] = [];
  for (const resourceType of resourceTypes) {
    try {
      const request = new $ResourceCenter20221201.SearchResourcesRequest({ resourceTypes: [resourceType], maxResults: 100 });
      if (region !== "global") request.regions = [region];
      let nextToken: string | undefined;
      do {
        if (nextToken) request.nextToken = nextToken;
        const resp = await client.searchResources(request);
        rawItems.push(...(resp.body?.resources || []));
        nextToken = resp.body?.nextToken;
      } while (nextToken);
    } catch (e: any) {
      log.debug(`资源中心采集失败 ${profileName}/${type}/${resourceType}: ${e.message}`);
    }
  }
  log.debug(`资源中心 ${profileName}/${type}/${region}: ${rawItems.length}`);
  return rawItems;
}

export async function collectMultiAccountResourcesByCenter(
  profileName: string, type: string, region: string, resourceDirectoryId: string
): Promise<any[]> {
  const client = await createResourceCenterClient(profileName);
  if (!client) return [];
  const resourceTypes = RESOURCE_TYPE_MAP[type];
  if (!resourceTypes) { log.debug(`未知资源类型：${type}`); return []; }
  const rawItems: any[] = [];
  for (const resourceType of resourceTypes) {
    try {
      const request = new $ResourceCenter20221201.SearchMultiAccountResourcesRequest({
        scope: resourceDirectoryId, resourceTypes: [resourceType], maxResults: 100,
      });
      if (region !== "global") request.regions = [region];
      log.debug(`RC 请求：scope=${resourceDirectoryId}, type=${resourceType}, region=${region}`);
      let nextToken: string | undefined;
      do {
        if (nextToken) request.nextToken = nextToken;
        const resp = await client.searchMultiAccountResources(request);
        const items = resp.body?.resources || [];
        log.debug(`RC 响应：${items.length} 条记录`);
        rawItems.push(...items);
        nextToken = resp.body?.nextToken;
      } while (nextToken);
    } catch (e: any) {
      log.debug(`多账号资源中心采集失败 ${profileName}/${type}/${resourceType}: ${e.message}`);
    }
  }
  log.debug(`多账号资源中心 ${profileName}/${type}/${region}: ${rawItems.length}`);
  return rawItems;
}


export async function getMultiAccountResourceCounts(
  profileName: string, resourceDirectoryId: string
): Promise<Map<string, number>> {
  const client = await createResourceCenterClient(profileName);
  const counts = new Map<string, number>();
  if (!client) return counts;
  try {
    const resp = await client.getMultiAccountResourceCounts(
      new $ResourceCenter20221201.GetMultiAccountResourceCountsRequest({ scope: resourceDirectoryId, groupByKey: "ResourceType" })
    );
    for (const item of resp.body?.resourceCounts || []) {
      if (item.groupName && item.count !== undefined) counts.set(item.groupName, item.count);
    }
    log.debug(`资源数量统计：${counts.size} 种类型`);
  } catch (e: any) {
    log.debug(`获取资源数量失败: ${e.message}`);
  }
  return counts;
}
