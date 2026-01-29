import { extractProject } from "./profile-adapter.js";

export function extractIdFromArn(arn: string): string {
  const parts = arn.split(":");
  if (parts.length >= 6) {
    const resource = parts.slice(5).join(":");
    if (resource.includes("/")) return resource.split("/").pop() || resource;
    if (resource.includes(":")) return resource.split(":").pop() || resource;
    return resource;
  }
  return arn;
}

function extractTagsFromProperties(properties: any[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const prop of properties || []) {
    if (prop.Name === "tags" && prop.Data) {
      try {
        const tagData = typeof prop.Data === "string" ? JSON.parse(prop.Data) : prop.Data;
        if (Array.isArray(tagData)) {
          for (const t of tagData) if (t.Key && t.Value) tags[t.Key] = t.Value;
        } else if (typeof tagData === "object") {
          Object.assign(tags, tagData);
        }
      } catch {}
    }
  }
  return tags;
}

function findProperty(properties: any[], names: string[]): any | undefined {
  for (const prop of properties || []) {
    if (names.includes(prop.Name) && prop.Data) return prop.Data;
  }
  return undefined;
}

function formatDate(d: any): string | undefined {
  if (!d) return undefined;
  if (d instanceof Date) return d.toISOString();
  if (typeof d === "string") return d;
  return undefined;
}

export interface PropertyFields {
  tags: Record<string, string>;
  name: string;
  status?: string;
  spec?: string;
  engine?: string;
  createdAt?: string;
}

export function extractPropertyFields(properties: any[], arn: string): PropertyFields {
  const tags = extractTagsFromProperties(properties);
  const nameData = findProperty(properties, ["name", "Name"]);
  const name = nameData ? String(nameData) : (tags["Name"] || extractIdFromArn(arn));

  const statusData = findProperty(properties, ["state", "status", "State", "Status"]);
  let status: string | undefined;
  if (typeof statusData === "string") status = statusData;
  else if (typeof statusData === "object" && statusData?.Name) status = statusData.Name;

  const specKeys = ["dbinstanceclass", "instancetype", "instanceType", "DBInstanceClass", "InstanceType", "nodetype", "cacheNodeType"];
  const spec = findProperty(properties, specKeys) as string | undefined;

  const engine = findProperty(properties, ["engine", "Engine"]) as string | undefined;

  const createdAtKeys = ["launchTime", "LaunchTime", "createTime", "CreateTime", "creationDate", "CreationDate", "createDate", "CreateDate"];
  const createdAt = formatDate(findProperty(properties, createdAtKeys));

  return { tags, name, status, spec, engine, createdAt };
}

export function convertAWSResourceExplorerRaw(
  raw: any[], profile: string, _type: string, _region: string
): any[] {
  return raw.map(item => {
    const fields = extractPropertyFields(item.Properties, item.Arn || "");
    return {
      cloud: "aws" as const, profile,
      accountId: item.OwningAccountId,
      type: item.ResourceType || _type,
      id: extractIdFromArn(item.Arn || ""),
      name: fields.name,
      region: item.Region || "global",
      project: extractProject(fields.tags),
      tags: fields.tags,
      status: fields.status, spec: fields.spec, engine: fields.engine,
      collectedAt: new Date(),
      createdAt: fields.createdAt || formatDate(item.LastReportedAt),
      arn: item.Arn,
    };
  });
}
