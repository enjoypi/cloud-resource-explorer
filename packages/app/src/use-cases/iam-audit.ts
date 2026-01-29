import type { Config, Profile } from "../entities/index.js";
import type { IAMAuditConfig, IAMAuditResult, IAMRiskFinding, AWSIAMUserDetail, AliyunRAMUserDetail, CredentialReportRow } from "../entities/iam-audit.js";
import { DEFAULT_AUDIT_CONFIG } from "../entities/iam-audit.js";
import type { ProfileAdapter } from "../adapters/profile-adapter.js";
import {
  collectAWSIAMUsersFromList, extractIAMUsersFromExplorer, analyzeAWSIAMRisks,
  analyzeCredentialReportRisks, downloadCredentialReport, type IAMUserFromExplorer,
} from "../adapters/aws-iam-audit.js";
import { collectAWSResourcesByExplorer, convertAWSResourceExplorerRaw } from "../adapters/aws-resource-explorer.js";
import { listSSOAccounts } from "../adapters/aws-sso.js";
import { collectAliyunRAMUsers, analyzeAliyunRAMRisks } from "../adapters/aliyun-ram-audit.js";
import { collectAliyunRDAccounts } from "../adapters/aliyun-resource-directory.js";
import { filterProfiles } from "./collect.js";
import { log } from "../utils/index.js";

function logAuditResult(cloud: string, id: string, users: number, findings: number): void {
  log.info(`[${cloud}] ${id}: ${users} 用户, ${findings} 风险项`);
}

export interface IAMAuditInput { config: Config; auditConfig?: Partial<IAMAuditConfig>; profileAdapter: ProfileAdapter; fastMode?: boolean; }
export interface IAMAuditOutput { results: IAMAuditResult[]; totalFindings: number; errors: Array<{ profile: string; cloud: string; error: string }>; }

export async function runIAMAudit(input: IAMAuditInput): Promise<IAMAuditOutput> {
  const { config, profileAdapter, fastMode = false } = input;
  const auditConfig = { ...DEFAULT_AUDIT_CONFIG, ...input.auditConfig };

  const results: IAMAuditResult[] = [];
  const errors: Array<{ profile: string; cloud: string; error: string }> = [];

  const clouds: ("aws" | "aliyun")[] = config.cloud === "all" ? ["aws", "aliyun"] : [config.cloud];

  for (const cloud of clouds) {
    if (cloud === "aws") {
      await runAWSIAMAudit(config, profileAdapter, auditConfig, results, errors, fastMode);
    } else {
      await runAliyunRAMAudit(config, profileAdapter, auditConfig, results, errors, fastMode);
    }
  }

  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
  return { results, totalFindings, errors };
}

async function runAWSIAMAudit(
  config: Config, profileAdapter: ProfileAdapter, auditConfig: IAMAuditConfig,
  results: IAMAuditResult[], errors: Array<{ profile: string; cloud: string; error: string }>, fastMode: boolean = false
): Promise<void> {
  const profiles = await profileAdapter.discoverProfiles("aws");
  const filtered = filterProfiles(profiles, config).filter(p => p.cloud === "aws");

  if (filtered.length === 0) { log.warn("[AWS] 没有可用的 Profile"); return; }

  const profile = filtered[0];
  const viewArn = config.aws.resourceExplorerViewArn;
  if (!viewArn) { log.warn("[AWS] 未配置 resourceExplorerViewArn"); return; }

  let aggregatorAccountId = viewArn.split(":")[4];
  if (profile.ssoSession && !aggregatorAccountId) {
    const ssoAccounts = await listSSOAccounts({ name: profile.ssoSession.name, startUrl: profile.ssoSession.startUrl, region: profile.ssoSession.region });
    if (ssoAccounts.length > 0) aggregatorAccountId = ssoAccounts[0].accountId;
  }

  log.info(`[AWS] 使用 Resource Explorer 获取 IAM 用户列表 (聚合器账号: ${aggregatorAccountId})...`);

  try {
    const rawResources = await collectAWSResourcesByExplorer(profile.name, "iam", "global", aggregatorAccountId, viewArn);
    const resources = convertAWSResourceExplorerRaw(rawResources, profile.name, "iam", "global");
    const iamUsers = extractIAMUsersFromExplorer(resources);
    const usersByAccount = groupUsersByAccount(iamUsers);
    log.info(`[AWS] 从 Resource Explorer 获取到 ${iamUsers.length} 个 IAM 用户，涉及 ${usersByAccount.size} 个账号`);

    for (const [accountId, accountUsers] of usersByAccount) {
      try {
        if (fastMode) {
          log.info(`[AWS] 下载账号 ${accountId} 的 Credential Report...`);
          const { rows } = await downloadCredentialReport(profile.name, accountId);
          const findings = analyzeCredentialReportRisks(rows, profile.name, accountId, auditConfig);
          results.push(buildAuditResult("aws", profile.name, accountId, [], findings, rows));
          logAuditResult("AWS", accountId, rows.length, findings.length);
        } else {
          log.info(`[AWS] 审计账号 ${accountId} (${accountUsers.length} 用户)...`);
          const users = await collectAWSIAMUsersFromList(profile.name, accountId, accountUsers);
          const findings = analyzeAWSIAMRisks(users, profile.name, accountId, auditConfig);
          results.push(buildAuditResult("aws", profile.name, accountId, users, findings));
          logAuditResult("AWS", accountId, users.length, findings.length);
        }
      } catch (e: any) {
        log.error(`[AWS] 账号 ${accountId} 审计失败: ${e.message}`);
        errors.push({ profile: profile.name, cloud: "aws", error: `${accountId}: ${e.message}` });
      }
    }
  } catch (e: any) {
    log.error(`[AWS] Resource Explorer 查询失败: ${e.message}`);
    errors.push({ profile: profile.name, cloud: "aws", error: e.message });
  }
}

