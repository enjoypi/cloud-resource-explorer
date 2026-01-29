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

export async function validateAWSSSOSession(sessionName: string): Promise<ValidationResult> {
  const sessions = parseAWSSSOSessions();
  const session = sessions.find(s => s.name === sessionName);
  const result: ValidationResult = {
    session: sessionName,
    valid: false,
    refreshCommand: `aws sso login --sso-session ${sessionName}`,
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
