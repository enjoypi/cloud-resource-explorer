import type { AliyunRAMUserDetail, IAMAuditConfig, IAMRiskFinding, PolicyDetail, RiskType, RiskLevel } from "../entities/iam-audit.js";
import { createAliyunConfig } from "./aliyun-credentials.js";
import { parsePolicyDocument, hasAdminAccess, findDangerousActions, findWildcardResources, ALIYUN_DANGEROUS_ACTIONS, daysSince, createFinding } from "./iam-audit-utils.js";
import { log } from "../utils/index.js";
import { PAGINATION } from "../constants.js";

let ramModule: any = null;
async function getRAMModule() {
  if (!ramModule) ramModule = await import("@alicloud/ram20150501");
  return ramModule;
}

async function createRAMClient(profileName: string): Promise<any | null> {
  try {
    const config = await createAliyunConfig(profileName, "cn-hangzhou");
    if (!config) return null;
    const mod = await getRAMModule();
    const RAM = mod.default?.default || mod.default || mod;
    return new RAM(config);
  } catch (e) {
    log.debug(`创建 RAM 客户端失败: ${e}`);
    return null;
  }
}

export async function collectAliyunRAMUsers(profileName: string, _accountId: string): Promise<AliyunRAMUserDetail[]> {
  const client = await createRAMClient(profileName);
  if (!client) return [];

  const users: AliyunRAMUserDetail[] = [];
  let marker: string | undefined;
  do {
    const resp = await client.listUsers(new ramModule.ListUsersRequest({ marker, maxItems: PAGINATION.PAGE_SIZE }));
    for (const user of resp.body?.users?.user || []) {
      users.push(await collectUserDetail(client, user));
    }
    marker = resp.body?.isTruncated ? resp.body.marker : undefined;
  } while (marker);

  return users;
}

async function fetchPoliciesFromSource(
  client: any, policyList: any[], policyType: PolicyDetail["policyType"], prefix?: string
): Promise<PolicyDetail[]> {
  const policies: PolicyDetail[] = [];
  for (const p of policyList) {
    try {
      const policyName = prefix ? `${prefix}/${p.policyName}` : p.policyName;
      if (p.policyType === "Custom") {
        const policyResp = await client.getPolicy(new ramModule.GetPolicyRequest({
          policyName: p.policyName, policyType: "Custom",
        }));
        policies.push({
          policyName, policyType,
          statements: parsePolicyDocument(policyResp.body?.policy?.defaultPolicyVersion?.policyDocument || "{}"),
        });
      } else {
        policies.push({ policyName, policyType, isAWSManaged: true, statements: [] });
      }
    } catch (e) { log.debug(`获取策略内容失败 ${p.policyName}: ${e}`); }
  }
  return policies;
}

async function collectUserPolicies(client: any, userName: string, groups: string[]): Promise<PolicyDetail[]> {
  const policies: PolicyDetail[] = [];

  try {
    const resp = await client.listPoliciesForUser(new ramModule.ListPoliciesForUserRequest({ userName }));
    policies.push(...await fetchPoliciesFromSource(client, resp.body?.policies?.policy || [], "managed"));
  } catch (e) { log.debug(`获取用户策略列表失败 ${userName}: ${e}`); }

  for (const groupName of groups) {
    try {
      const resp = await client.listPoliciesForGroup(new ramModule.ListPoliciesForGroupRequest({ groupName }));
      policies.push(...await fetchPoliciesFromSource(client, resp.body?.policies?.policy || [], "group-managed", groupName));
    } catch (e) { log.debug(`获取组策略列表失败 ${groupName}: ${e}`); }
  }

  return policies;
}