async function runAliyunRAMAudit(
  config: Config, profileAdapter: ProfileAdapter, auditConfig: IAMAuditConfig,
  results: IAMAuditResult[], errors: Array<{ profile: string; cloud: string; error: string }>,
  fastMode: boolean = false
): Promise<void> {
  const profiles = await profileAdapter.discoverProfiles("aliyun");
  const filtered = filterProfiles(profiles, config).filter(p => p.cloud === "aliyun");

  if (filtered.length === 0) { log.warn("[阿里云] 没有可用的 Profile"); return; }

  const profile = filtered[0];

  if (fastMode) {
    // 快速模式：从 Resource Center 获取多账号 RAM 用户
    await runAliyunRAMFastAudit(profile, config, auditConfig, results, errors);
  } else {
    // 完整模式：逐个账号调用 RAM API
    for (const p of filtered) {
      try {
        const accountId = await profileAdapter.getAccountId(p);
        if (!accountId) { log.warn(`[阿里云] ${p.name}: 无法获取账号 ID，跳过`); continue; }
        log.info(`[阿里云] 审计 ${p.name} (${accountId})...`);
        const users = await collectAliyunRAMUsers(p.name, accountId);
        const findings = analyzeAliyunRAMRisks(users, p.name, accountId, auditConfig);
        results.push(buildAuditResult("aliyun", p.name, accountId, users, findings));
        logAuditResult("阿里云", p.name, users.length, findings.length);
      } catch (e: any) {
        log.error(`[阿里云] ${p.name} 审计失败: ${e.message}`);
        errors.push({ profile: p.name, cloud: "aliyun", error: e.message });
      }
    }
  }
}

async function runAliyunRAMFastAudit(
  profile: Profile, config: Config, auditConfig: IAMAuditConfig,
  results: IAMAuditResult[], errors: Array<{ profile: string; cloud: string; error: string }>
): Promise<void> {
  try {
    // RC 无法正确返回 RAM 资源，改为从资源目录获取账号列表后直接调用 RAM API
    const rdAccounts = await collectAliyunRDAccounts(profile.name);
    if (rdAccounts.length === 0) {
      log.warn(`[阿里云] ${profile.name}: 无法获取资源目录账号列表`);
      return;
    }

    log.info(`[阿里云] 从资源目录获取到 ${rdAccounts.length} 个账号，开始审计...`);

    for (const account of rdAccounts) {
      const accountId = account.id;
      try {
        log.debug(`[阿里云] 审计账号 ${accountId} (${account.name})...`);
        const users = await collectAliyunRAMUsers(profile.name, accountId);
        const findings = analyzeAliyunRAMRisks(users, profile.name, accountId, auditConfig);
        results.push(buildAuditResult("aliyun", profile.name, accountId, users, findings));
        logAuditResult("阿里云", accountId, users.length, findings.length);
      } catch (e: any) {
        log.debug(`[阿里云] 账号 ${accountId} 审计失败: ${e.message}`);
        errors.push({ profile: profile.name, cloud: "aliyun", error: `${accountId}: ${e.message}` });
      }
    }
  } catch (e: any) {
    log.error(`[阿里云] 快速审计失败: ${e.message}`);
    errors.push({ profile: profile.name, cloud: "aliyun", error: e.message });
  }
}

function groupUsersByAccount(users: IAMUserFromExplorer[]): Map<string, IAMUserFromExplorer[]> {
  const map = new Map<string, IAMUserFromExplorer[]>();
  for (const user of users) {
    const list = map.get(user.accountId);
    if (list) list.push(user); else map.set(user.accountId, [user]);
  }
  return map;
}

function calcSummary(findings: IAMRiskFinding[]) {
  return {
    high: findings.filter(f => f.riskLevel === "HIGH").length,
    medium: findings.filter(f => f.riskLevel === "MEDIUM").length,
    low: findings.filter(f => f.riskLevel === "LOW").length,
    info: findings.filter(f => f.riskLevel === "INFO").length,
  };
}

function buildAuditResult(
  cloud: "aws" | "aliyun", profile: string, accountId: string,
  users: AWSIAMUserDetail[] | AliyunRAMUserDetail[], findings: IAMRiskFinding[],
  credentialReport?: CredentialReportRow[]
): IAMAuditResult {
  return {
    cloud, profile, accountId, auditedAt: new Date(),
    totalUsers: credentialReport?.length ?? users.length,
    usersWithRisks: new Set(findings.map(f => f.userName)).size,
    findings, users: credentialReport ? [] : users,
    summary: calcSummary(findings),
    credentialReport,
  };
}
