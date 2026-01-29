import type { PolicyDetail, PolicyStatement, IAMRiskFinding, RiskLevel, RiskType } from "../entities/iam-audit.js";

export const AWS_DANGEROUS_ACTIONS = [
  "iam:*", "iam:CreateUser", "iam:DeleteUser", "iam:CreateAccessKey",
  "iam:AttachUserPolicy", "iam:PutUserPolicy", "iam:CreatePolicyVersion",
  "sts:AssumeRole", "organizations:*", "s3:DeleteBucket",
  "ec2:TerminateInstances", "rds:DeleteDBInstance", "lambda:*",
  "kms:Decrypt", "kms:*", "secretsmanager:GetSecretValue",
];

export const ALIYUN_DANGEROUS_ACTIONS = [
  "ram:*", "ram:CreateUser", "ram:DeleteUser", "ram:CreateAccessKey",
  "ram:AttachPolicyToUser", "ram:CreatePolicy", "sts:AssumeRole",
  "resourcemanager:*", "oss:DeleteBucket", "ecs:DeleteInstance",
  "rds:DeleteDBInstance", "fc:*", "kms:Decrypt", "kms:*",
];

import { TIME } from "../constants.js";

export const DAY_MS = TIME.MS_PER_DAY;
export function daysSince(date: Date, now = new Date()): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

export function parsePolicyDocument(doc: string, decode = false): PolicyStatement[] {
  try {
    const parsed = JSON.parse(decode ? decodeURIComponent(doc) : doc);
    const stmts = Array.isArray(parsed.Statement) ? parsed.Statement : [parsed.Statement];
    return stmts.filter(Boolean).map((s: any) => ({
      effect: s.Effect || "Allow",
      actions: Array.isArray(s.Action) ? s.Action : [s.Action].filter(Boolean),
      resources: Array.isArray(s.Resource) ? s.Resource : [s.Resource].filter(Boolean),
      conditions: s.Condition,
    }));
  } catch { return []; }
}

export function hasAdminAccess(policies: PolicyDetail[]): { found: boolean; policies: string[] } {
  const adminPolicies: string[] = [];
  for (const p of policies) {
    const isAdmin = p.policyName.toLowerCase().includes("admin") ||
      p.statements.some(s => s.effect === "Allow" && s.actions.includes("*") && s.resources.includes("*"));
    if (isAdmin) adminPolicies.push(p.policyName);
  }
  return { found: adminPolicies.length > 0, policies: adminPolicies };
}

export function findDangerousActions(policies: PolicyDetail[], dangerousActions: string[]): { actions: string[]; policies: string[] } {
  const found: string[] = [], policyNames: string[] = [];
  for (const p of policies) {
    for (const s of p.statements.filter(s => s.effect === "Allow")) {
      for (const action of s.actions) {
        const isDangerous = dangerousActions.some(d =>
          action === d || (d.endsWith("*") && action.startsWith(d.slice(0, -1))) ||
          (action.endsWith("*") && dangerousActions.some(da => da.startsWith(action.slice(0, -1))))
        );
        if (isDangerous && !found.includes(action)) {
          found.push(action);
          if (!policyNames.includes(p.policyName)) policyNames.push(p.policyName);
        }
      }
    }
  }
  return { actions: found, policies: policyNames };
}

export function createFinding(
  cloud: "aws" | "aliyun", profile: string, accountId: string,
  userName: string, userId: string, riskType: RiskType, riskLevel: RiskLevel,
  description: string, detail: string, recommendation: string
): IAMRiskFinding {
  return { cloud, profile, accountId, userName, userId, riskType, riskLevel, description, detail, recommendation, detectedAt: new Date() };
}

export function findWildcardResources(policies: PolicyDetail[]): { policies: string[]; count: number } {
  const policyNames: string[] = [];
  let count = 0;
  for (const p of policies) {
    if (p.isAWSManaged) continue;
    for (const s of p.statements.filter(s => s.effect === "Allow")) {
      if (s.resources.includes("*")) {
        count++;
        if (!policyNames.includes(p.policyName)) policyNames.push(p.policyName);
      }
    }
  }
  return { policies: policyNames, count };
}
