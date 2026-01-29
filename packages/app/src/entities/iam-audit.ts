import { IAM_AUDIT } from "../constants.js";

// IAM 审计风险级别
export type RiskLevel = "HIGH" | "MEDIUM" | "LOW" | "INFO";

// 风险项类型
export type RiskType =
  | "ACCESS_KEY_OLD"           // AccessKey 超过阈值未轮换
  | "ACCESS_KEY_UNUSED"        // AccessKey 超过阈值未使用
  | "ACCESS_KEY_MULTIPLE"      // 多个 AccessKey 同时活跃
  | "MFA_NOT_ENABLED"          // MFA 未启用
  | "CONSOLE_NO_PASSWORD"      // 有 AccessKey 但无 Console 密码
  | "CONSOLE_NO_LOGIN"         // 控制台用户从未登录或长期未登录
  | "TOO_MANY_DIRECT_POLICIES" // 过多直接附加策略
  | "ADMIN_ACCESS"             // 管理员权限
  | "WILDCARD_RESOURCE"        // 资源通配符 *
  | "DANGEROUS_ACTIONS"        // 危险操作权限
  | "RAM_KEY_OLD"              // RAM AccessKey 过期
  | "RAM_KEY_UNUSED"           // RAM AccessKey 未使用
  | "RAM_KEY_MULTIPLE"         // RAM 多个 AccessKey 同时活跃
  | "RAM_MFA_NOT_ENABLED"      // RAM MFA 未启用
  | "RAM_CONSOLE_DISABLED"     // RAM Console 未启用
  | "RAM_LAST_LOGIN_OLD"       // RAM 最后登录时间过久
  | "RAM_ADMIN_ACCESS"         // RAM 管理员权限
  | "RAM_DANGEROUS_ACTIONS"    // RAM 危险操作权限
  | "RAM_WILDCARD_RESOURCE";   // RAM 资源通配符 *

// IAM 策略语句
export interface PolicyStatement {
  effect: "Allow" | "Deny";
  actions: string[];
  resources: string[];
  conditions?: Record<string, any>;
}

// IAM 策略详情
export interface PolicyDetail {
  policyName: string;
  policyArn?: string;
  policyType: "managed" | "inline" | "group-managed" | "group-inline";
  isAWSManaged?: boolean;
  statements: PolicyStatement[];
}

// 单个风险发现
export interface IAMRiskFinding {
  cloud: "aws" | "aliyun";
  profile: string;
  accountId: string;
  userName: string;
  userId: string;
  riskType: RiskType;
  riskLevel: RiskLevel;
  description: string;
  detail: string;
  recommendation: string;
  detectedAt: Date;
}

// AWS IAM User 详细信息
export interface AWSIAMUserDetail {
  userName: string;
  userId: string;
  arn: string;
  createDate: Date;
  passwordLastUsed?: Date;
  accessKeys: Array<{
    accessKeyId: string;
    status: "Active" | "Inactive";
    createDate: Date;
    lastUsedDate?: Date;
    lastUsedRegion?: string;
    lastUsedService?: string;
  }>;
  mfaDevices: Array<{ serialNumber: string; enableDate: Date }>;
  loginProfile?: { createDate: Date; passwordResetRequired: boolean };
  attachedPolicies: Array<{ policyName: string; policyArn: string }>;
  groups: string[];
  policies: PolicyDetail[];
}

// 阿里云 RAM User 详细信息
export interface AliyunRAMUserDetail {
  userName: string;
  userId: string;
  displayName?: string;
  createDate: Date;
  lastLoginDate?: Date;
  accessKeys: Array<{
    accessKeyId: string;
    status: "Active" | "Inactive";
    createDate: Date;
    lastUsedDate?: Date;
  }>;
  mfaDevice?: { serialNumber: string };
  loginProfile?: {
    createDate: Date;
    mfaBindRequired: boolean;
    passwordResetRequired: boolean;
  };
  groups: string[];
  policies: PolicyDetail[];
}

// Credential Report 行（AWS IAM 凭证报告格式）
export interface CredentialReportRow {
  user: string;
  arn: string;
  user_creation_time: string;
  password_enabled: string;
  password_last_used: string;
  password_last_changed: string;
  password_next_rotation: string;
  mfa_active: string;
  access_key_1_active: string;
  access_key_1_last_rotated: string;
  access_key_1_last_used_date: string;
  access_key_1_last_used_region: string;
  access_key_1_last_used_service: string;
  access_key_2_active: string;
  access_key_2_last_rotated: string;
  access_key_2_last_used_date: string;
  access_key_2_last_used_region: string;
  access_key_2_last_used_service: string;
  cert_1_active: string;
  cert_1_last_rotated: string;
  cert_2_active: string;
  cert_2_last_rotated: string;
}

// 审计结果汇总
export interface IAMAuditResult {
  cloud: "aws" | "aliyun";
  profile: string;
  accountId: string;
  auditedAt: Date;
  totalUsers: number;
  usersWithRisks: number;
  findings: IAMRiskFinding[];
  summary: { high: number; medium: number; low: number; info: number };
  users: AWSIAMUserDetail[] | AliyunRAMUserDetail[];
  credentialReport?: CredentialReportRow[];
}

// 审计配置
export interface IAMAuditConfig {
  accessKeyMaxAgeDays: number;  // AccessKey 最大年龄，默认 90
  accessKeyUnusedDays: number;  // AccessKey 未使用天数阈值，默认 90
  maxDirectPolicies: number;    // 直接附加策略数量阈值，默认 3
  lastLoginMaxDays: number;     // 最后登录时间阈值，默认 90
}

export const DEFAULT_AUDIT_CONFIG: IAMAuditConfig = {
  accessKeyMaxAgeDays: IAM_AUDIT.DEFAULT_KEY_MAX_AGE_DAYS,
  accessKeyUnusedDays: IAM_AUDIT.DEFAULT_KEY_UNUSED_DAYS,
  maxDirectPolicies: 3,
  lastLoginMaxDays: IAM_AUDIT.DEFAULT_LAST_LOGIN_DAYS,
};
