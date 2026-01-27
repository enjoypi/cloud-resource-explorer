import * as $ResourceCenter20221201 from "@alicloud/resourcecenter20221201";
import { ResourceExplorer2Client, ListSupportedResourceTypesCommand } from "@aws-sdk/client-resource-explorer-2";
import { createAliyunConfig } from "../dist/adapters/aliyun-credentials.js";
import { parseAWSSSOSessions, listSSOAccounts, getSSOCredentials } from "../dist/adapters/aws-sso.js";

const cloud = process.argv[2] || "aliyun";
const profileName = process.argv[3] || (cloud === "aws" ? "aws-zf" : "default");

async function listAliyunTypes(profile: string) {
  const config = await createAliyunConfig(profile, "cn-hangzhou");
  if (!config) {
    console.error("创建配置失败");
    return;
  }
  config.endpoint = "resourcecenter.aliyuncs.com";

  const rcModule = await import("@alicloud/resourcecenter20221201");
  const RC = (rcModule as any).default?.default || (rcModule as any).default || rcModule;
  const client = new RC(config);

  const request = new $ResourceCenter20221201.ListResourceTypesRequest({});
  const resp = await client.listResourceTypes(request);
  const types = resp.body?.resourceTypes || [];

  console.log(`阿里云支持的资源类型 (${types.length} 种):\n`);
  for (const t of types) {
    console.log(t.resourceType);
  }
}

async function listAWSTypes(sessionName: string) {
  const sessions = parseAWSSSOSessions();
  const session = sessions.find(s => s.name === sessionName);
  if (!session) {
    console.log(`未找到 SSO session: ${sessionName}`);
    return;
  }

  const accounts = await listSSOAccounts(session);
  if (accounts.length === 0) {
    console.log("未找到 SSO 账号");
    return;
  }

  const account = accounts[0];
  const creds = await getSSOCredentials(session, account.accountId, session.roleName || "ReadOnlyAccess");
  if (!creds) {
    console.log("获取凭证失败");
    return;
  }

  const client = new ResourceExplorer2Client({
    region: "us-east-1",
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
  });

  const types: { service: string; resourceType: string }[] = [];
  let nextToken: string | undefined;

  do {
    const resp = await client.send(new ListSupportedResourceTypesCommand({ NextToken: nextToken }));
    for (const t of resp.ResourceTypes || []) {
      if (t.ResourceType && t.Service) {
        types.push({ service: t.Service, resourceType: t.ResourceType });
      }
    }
    nextToken = resp.NextToken;
  } while (nextToken);

  types.sort((a, b) => a.resourceType.localeCompare(b.resourceType));

  console.log(`AWS 支持的资源类型 (${types.length} 种):\n`);
  for (const t of types) {
    console.log(`${t.resourceType} (${t.service})`);
  }
}

async function main() {
  if (cloud === "aws") {
    await listAWSTypes(profileName);
  } else {
    await listAliyunTypes(profileName);
  }
}

main().catch(e => console.error(e.message));
