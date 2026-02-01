import {
  IAMClient, ListAccessKeysCommand, GetAccessKeyLastUsedCommand,
  ListMFADevicesCommand, GetLoginProfileCommand, ListAttachedUserPoliciesCommand,
  ListGroupsForUserCommand, GetUserCommand, ListUserPoliciesCommand,
  GetUserPolicyCommand, GetPolicyCommand, GetPolicyVersionCommand,
  ListAttachedGroupPoliciesCommand, ListGroupPoliciesCommand, GetGroupPolicyCommand,
  GenerateCredentialReportCommand, GetCredentialReportCommand,
} from "@aws-sdk/client-iam";
import type { AWSIAMUserDetail, PolicyDetail, CredentialReportRow } from "../entities/iam-audit.js";
import { resolveAWSCredentials } from "./aws-client-factory.js";
import { parsePolicyDocument } from "./iam-audit-utils.js";
import { log } from "../utils/index.js";
import { TIMEOUT, PAGINATION } from "../constants.js";

export interface IAMUserFromExplorer { userName: string; userId: string; arn: string; accountId: string; }

export async function createIAMClient(profileName: string, accountId: string): Promise<IAMClient> {
  const credentials = await resolveAWSCredentials(profileName, accountId);
  return new IAMClient({ credentials, region: "us-east-1" });
}

export function extractIAMUsersFromExplorer(resources: any[]): IAMUserFromExplorer[] {
  return resources.filter(r => r.type === "iam" && r.arn?.includes(":user/")).map(r => ({ userName: r.name || r.id, userId: r.id, arn: r.arn, accountId: r.accountId }));
}

async function waitForCredentialReport(client: IAMClient, maxWaitMs = TIMEOUT.CREDENTIAL_REPORT_MAX_WAIT): Promise<string> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try { await client.send(new GenerateCredentialReportCommand({})); } catch (e: any) { if (e.name !== "LimitExceededException") throw e; }
    await new Promise(resolve => setTimeout(resolve, TIMEOUT.CREDENTIAL_REPORT_RETRY_INTERVAL));
    try {
      const resp = await client.send(new GetCredentialReportCommand({}));
      if (resp.Content) return Buffer.from(resp.Content).toString("utf-8");
    } catch (e: any) { if (e.name !== "ReportNotPresentException" && e.name !== "ReportInProgressException") throw e; }
  }
  throw new Error("生成 Credential Report 超时");
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "", inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { values.push(current); current = ""; }
    else current += char;
  }
  values.push(current);
  return values;
}

function parseCredentialReportCSV(csv: string): CredentialReportRow[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row: any = {};
    headers.forEach((h, i) => row[h] = values[i] || "N/A");
    return row as CredentialReportRow;
  });
}

export async function downloadCredentialReport(profileName: string, accountId: string): Promise<{ csv: string; rows: CredentialReportRow[] }> {
  const client = await createIAMClient(profileName, accountId);
  const csv = await waitForCredentialReport(client);
  return { csv, rows: parseCredentialReportCSV(csv) };
}

async function getManagedPolicyStatements(client: IAMClient, policyArn: string) {
  const policyResp = await client.send(new GetPolicyCommand({ PolicyArn: policyArn }));
  const versionId = policyResp.Policy?.DefaultVersionId;
  if (!versionId) return [];
  const versionResp = await client.send(new GetPolicyVersionCommand({ PolicyArn: policyArn, VersionId: versionId }));
  return parsePolicyDocument(versionResp.PolicyVersion?.Document || "{}", true);
}

