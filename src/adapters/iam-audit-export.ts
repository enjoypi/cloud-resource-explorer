import * as fs from "node:fs";
import * as path from "node:path";
import type { IAMAuditResult, IAMRiskFinding, RiskLevel, AWSIAMUserDetail, AliyunRAMUserDetail, CredentialReportRow } from "../entities/iam-audit.js";
import { escapeCSV, writeCSV } from "./csv-adapter.js";

const FINDINGS_HEADERS = [
  "Cloud", "Profile", "AccountID", "UserName", "UserID",
  "RiskType", "RiskLevel", "Description", "Detail", "Recommendation", "DetectedAt"
];

const SUMMARY_HEADERS = [
  "Cloud", "Profile", "AccountID", "AuditedAt",
  "TotalUsers", "UsersWithRisks", "HighRisks", "MediumRisks", "LowRisks", "InfoRisks"
];

const USERS_HEADERS = [
  "user", "arn", "user_creation_time", "password_enabled", "password_last_used",
  "mfa_active", "access_key_1_active", "access_key_1_last_rotated", "access_key_1_last_used_date",
  "access_key_1_last_used_region", "access_key_1_last_used_service",
  "access_key_2_active", "access_key_2_last_rotated", "access_key_2_last_used_date",
  "access_key_2_last_used_region", "access_key_2_last_used_service", "groups", "policies"
];

const CREDENTIAL_REPORT_HEADERS = [
  "user", "arn", "user_creation_time", "password_enabled", "password_last_used",
  "password_last_changed", "password_next_rotation", "mfa_active",
  "access_key_1_active", "access_key_1_last_rotated", "access_key_1_last_used_date",
  "access_key_1_last_used_region", "access_key_1_last_used_service",
  "access_key_2_active", "access_key_2_last_rotated", "access_key_2_last_used_date",
  "access_key_2_last_used_region", "access_key_2_last_used_service",
  "cert_1_active", "cert_1_last_rotated", "cert_2_active", "cert_2_last_rotated", "account_id"
];

function findingToRow(f: IAMRiskFinding): string {
  return [
    f.cloud, f.profile, f.accountId, f.userName, f.userId,
    f.riskType, f.riskLevel, escapeCSV(f.description),
    escapeCSV(f.detail), escapeCSV(f.recommendation),
    f.detectedAt.toISOString()
  ].join(",");
}

function writeFindingsByLevel(findings: IAMRiskFinding[], outputDir: string, level: RiskLevel, label: string): void {
  const filtered = findings.filter(f => f.riskLevel === level);
  if (filtered.length > 0) {
    writeCSV(path.join(outputDir, `iam-audit-${level.toLowerCase()}.csv`), FINDINGS_HEADERS, filtered.map(findingToRow), label);
  }
}

function formatDate(d?: Date): string {
  return d ? d.toISOString() : "N/A";
}

function awsUserToRow(u: AWSIAMUserDetail): string {
  const k1 = u.accessKeys[0], k2 = u.accessKeys[1];
  return [
    u.userName, u.arn, formatDate(u.createDate),
    u.loginProfile ? "true" : "false", formatDate(u.passwordLastUsed),
    u.mfaDevices.length > 0 ? "true" : "false",
    k1?.status === "Active" ? "true" : "false", formatDate(k1?.createDate), formatDate(k1?.lastUsedDate),
    k1?.lastUsedRegion || "N/A", k1?.lastUsedService || "N/A",
    k2?.status === "Active" ? "true" : "false", formatDate(k2?.createDate), formatDate(k2?.lastUsedDate),
    k2?.lastUsedRegion || "N/A", k2?.lastUsedService || "N/A",
    escapeCSV(u.groups.join(";")), escapeCSV(u.attachedPolicies.map(p => p.policyName).join(";"))
  ].join(",");
}

