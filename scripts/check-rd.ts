import { getResourceDirectoryId, collectAliyunRDAccounts } from "../dist/adapters/aliyun-resource-directory.js";

const profileName = process.argv[2] || "default";

async function main() {
  console.log(`Profile: ${profileName}\n`);

  const rdId = await getResourceDirectoryId(profileName);
  console.log(`资源目录 ID: ${rdId || "未启用"}`);

  if (rdId) {
    const accounts = await collectAliyunRDAccounts(profileName);
    console.log(`\n成员账号 (${accounts.length}):`);
    for (const a of accounts) {
      console.log(`  ${a.accountId} - ${a.name} - ${a.status}`);
    }
  }
}

main().catch(e => console.error(e.message));