async function collectUserPolicies(client: IAMClient, userName: string, attachedPolicies: Array<{ policyName: string; policyArn: string }>, groups: string[]): Promise<PolicyDetail[]> {
  const policies: PolicyDetail[] = [];
  for (const p of attachedPolicies) {
    try { policies.push({ policyName: p.policyName, policyArn: p.policyArn, policyType: "managed", isAWSManaged: p.policyArn.includes(":aws:policy/"), statements: await getManagedPolicyStatements(client, p.policyArn) }); }
    catch (e) { log.debug(`获取托管策略内容失败 ${p.policyName}: ${e}`); }
  }
  try {
    const inlineResp = await client.send(new ListUserPoliciesCommand({ UserName: userName }));
    for (const policyName of inlineResp.PolicyNames || []) {
      try {
        const policyResp = await client.send(new GetUserPolicyCommand({ UserName: userName, PolicyName: policyName }));
        policies.push({ policyName, policyType: "inline", statements: parsePolicyDocument(policyResp.PolicyDocument || "{}", true) });
      } catch (e) { log.debug(`获取内联策略内容失败 ${policyName}: ${e}`); }
    }
  } catch (e) { log.debug(`获取内联策略列表失败 ${userName}: ${e}`); }
  for (const groupName of groups) {
    try {
      const attachedResp = await client.send(new ListAttachedGroupPoliciesCommand({ GroupName: groupName }));
      for (const p of attachedResp.AttachedPolicies || []) {
        try { policies.push({ policyName: `${groupName}/${p.PolicyName}`, policyArn: p.PolicyArn, policyType: "group-managed", isAWSManaged: p.PolicyArn?.includes(":aws:policy/"), statements: await getManagedPolicyStatements(client, p.PolicyArn!) }); }
        catch (e) { log.debug(`获取组托管策略失败 ${p.PolicyName}: ${e}`); }
      }
    } catch (e) { log.debug(`获取组附加策略失败 ${groupName}: ${e}`); }
    try {
      const inlineResp = await client.send(new ListGroupPoliciesCommand({ GroupName: groupName }));
      for (const policyName of inlineResp.PolicyNames || []) {
        try {
          const policyResp = await client.send(new GetGroupPolicyCommand({ GroupName: groupName, PolicyName: policyName }));
          policies.push({ policyName: `${groupName}/${policyName}`, policyType: "group-inline", statements: parsePolicyDocument(policyResp.PolicyDocument || "{}", true) });
        } catch (e) { log.debug(`获取组内联策略失败 ${policyName}: ${e}`); }
      }
    } catch (e) { log.debug(`获取组内联策略列表失败 ${groupName}: ${e}`); }
  }
  return policies;
}

async function collectUserDetail(client: IAMClient, userName: string, arn: string): Promise<AWSIAMUserDetail> {
  const userResp = await client.send(new GetUserCommand({ UserName: userName }));
  const user = userResp.User!;
  const detail: AWSIAMUserDetail = { userName: user.UserName!, userId: user.UserId!, arn: user.Arn || arn, createDate: user.CreateDate!, passwordLastUsed: user.PasswordLastUsed, accessKeys: [], mfaDevices: [], attachedPolicies: [], groups: [], policies: [] };
  try {
    const keysResp = await client.send(new ListAccessKeysCommand({ UserName: userName }));
    for (const key of keysResp.AccessKeyMetadata || []) {
      const lastUsed = await client.send(new GetAccessKeyLastUsedCommand({ AccessKeyId: key.AccessKeyId }));
      detail.accessKeys.push({ accessKeyId: key.AccessKeyId!, status: key.Status as "Active" | "Inactive", createDate: key.CreateDate!, lastUsedDate: lastUsed.AccessKeyLastUsed?.LastUsedDate, lastUsedRegion: lastUsed.AccessKeyLastUsed?.Region, lastUsedService: lastUsed.AccessKeyLastUsed?.ServiceName });
    }
  } catch (e) { log.debug(`获取 AccessKey 失败 ${userName}: ${e}`); }
  try { const mfaResp = await client.send(new ListMFADevicesCommand({ UserName: userName })); detail.mfaDevices = (mfaResp.MFADevices || []).map(d => ({ serialNumber: d.SerialNumber!, enableDate: d.EnableDate! })); } catch (e) { log.debug(`获取 MFA 失败 ${userName}: ${e}`); }
  try { const loginResp = await client.send(new GetLoginProfileCommand({ UserName: userName })); detail.loginProfile = { createDate: loginResp.LoginProfile!.CreateDate!, passwordResetRequired: loginResp.LoginProfile!.PasswordResetRequired || false }; } catch (e: any) { if (e.name !== "NoSuchEntityException") log.debug(`获取登录配置失败 ${userName}: ${e}`); }
  try { const policiesResp = await client.send(new ListAttachedUserPoliciesCommand({ UserName: userName })); detail.attachedPolicies = (policiesResp.AttachedPolicies || []).map(p => ({ policyName: p.PolicyName!, policyArn: p.PolicyArn! })); } catch (e) { log.debug(`获取策略失败 ${userName}: ${e}`); }
  try { const groupsResp = await client.send(new ListGroupsForUserCommand({ UserName: userName })); detail.groups = (groupsResp.Groups || []).map(g => g.GroupName!); } catch (e) { log.debug(`获取组失败 ${userName}: ${e}`); }
  detail.policies = await collectUserPolicies(client, userName, detail.attachedPolicies, detail.groups);
  return detail;
}

export async function collectAWSIAMUsersFromList(profileName: string, accountId: string, userList: IAMUserFromExplorer[]): Promise<AWSIAMUserDetail[]> {
  const client = await createIAMClient(profileName, accountId);
  const users: AWSIAMUserDetail[] = [];
  for (const user of userList) {
    try { users.push(await collectUserDetail(client, user.userName, user.arn)); }
    catch (e: any) { log.debug(`采集用户详情失败 ${user.userName}: ${e.message}`); }
  }
  return users;
}