async function collectUserDetail(client: any, user: any): Promise<AliyunRAMUserDetail> {
  const detail: AliyunRAMUserDetail = {
    userName: user.userName!, userId: user.userId!, displayName: user.displayName,
    createDate: new Date(user.createDate!), accessKeys: [], groups: [], policies: [],
  };

  try {
    const userResp = await client.getUser(new ramModule.GetUserRequest({ userName: user.userName }));
    if (userResp.body?.user?.lastLoginDate) {
      detail.lastLoginDate = new Date(userResp.body.user.lastLoginDate);
    }
  } catch (e) { log.debug(`获取用户详情失败 ${user.userName}: ${e}`); }

  try {
    const keysResp = await client.listAccessKeys(new ramModule.ListAccessKeysRequest({ userName: user.userName }));
    const keys = keysResp.body?.accessKeys?.accessKey || [];
    for (const k of keys) {
      const keyInfo: any = {
        accessKeyId: k.accessKeyId!, status: k.status as "Active" | "Inactive", createDate: new Date(k.createDate!),
      };
      try {
        const lastUsedResp = await client.getAccessKeyLastUsed(
          new ramModule.GetAccessKeyLastUsedRequest({ userAccessKeyId: k.accessKeyId, userName: user.userName })
        );
        if (lastUsedResp.body?.accessKeyLastUsed?.lastUsedDate) {
          keyInfo.lastUsedDate = new Date(lastUsedResp.body.accessKeyLastUsed.lastUsedDate);
        }
      } catch { /* 忽略获取失败 */ }
      detail.accessKeys.push(keyInfo);
    }
  } catch (e) { log.debug(`获取 AccessKey 失败 ${user.userName}: ${e}`); }

  try {
    const mfaResp = await client.getUserMFAInfo(new ramModule.GetUserMFAInfoRequest({ userName: user.userName }));
    if (mfaResp.body?.MFADevice?.serialNumber) {
      detail.mfaDevice = { serialNumber: mfaResp.body.MFADevice.serialNumber };
    }
  } catch (e) { log.debug(`获取 MFA 信息失败 ${user.userName}: ${e}`); }

  try {
    const loginResp = await client.getLoginProfile(new ramModule.GetLoginProfileRequest({ userName: user.userName }));
    if (loginResp.body?.loginProfile) {
      detail.loginProfile = {
        createDate: new Date(loginResp.body.loginProfile.createDate!),
        mfaBindRequired: loginResp.body.loginProfile.MFABindRequired || false,
        passwordResetRequired: loginResp.body.loginProfile.passwordResetRequired || false,
      };
    }
  } catch (e: any) {
    if (!e.message?.includes("EntityNotExist")) log.debug(`获取登录配置失败 ${user.userName}: ${e}`);
  }

  try {
    const groupsResp = await client.listGroupsForUser(new ramModule.ListGroupsForUserRequest({ userName: user.userName }));
    detail.groups = (groupsResp.body?.groups?.group || []).map((g: any) => g.groupName!);
  } catch (e) { log.debug(`获取用户组失败 ${user.userName}: ${e}`); }

  detail.policies = await collectUserPolicies(client, user.userName, detail.groups);
  return detail;
}

