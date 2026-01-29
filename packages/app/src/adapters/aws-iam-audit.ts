import type { AWSIAMUserDetail, IAMAuditConfig, IAMRiskFinding, PolicyDetail, CredentialReportRow, RiskType, RiskLevel } from "../entities/iam-audit.js";
import { hasAdminAccess, findDangerousActions, findWildcardResources, AWS_DANGEROUS_ACTIONS, daysSince, createFinding } from "./iam-audit-utils.js";

export { extractIAMUsersFromExplorer, collectAWSIAMUsersFromList, downloadCredentialReport, type IAMUserFromExplorer } from "./aws-iam-collector.js";

export function analyzeAWSIAMRisks(users: AWSIAMUserDetail[], profile: string, accountId: string, config: IAMAuditConfig): IAMRiskFinding[] {
  const findings: IAMRiskFinding[] = [];
  const f = (u: AWSIAMUserDetail, type: RiskType, level: RiskLevel, desc: string, detail: string, rec: string) =>
    createFinding("aws", profile, accountId, u.userName, u.userId, type, level, desc, detail, rec);

  for (const user of users) {
    const activeKeys = user.accessKeys.filter(k => k.status === "Active");
    for (const key of activeKeys) {
      const ageDays = daysSince(key.createDate);
      if (ageDays > config.accessKeyMaxAgeDays) {
        findings.push(f(user, "ACCESS_KEY_OLD", "HIGH", `AccessKey ${key.accessKeyId.slice(-4)} 已创建 ${ageDays} 天`,
          `创建时间: ${key.createDate.toISOString().split("T")[0]}`, "建议轮换 AccessKey"));
      }
      if (key.lastUsedDate && daysSince(key.lastUsedDate) > config.accessKeyUnusedDays) {
        findings.push(f(user, "ACCESS_KEY_UNUSED", "MEDIUM", `AccessKey ${key.accessKeyId.slice(-4)} 已 ${daysSince(key.lastUsedDate)} 天未使用`,
          `最后使用: ${key.lastUsedDate.toISOString().split("T")[0]}`, "建议禁用或删除长期未使用的 AccessKey"));
      }
    }
    if (activeKeys.length > 1) {
      findings.push(f(user, "ACCESS_KEY_MULTIPLE", "LOW", `用户有 ${activeKeys.length} 个活跃的 AccessKey`,
        `AccessKey: ${activeKeys.map(k => k.accessKeyId.slice(-4)).join(", ")}`, "建议仅保留一个活跃的 AccessKey，禁用或删除多余的"));
    }
    if (user.mfaDevices.length === 0 && user.loginProfile) {
      findings.push(f(user, "MFA_NOT_ENABLED", "HIGH", "控制台用户未启用 MFA",
        `Console: 已启用，AccessKey: ${user.accessKeys.length} 个`, "建议启用 MFA 以增强账户安全"));
    }
    if (user.accessKeys.length > 0 && !user.loginProfile) {
      findings.push(f(user, "CONSOLE_NO_PASSWORD", "INFO", "程序访问账号（有 AccessKey 无 Console）",
        `AccessKey: ${user.accessKeys.length} 个`, "确认是否为程序访问账号"));
    }
    if (user.loginProfile && user.passwordLastUsed && daysSince(user.passwordLastUsed) > config.lastLoginMaxDays) {
      findings.push(f(user, "CONSOLE_NO_LOGIN", "MEDIUM", `用户已 ${daysSince(user.passwordLastUsed)} 天未登录控制台`,
        `最后登录: ${user.passwordLastUsed.toISOString().split("T")[0]}`, "建议确认用户是否仍需要控制台访问权限"));
    }
    if (user.loginProfile && !user.passwordLastUsed) {
      findings.push(f(user, "CONSOLE_NO_LOGIN", "LOW", "控制台用户从未登录过",
        `创建时间: ${user.createDate.toISOString().split("T")[0]}`, "建议确认用户是否需要控制台访问权限"));
    }
    if (user.attachedPolicies.length > config.maxDirectPolicies) {
      findings.push(f(user, "TOO_MANY_DIRECT_POLICIES", "MEDIUM", `用户直接附加了 ${user.attachedPolicies.length} 个策略`,
        `策略: ${user.attachedPolicies.map(p => p.policyName).join(", ")}`, "建议通过 IAM 组管理权限"));
    }
    const admin = hasAdminAccess(user.policies);
    if (admin.found) {
      findings.push(f(user, "ADMIN_ACCESS", "HIGH", "用户拥有管理员权限",
        `来源: ${admin.policies.join(", ")}`, "建议遵循最小权限原则，移除不必要的管理员权限"));
    }
    const dangerous = findDangerousActions(user.policies, AWS_DANGEROUS_ACTIONS);
    if (dangerous.actions.length > 0 && !admin.found) {
      findings.push(f(user, "DANGEROUS_ACTIONS", "HIGH", `用户拥有 ${dangerous.actions.length} 个危险操作权限`,
        `操作: ${dangerous.actions.slice(0, 5).join(", ")}${dangerous.actions.length > 5 ? "..." : ""}`, "建议审查并移除不必要的危险操作权限"));
    }
    const wildcard = findWildcardResources(user.policies);
    if (wildcard.count > 0 && !admin.found) {
      findings.push(f(user, "WILDCARD_RESOURCE", "MEDIUM", `用户有 ${wildcard.count} 条策略使用资源通配符 *`,
        `策略: ${wildcard.policies.join(", ")}`, "建议限定具体资源 ARN，避免使用通配符"));
    }
  }
  return findings;
}

function parseReportDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === "N/A" || dateStr === "no_information" || dateStr === "not_supported") return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

export function analyzeCredentialReportRisks(rows: CredentialReportRow[], profile: string, accountId: string, config: IAMAuditConfig): IAMRiskFinding[] {
  const findings: IAMRiskFinding[] = [];
  const f = (userName: string, userId: string, type: RiskType, level: RiskLevel, desc: string, detail: string, rec: string) =>
    createFinding("aws", profile, accountId, userName, userId, type, level, desc, detail, rec);

  for (const row of rows) {
    const isRoot = row.user === "<root_account>";
    const userId = row.arn.split(":")[4] || accountId;

    if (isRoot) {
      if (row.access_key_1_active === "true" || row.access_key_2_active === "true") {
        findings.push(f(row.user, userId, "ACCESS_KEY_OLD", "HIGH", "Root 账号存在活跃的 AccessKey",
          `AK1: ${row.access_key_1_active}, AK2: ${row.access_key_2_active}`, "强烈建议删除 Root 账号的 AccessKey"));
      }
      if (row.mfa_active !== "true") {
        findings.push(f(row.user, userId, "MFA_NOT_ENABLED", "HIGH", "Root 账号未启用 MFA",
          "Root 账号是最高权限账号", "强烈建议为 Root 账号启用 MFA"));
      }
      continue;
    }

    for (const keyNum of [1, 2] as const) {
      const active = row[`access_key_${keyNum}_active` as keyof CredentialReportRow];
      const rotated = row[`access_key_${keyNum}_last_rotated` as keyof CredentialReportRow];
      const lastUsed = row[`access_key_${keyNum}_last_used_date` as keyof CredentialReportRow];
      if (active === "true") {
        const rotatedDate = parseReportDate(rotated as string);
        if (rotatedDate && daysSince(rotatedDate) > config.accessKeyMaxAgeDays) {
          findings.push(f(row.user, userId, "ACCESS_KEY_OLD", "HIGH", `AccessKey ${keyNum} 已创建 ${daysSince(rotatedDate)} 天`,
            `创建时间: ${rotated}`, "建议轮换 AccessKey"));
        }
        const lastUsedDate = parseReportDate(lastUsed as string);
        if (lastUsedDate && daysSince(lastUsedDate) > config.accessKeyUnusedDays) {
          findings.push(f(row.user, userId, "ACCESS_KEY_UNUSED", "MEDIUM", `AccessKey ${keyNum} 已 ${daysSince(lastUsedDate)} 天未使用`,
            `最后使用: ${lastUsed}`, "建议禁用或删除长期未使用的 AccessKey"));
        }
      }
    }

    if (row.password_enabled === "true" && row.mfa_active !== "true") {
      findings.push(f(row.user, userId, "MFA_NOT_ENABLED", "HIGH", "控制台用户未启用 MFA",
        `Console: 已启用，MFA: 未启用`, "建议启用 MFA 以增强账户安全"));
    }
    if (row.password_enabled !== "true" && (row.access_key_1_active === "true" || row.access_key_2_active === "true")) {
      findings.push(f(row.user, userId, "CONSOLE_NO_PASSWORD", "INFO", "程序访问账号（有 AccessKey 无 Console）",
        `AK1: ${row.access_key_1_active}, AK2: ${row.access_key_2_active}`, "确认是否为程序访问账号"));
    }
    if (row.access_key_1_active === "true" && row.access_key_2_active === "true") {
      findings.push(f(row.user, userId, "ACCESS_KEY_MULTIPLE", "LOW", "用户有 2 个活跃的 AccessKey",
        "AK1 和 AK2 均为活跃状态", "建议仅保留一个活跃的 AccessKey，禁用或删除多余的"));
    }
    if (row.password_enabled === "true") {
      const lastLogin = parseReportDate(row.password_last_used);
      if (lastLogin && daysSince(lastLogin) > config.lastLoginMaxDays) {
        findings.push(f(row.user, userId, "RAM_LAST_LOGIN_OLD", "MEDIUM", `用户已 ${daysSince(lastLogin)} 天未登录控制台`,
          `最后登录: ${row.password_last_used}`, "建议检查账号是否仍需使用"));
      }
    }
  }
  return findings;
}
