import * as $ResourceCenter20221201 from '@alicloud/resourcecenter20221201';
import { createAliyunConfig } from "../src/adapters/aliyun-credentials.js";

async function main() {
  const profileName = process.argv[2] || "happy-rd";
  const config = await createAliyunConfig(profileName, "cn-hangzhou");
  if (!config) { console.error("无法创建配置"); return; }

  config.endpoint = "resourcecenter.aliyuncs.com";
  const rcModule = await import('@alicloud/resourcecenter20221201');
  const RC = (rcModule as any).default?.default || (rcModule as any).default || rcModule;
  const client = new RC(config);

  const request = new $ResourceCenter20221201.SearchResourcesRequest({
    resourceTypes: ["ACS::RAM::User"],
    maxResults: 10,
  });

  const resp = await client.searchResources(request);
  console.log("RAM 用户数据示例:");
  console.log(JSON.stringify(resp.body?.resources?.slice(0, 3), null, 2));
}

main().catch(console.error);
