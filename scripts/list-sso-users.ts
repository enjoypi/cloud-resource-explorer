import { SSOAdminClient, ListInstancesCommand } from "@aws-sdk/client-sso-admin";
import { IdentitystoreClient, ListUsersCommand } from "@aws-sdk/client-identitystore";
import { parseAWSSSOSessions, listSSOAccounts, getSSOCredentials } from "../dist/adapters/aws-sso.js";

const sessionName = process.argv[2] || "aws-zf";

async function main() {
  const sessions = parseAWSSSOSessions();
  const session = sessions.find(s => s.name === sessionName);
  if (!session) {
    console.log(`未找到 SSO session: ${sessionName}`);
    console.log(`可用的 sessions: ${sessions.map(s => s.name).join(", ")}`);
    return;
  }

  console.log(`SSO Session: ${session.name}, Region: ${session.region}\n`);

  const accounts = await listSSOAccounts(session);
  if (accounts.length === 0) {
    console.log("未找到 SSO 账号，请先登录");
    return;
  }

  // 使用第一个账号获取凭证
  const account = accounts[0];
  const creds = await getSSOCredentials(session, account.accountId, session.roleName || "ReadOnlyAccess");
  if (!creds) {
    console.log("获取凭证失败");
    return;
  }

  const credentials = {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
  };

  // 获取 Identity Store ID
  const adminClient = new SSOAdminClient({ region: session.region, credentials });
  const instancesResp = await adminClient.send(new ListInstancesCommand({}));
  const instance = instancesResp.Instances?.[0];
  if (!instance?.IdentityStoreId) {
    console.log("未找到 Identity Store ID");
    return;
  }

  console.log(`Identity Store ID: ${instance.IdentityStoreId}\n`);

  // 列出用户
  const idClient = new IdentitystoreClient({ region: session.region, credentials });
  const usersResp = await idClient.send(new ListUsersCommand({ IdentityStoreId: instance.IdentityStoreId }));

  console.log(`用户列表 (${usersResp.Users?.length || 0}):`);
  for (const user of usersResp.Users || []) {
    const email = user.Emails?.find(e => e.Primary)?.Value || user.Emails?.[0]?.Value || "";
    console.log(`  ${user.UserName} | ${user.DisplayName} | ${email} | ${user.UserStatus}`);
  }
}

main().catch(console.error);
