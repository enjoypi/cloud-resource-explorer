import { SSOClient, ListAccountsCommand, GetRoleCredentialsCommand } from "@aws-sdk/client-sso";
import { SSOAdminClient, ListInstancesCommand } from "@aws-sdk/client-sso-admin";
import { IdentitystoreClient, ListUsersCommand } from "@aws-sdk/client-identitystore";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "../utils/index.js";
import { 
  parseAWSSSOSessions as parseSessions, 
  validateAWSSSOSession as validateSession,
  type AWSSSOSession as SSOSession,
  type ValidationResult
} from "@cloud-explorer/sso-validator/aws";

export type AWSSSOSession = SSOSession;
export type AWSCredentialValidation = ValidationResult;
export const parseAWSSSOSessions = parseSessions;
export const validateAWSSSOSession = validateSession;

export interface AWSSSOAccount {
  accountId: string;
  accountName: string;
  emailAddress: string;
}

export interface AWSSSOUser {
  userId: string;
  userName: string;
  displayName: string;
  email: string;
  status: string;
}

interface SSOCacheEntry {
  startUrl: string;
  accessToken: string;
  expiresAt: string;
}

function getAccessToken(startUrl: string): string | null {
  const cachePath = path.join(os.homedir(), ".aws", "sso", "cache");
  if (!fs.existsSync(cachePath)) return null;
  try {
    for (const file of fs.readdirSync(cachePath).filter(f => f.endsWith(".json"))) {
      const content = JSON.parse(fs.readFileSync(path.join(cachePath, file), "utf-8")) as SSOCacheEntry;
      if (content.startUrl === startUrl && content.expiresAt && new Date(content.expiresAt) > new Date()) {
        return content.accessToken;
      }
    }
  } catch {}
  return null;
}

export async function listSSOAccounts(session: AWSSSOSession): Promise<AWSSSOAccount[]> {
  const accessToken = getAccessToken(session.startUrl);
  if (!accessToken) {
    log.warn(`SSO session ${session.name} 未登录或已过期，请运行：aws sso login --sso-session ${session.name}`);
    return [];
  }
  const accounts: AWSSSOAccount[] = [];
  try {
    const client = new SSOClient({ region: session.region });
    let nextToken: string | undefined;
    do {
      const response = await client.send(new ListAccountsCommand({ accessToken, nextToken }));
      for (const account of response.accountList || []) {
        if (account.accountId) {
          accounts.push({
            accountId: account.accountId,
            accountName: account.accountName || account.accountId,
            emailAddress: account.emailAddress || "",
          });
        }
      }
      nextToken = response.nextToken;
    } while (nextToken);
  } catch (e: any) {
    log.debug(`SSO 账号列表获取失败 ${session.name}: ${e.message}`);
  }
  return accounts;
}

export async function getSSOCredentials(
  session: AWSSSOSession, accountId: string, roleName: string
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string } | null> {
  const accessToken = getAccessToken(session.startUrl);
  if (!accessToken) {
    log.warn(`SSO session ${session.name} 未登录`);
    return null;
  }
  try {
    const client = new SSOClient({ region: session.region });
    const response = await client.send(new GetRoleCredentialsCommand({ accessToken, accountId, roleName }));
    if (response.roleCredentials) {
      return {
        accessKeyId: response.roleCredentials.accessKeyId!,
        secretAccessKey: response.roleCredentials.secretAccessKey!,
        sessionToken: response.roleCredentials.sessionToken!,
      };
    }
  } catch (e: any) {
    log.debug(`SSO 凭证获取失败 ${session.name}/${accountId}: ${e.message}`);
  }
  return null;
}

async function getIdentityStoreId(session: AWSSSOSession): Promise<string | null> {
  try {
    const client = new SSOAdminClient({ region: session.region });
    const response = await client.send(new ListInstancesCommand({}));
    const instance = response.Instances?.[0];
    if (instance?.IdentityStoreId) {
      log.debug(`SSO Instance: ${instance.InstanceArn}, IdentityStoreId: ${instance.IdentityStoreId}`);
      return instance.IdentityStoreId;
    }
  } catch (e: any) {
    log.debug(`获取 Identity Store ID 失败：${e.message}`);
  }
  return null;
}

export async function listSSOUsers(session: AWSSSOSession): Promise<AWSSSOUser[]> {
  const identityStoreId = await getIdentityStoreId(session);
  if (!identityStoreId) {
    log.warn(`无法获取 Identity Store ID`);
    return [];
  }
  const users: AWSSSOUser[] = [];
  try {
    const client = new IdentitystoreClient({ region: session.region });
    let nextToken: string | undefined;
    do {
      const response = await client.send(new ListUsersCommand({ IdentityStoreId: identityStoreId, NextToken: nextToken }));
      for (const user of response.Users || []) {
        users.push({
          userId: user.UserId || "",
          userName: user.UserName || "",
          displayName: user.DisplayName || "",
          email: user.Emails?.find(e => e.Primary)?.Value || user.Emails?.[0]?.Value || "",
          status: user.UserStatus || "UNKNOWN",
        });
      }
      nextToken = response.NextToken;
    } while (nextToken);
    log.info(` SSO Users: ${users.length}`);
  } catch (e: any) {
    log.debug(`SSO 用户列表获取失败：${e.message}`);
  }
  return users;
}
