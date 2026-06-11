import { SSOClient, ListAccountsCommand } from "@aws-sdk/client-sso";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface AWSSSOSession {
  name: string;
  startUrl: string;
  region: string;
  roleName?: string;
}

export interface ValidationResult {
  session: string;
  valid: boolean;
  expiredAt?: Date;
  refreshCommand: string;
}

interface SSOCacheEntry {
  startUrl: string;
  accessToken: string;
  expiresAt: string;
}

export function parseAWSSSOSessions(): AWSSSOSession[] {
  const configPath = path.join(os.homedir(), ".aws", "config");
  if (!fs.existsSync(configPath)) return [];
  const content = fs.readFileSync(configPath, "utf-8");
  const sessions: AWSSSOSession[] = [];
  const regex = /\[sso-session\s+([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const next = content.indexOf("[", start);
    const section = next > 0 ? content.slice(start, next) : content.slice(start);
    sessions.push({
      name,
      startUrl: section.match(/sso_start_url\s*=\s*(.+)/)?.[1]?.trim() || "",
      region: section.match(/sso_region\s*=\s*(.+)/)?.[1]?.trim() || "us-east-1",
      roleName: section.match(/sso_role_name\s*=\s*(.+)/)?.[1]?.trim(),
    });
  }
  return sessions;
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

export interface ProfileSSORef {
  sessionName?: string;
  startUrl?: string;
  region?: string;
  roleName?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 解析 [profile X] 段的 SSO 引用（sso_session 或旧式内联 sso_start_url） */
export function parseAWSProfileSSORef(profileName: string): ProfileSSORef | null {
  const configPath = path.join(os.homedir(), ".aws", "config");
  if (!fs.existsSync(configPath)) return null;
  const content = fs.readFileSync(configPath, "utf-8");
  const match = content.match(new RegExp(`\\[profile\\s+${escapeRegExp(profileName)}\\]`));
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const next = content.indexOf("[", start);
  const section = next > 0 ? content.slice(start, next) : content.slice(start);
  return {
    sessionName: section.match(/sso_session\s*=\s*(.+)/)?.[1]?.trim(),
    startUrl: section.match(/sso_start_url\s*=\s*(.+)/)?.[1]?.trim(),
    region: section.match(/sso_region\s*=\s*(.+)/)?.[1]?.trim(),
    roleName: section.match(/sso_role_name\s*=\s*(.+)/)?.[1]?.trim(),
  };
}

export async function validateAWSSSOSession(sessionName: string): Promise<ValidationResult> {
  const sessions = parseAWSSSOSessions();
  let session = sessions.find(s => s.name === sessionName);
  let refreshCommand = `aws sso login --sso-session ${sessionName}`;
  if (!session) {
    // 传入的可能是引用 sso_session 的 profile 名，需解析出实际 session 再校验，
    // 否则刷新提示会错误地把 profile 名当 session 名
    const ref = parseAWSProfileSSORef(sessionName);
    if (ref?.sessionName) {
      session = sessions.find(s => s.name === ref.sessionName);
      refreshCommand = `aws sso login --sso-session ${ref.sessionName}`;
    } else if (ref?.startUrl) {
      // 旧式 profile 内联 SSO 配置（无 sso-session 段）
      session = { name: sessionName, startUrl: ref.startUrl, region: ref.region || "us-east-1" };
      refreshCommand = `aws sso login --profile ${sessionName}`;
    }
  }
  const result: ValidationResult = {
    session: sessionName,
    valid: false,
    refreshCommand,
  };
  if (!session) return result;

  const accessToken = getAccessToken(session.startUrl);
  if (!accessToken) return result;

  try {
    const client = new SSOClient({ region: session.region });
    const response = await client.send(new ListAccountsCommand({ accessToken, maxResults: 1 }));
    if (response.accountList && response.accountList.length >= 0) {
      result.valid = true;
    }
  } catch {}
  return result;
}
