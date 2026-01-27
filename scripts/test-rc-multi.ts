import { collectMultiAccountResourcesByCenter } from "../dist/adapters/aliyun-resource-center.js";
import { getResourceDirectoryId } from "../dist/adapters/aliyun-resource-directory.js";

const profileName = process.argv[2] || "default";
const resourceType = process.argv[3] || "compute";

async function main() {
  const rdId = await getResourceDirectoryId(profileName);
  if (!rdId) {
    console.error("未找到资源目录 ID");
    return;
  }

  console.log(`Profile: ${profileName}`);
  console.log(`资源目录: ${rdId}`);
  console.log(`资源类型: ${resourceType}\n`);

  const resources = await collectMultiAccountResourcesByCenter(profileName, resourceType, "global", rdId);

  console.log(`查询到 ${resources.length} 个资源:\n`);
  for (const r of resources.slice(0, 10)) {
    console.log(`${r.accountId} - ${r.resourceId} - ${r.resourceName} - ${r.regionId}`);
  }
  if (resources.length > 10) {
    console.log(`... 还有 ${resources.length - 10} 个`);
  }
}

main().catch(e => console.error(e.message));