export function analyzeAliyunRAMRisks(
  users: AliyunRAMUserDetail[], profile: string, accountId: string, config: IAMAuditConfig
): IAMRiskFinding[] {
  const findings: IAMRiskFinding[] = [];
  const f = (u: AliyunRAMUserDetail, type: RiskType, level: RiskLevel, desc: string, detail: string, rec: string) =>
    createFinding("aliyun", profile, accountId, u.userName, u.userId, type, level, desc, detail, rec);

  for (const user of users) {
    const activeKeys = user.accessKeys.filter(k => k.status === "Active");
    for (const key of activeKeys) {
      const ageDays = daysSince(key.createDate);
      if (ageDays > config.accessKeyMaxAgeDays) {
        findings.push(f(user, "RAM_KEY_OLD", "HIGH", `AccessKey ${key.accessKeyId.slice(-4)} 已创建 ${ageDays} 天`,
          `创建时间: ${key.createDate.toISOString().split("T")[0]}`, "建议轮换 AccessKey"));
      }
      if (key.lastUsedDate && daysSince(key.lastUsedDate) > config.accessKeyUnusedDays) {
        findings.push(f(user, "RAM_KEY_UNUSED", "MEDIUM", `AccessKey ${key.accessKeyId.slice(-4)} 已 ${daysSince(key.lastUsedDate)} 天未使用`,
          `最后使用: ${key.lastUsedDate.toISOString().split("T")[0]}`, "建议禁用或删除长期未使用的 AccessKey"));
      }
    }
    if (activeKeys.length > 1) {
      findings.push(f(user, "RAM_KEY_MULTIPLE", "LOW", `用户有 ${activeKeys.length} 个活跃的 AccessKey`,
        `AccessKey: ${activeKeys.map(k => k.accessKeyId.slice(-4)).join(", ")}`, "建议仅保留一个活跃的 AccessKey，禁用或删除多余的"));
    }
    if (!user.mfaDevice && user.loginProfile) {
      findings.push(f(user, "RAM_MFA_NOT_ENABLED", "HIGH", "用户未绑定 MFA 设备",
        `MFA 绑定要求: ${user.loginProfile.mfaBindRequired ? "是" : "否"}`, "建议绑定 MFA 设备以增强账户安全"));
    }
    if (user.accessKeys.length > 0 && !user.loginProfile) {
      findings.push(f(user, "RAM_CONSOLE_DISABLED", "INFO", "程序访问账号（有 AccessKey 无控制台）",
        `AccessKey: ${user.accessKeys.length} 个`, "确认是否为程序访问账号"));
    }
    if (user.lastLoginDate && daysSince(user.lastLoginDate) > config.lastLoginMaxDays) {
      findings.push(f(user, "RAM_LAST_LOGIN_OLD", "MEDIUM", `用户已 ${daysSince(user.lastLoginDate)} 天未登录`,
        `最后登录: ${user.lastLoginDate.toISOString().split("T")[0]}`, "建议确认用户是否仍需要访问权限"));
    }
    // 直接附加策略过多
    const directPolicies = user.policies.filter(p => p.policyType === "managed");
    if (directPolicies.length > config.maxDirectPolicies) {
      findings.push(f(user, "TOO_MANY_DIRECT_POLICIES", "MEDIUM",
        `用户直接附加了 ${directPolicies.length} 个策略`,
        `策略: ${directPolicies.map(p => p.policyName).slice(0, 5).join(", ")}${directPolicies.length > 5 ? "..." : ""}`,
        "建议使用用户组管理权限，减少直接附加策略"));
    }
    const admin = hasAdminAccess(user.policies);
    if (admin.found) {
      findings.push(f(user, "RAM_ADMIN_ACCESS", "HIGH", "用户拥有管理员权限",
        `来源: ${admin.policies.join(", ")}`, "建议遵循最小权限原则，移除不必要的管理员权限"));
    }
    const dangerous = findDangerousActions(user.policies, ALIYUN_DANGEROUS_ACTIONS);
    if (dangerous.actions.length > 0 && !admin.found) {
      findings.push(f(user, "RAM_DANGEROUS_ACTIONS", "HIGH", `用户拥有 ${dangerous.actions.length} 个危险操作权限`,
        `操作: ${dangerous.actions.slice(0, 5).join(", ")}${dangerous.actions.length > 5 ? "..." : ""}`, "建议审查并移除不必要的危险操作权限"));
    }
    const wildcard = findWildcardResources(user.policies);
    if (wildcard.count > 0 && !admin.found) {
      findings.push(f(user, "RAM_WILDCARD_RESOURCE", "MEDIUM", `用户有 ${wildcard.count} 条策略使用资源通配符 *`,
        `策略: ${wildcard.policies.join(", ")}`, "建议限定具体资源 ARN，避免使用通配符"));
    }
  }
  return findings;
}
