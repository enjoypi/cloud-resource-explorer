import * as $ResourceCenter20221201 from "@alicloud/resourcecenter20221201";
import { createAliyunConfig } from "../dist/adapters/aliyun-credentials.js";
import { getResourceDirectoryId } from "../dist/adapters/aliyun-resource-directory.js";

const profileName = process.argv[2] || "default";
const filterPrefix = process.argv[3] || "";

async function main() {
  const rdId = await getResourceDirectoryId(profileName);
  if (!rdId) {
    console.error("未找到资源目录 ID");
    return;
  }

  console.log(`Profile: ${profileName}`);
  console.log(`资源目录：${rdId}`);
  if (filterPrefix) console.log(`过滤：${filterPrefix}*`);
  console.log();

  const config = await createAliyunConfig(profileName, "cn-hangzhou");
  if (!config) return;
  config.endpoint = "resourcecenter.aliyuncs.com";

  const rcModule = await import("@alicloud/resourcecenter20221201");
  const RC = (rcModule as any).default?.default || (rcModule as any).default || rcModule;
  const client = new RC(config);

  const request = new $ResourceCenter20221201.GetMultiAccountResourceCountsRequest({
    scope: rdId,
    groupByKey: "ResourceType",
  });

  const resp = await client.getMultiAccountResourceCounts(request);
  let counts = resp.body?.resourceCounts || [];

  if (filterPrefix) {
    counts = counts.filter((item: any) => item.groupName?.startsWith(filterPrefix));
  }

  let total = 0;
  const sorted = counts.sort((a: any, b: any) => (b.count || 0) - (a.count || 0));

  console.log("资源数量统计:\n");
  for (const item of sorted) {
    console.log(`  ${item.groupName}: ${item.count}`);
    total += item.count || 0;
  }
  console.log(`\n总计：${total} 个资源`);
}

main().catch(e => console.error(e.message));
