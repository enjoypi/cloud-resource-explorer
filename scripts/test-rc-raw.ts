import { collectMultiAccountResourcesByCenter } from "../dist/adapters/aliyun-resource-center.js";
import { getResourceDirectoryId } from "../dist/adapters/aliyun-resource-directory.js";

const profileName = process.argv[2] || "default";

async function main() {
  const rdId = await getResourceDirectoryId(profileName);
  if (!rdId) {
    console.error("未找到资源目录 ID");
    return;
  }

  const resources = await collectMultiAccountResourcesByCenter(profileName, "compute", "global", rdId);

  if (resources.length > 0) {
    console.log("第一个资源的原始数据:\n");
    console.log(JSON.stringify(resources[0], null, 2));
  } else {
    console.log("未找到资源");
  }
}

main().catch(console.error);