function aliyunUserToRow(u: AliyunRAMUserDetail): string {
  const k1 = u.accessKeys[0], k2 = u.accessKeys[1];
  return [
    u.userName, `arn:aliyuncs:ram::${u.userId}:user/${u.userName}`, formatDate(u.createDate),
    u.loginProfile ? "true" : "false", formatDate(u.lastLoginDate),
    u.mfaDevice ? "true" : "false",
    k1?.status === "Active" ? "true" : "false", formatDate(k1?.createDate), "N/A", "N/A", "N/A",
    k2?.status === "Active" ? "true" : "false", formatDate(k2?.createDate), "N/A", "N/A", "N/A",
    escapeCSV(u.groups.join(";")), escapeCSV(u.policies.map(p => p.policyName).join(";"))
  ].join(",");
}

function credentialReportRowToCSV(r: CredentialReportRow, accountId: string): string {
  return [
    r.user, r.arn, r.user_creation_time, r.password_enabled, r.password_last_used,
    r.password_last_changed, r.password_next_rotation, r.mfa_active,
    r.access_key_1_active, r.access_key_1_last_rotated, r.access_key_1_last_used_date,
    r.access_key_1_last_used_region, r.access_key_1_last_used_service,
    r.access_key_2_active, r.access_key_2_last_rotated, r.access_key_2_last_used_date,
    r.access_key_2_last_used_region, r.access_key_2_last_used_service,
    r.cert_1_active, r.cert_1_last_rotated, r.cert_2_active, r.cert_2_last_rotated, accountId
  ].join(",");
}

function writeUsersReport(results: IAMAuditResult[], outputDir: string): void {
  const awsUsers = results.filter(r => r.cloud === "aws").flatMap(r => r.users as AWSIAMUserDetail[]);
  const aliyunUsers = results.filter(r => r.cloud === "aliyun").flatMap(r => r.users as AliyunRAMUserDetail[]);
  const credentialReports = results.filter(r => r.credentialReport && r.credentialReport.length > 0);

  if (awsUsers.length > 0) {
    writeCSV(path.join(outputDir, "iam-users-aws.csv"), USERS_HEADERS, awsUsers.map(awsUserToRow), "AWS 用户报告");
  }
  if (aliyunUsers.length > 0) {
    writeCSV(path.join(outputDir, "iam-users-aliyun.csv"), USERS_HEADERS, aliyunUsers.map(aliyunUserToRow), "阿里云用户报告");
  }
  if (credentialReports.length > 0) {
    const rows = credentialReports.flatMap(r => r.credentialReport!.map(row => credentialReportRowToCSV(row, r.accountId)));
    writeCSV(path.join(outputDir, "iam-users-fast.csv"), CREDENTIAL_REPORT_HEADERS, rows, "Credential Report");
  }
}

export function writeIAMAuditReport(results: IAMAuditResult[], outputDir: string): void {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const allFindings = results.flatMap(r => r.findings);

  const summaryRows = results.map(r => [
    r.cloud, r.profile, r.accountId, r.auditedAt.toISOString(),
    r.totalUsers, r.usersWithRisks,
    r.summary.high, r.summary.medium, r.summary.low, r.summary.info
  ].join(","));
  writeCSV(path.join(outputDir, "iam-audit-summary.csv"), SUMMARY_HEADERS, summaryRows, "汇总报告");

  if (allFindings.length > 0) {
    writeCSV(path.join(outputDir, "iam-audit-findings.csv"), FINDINGS_HEADERS, allFindings.map(findingToRow), "风险发现");
  }

  writeFindingsByLevel(allFindings, outputDir, "HIGH", "高风险");
  writeFindingsByLevel(allFindings, outputDir, "MEDIUM", "中风险");
  writeUsersReport(results, outputDir);
}

export function printAuditSummary(results: IAMAuditResult[]): void {
  const totalUsers = results.reduce((sum, r) => sum + r.totalUsers, 0);
  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
  const totalHigh = results.reduce((sum, r) => sum + r.summary.high, 0);
  const totalMedium = results.reduce((sum, r) => sum + r.summary.medium, 0);

  console.log(`
========== IAM 安全审计汇总 ==========
审计账号数: ${results.length}
总用户数:   ${totalUsers}
风险发现:   ${totalFindings}
  - 高风险: ${totalHigh}
  - 中风险: ${totalMedium}
======================================
`);
}
