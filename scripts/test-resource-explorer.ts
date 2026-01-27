import { collectAWSResourcesByExplorer } from "../dist/adapters/aws-resource-explorer.js";
import { parseAWSSSOSessions, listSSOAccounts } from "../dist/adapters/aws-sso.js";

const sessionName = process.argv[2] || "aws-zf";
const resourceType = process.argv[3] || "compute";
const viewArn = process.argv[4];

async function main() {
  const sessions = parseAWSSSOSessions();
  const session = sessions.find(s => s.name === sessionName);
  if (!session) {
    console.log(`未找到 SSO session: ${sessionName}`);
    return;
  }

  const accountId = viewArn ? viewArn.split(":")[4] : undefined;

  console.log(`Session: ${session.name}`);
  console.log(`资源类型: ${resourceType}`);
  if (viewArn) console.log(`组织视图: ${viewArn}`);
  console.log();

  const resources = await collectAWSResourcesByExplorer(
    session.name, resourceType, "global", accountId, viewArn
  );

  console.log(`查询到 ${resources.length} 个资源\n`);

  if (viewArn && resources.length > 0) {
    const accounts = await listSSOAccounts(session);
    const byAccount = new Map<string, number>();
    for (const r of resources) {
      const count = byAccount.get(r.OwningAccountId!) || 0;
      byAccount.set(r.OwningAccountId!, count + 1);
    }
    console.log("按账号统计:");
    for (const [aid, count] of byAccount) {
      const name = accounts.find(a => a.accountId === aid)?.accountName || "unknown";
      console.log(`  ${aid} (${name}): ${count}`);
    }
  } else {
    for (const r of resources.slice(0, 10)) {
      console.log(`${r.OwningAccountId} - ${r.Region} - ${r.Arn}`);
    }
    if (resources.length > 10) console.log(`... 还有 ${resources.length - 10} 个`);
  }
}

main().catch(console.error);
