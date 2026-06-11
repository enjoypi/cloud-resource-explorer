import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { collectCdnCost, monthsToCollect, filterAccountIds } from "./cdn-cost.js";
import type { AwsCdnCostPort, AliyunCdnCostPort, CdnCostInput } from "./cdn-cost.js";
import type { ProfileAdapter } from "../adapters/profile-adapter.js";
import type { CacheAdapter } from "../adapters/cache-adapter.js";
import type { Config, Profile } from "../entities/index.js";
import { ACCOUNT_TOTAL_DOMAIN } from "../entities/index.js";

const emptyProvider = { profiles: [], excludeProfiles: [], regions: [], excludeRegions: [], accounts: [], excludeAccounts: [] };

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    cloud: "all", types: ["cdn"],
    aliyun: { ...emptyProvider }, aws: { ...emptyProvider },
    cdnCost: { months: 3, aliyunBssEndpoint: "business.aliyuncs.com" },
    outputDir: "./output", logDir: "./logs", cacheDir: "./.cache",
    cacheTtl: 60, forceRefresh: true, concurrency: 1,
    sleepMin: 0, sleepMax: 0, logLevel: "info", version: "1.0.0",
    ...overrides,
  } as Config;
}

function makeMockCache(overrides: Partial<CacheAdapter> = {}): CacheAdapter {
  return { getRaw: () => null, setRaw: () => {}, isValid: () => false, clear: () => {}, ensureDir: () => {}, ...overrides };
}

function makeProfileAdapter(profiles: Profile[]): ProfileAdapter {
  return {
    discoverProfiles: async (cloud) => profiles.filter(p => p.cloud === cloud),
    discoverSSOSessions: async () => [],
    validateSSOSession: async () => true,
    getAvailableRegions: async () => [],
    getAccountId: async (p) => p.accountId || "",
    collectRaw: async () => [],
    convertRaw: () => [],
    countResources: async () => [],
  };
}

function makeAwsPort(overrides: Partial<AwsCdnCostPort> = {}): AwsCdnCostPort {
  return {
    listAccountIds: async () => [],
    listDistributions: async () => [],
    getDistributionMonthlyUsage: async () => [],
    getMonthlyCostByAccount: async () => [],
    ...overrides,
  };
}

function makeAliyunPort(overrides: Partial<AliyunCdnCostPort> = {}): AliyunCdnCostPort {
  return { listRdAccountIds: async () => [], getMonthlyBill: async () => [], ...overrides };
}

function makeInput(overrides: Partial<CdnCostInput> = {}): CdnCostInput {
  return {
    config: makeConfig(),
    profileAdapter: makeProfileAdapter([]),
    cacheAdapter: makeMockCache(),
    aws: makeAwsPort(),
    aliyun: makeAliyunPort(),
    now: new Date("2026-06-11T08:00:00Z"),
    ...overrides,
  };
}

describe("monthsToCollect", () => {
  it("返回 N 个完整月 + 本月，按时间升序", () => {
    expect(monthsToCollect(3, new Date("2026-06-11T08:00:00Z"))).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  });

  it("跨年回卷正确（UTC）", () => {
    expect(monthsToCollect(3, new Date("2026-01-15T00:00:00Z"))).toEqual(["2025-10", "2025-11", "2025-12", "2026-01"]);
  });

  it("UTC 月初与本地时区无关", () => {
    // UTC 已是 7 月 1 日，即使东八区本地仍可能理解为 6 月末
    expect(monthsToCollect(1, new Date("2026-07-01T00:30:00Z"))).toEqual(["2026-06", "2026-07"]);
  });

  it("属性：长度恒为 N+1 且格式为 YYYY-MM", () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 24 }),
      fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }),
      (n, now) => {
        const months = monthsToCollect(n, now);
        expect(months.length).toBe(n + 1);
        for (const m of months) expect(m).toMatch(/^\d{4}-\d{2}$/);
        expect([...months].sort()).toEqual(months);
      },
    ), { numRuns: 100 });
  });
});

describe("filterAccountIds", () => {
  it("accounts 白名单生效", () => {
    expect(filterAccountIds(["1", "2", "3"], { ...emptyProvider, accounts: ["2"] })).toEqual(["2"]);
  });
  it("excludeAccounts 黑名单生效", () => {
    expect(filterAccountIds(["1", "2", "3"], { ...emptyProvider, excludeAccounts: ["2"] })).toEqual(["1", "3"]);
  });
  it("无筛选时原样返回", () => {
    expect(filterAccountIds(["1", "2"], { ...emptyProvider })).toEqual(["1", "2"]);
  });
});

describe("collectCdnCost AWS", () => {
  const awsProfile: Profile = { name: "aws-x", cloud: "aws", isValid: true, accountId: "111" };

  it("CE 费用行 + CloudWatch 用量行都进入结果", async () => {
    const aws = makeAwsPort({
      listAccountIds: async () => ["111", "222"],
      listDistributions: async (_p, accountId) => accountId === "111" ? [{ id: "E1", domain: "cdn.example.com" }] : [],
      getDistributionMonthlyUsage: async () => [{ month: "2026-05", trafficGB: 10.5, requests: 1000 }],
      getMonthlyCostByAccount: async () => [
        { month: "2026-05", accountId: "111", cost: 12.34, currency: "USD" },
        { month: "2026-05", accountId: "222", cost: 5, currency: "USD" },
      ],
    });
    const input = makeInput({ config: makeConfig({ cloud: "aws" }), profileAdapter: makeProfileAdapter([awsProfile]), aws });
    const { records, errors } = await collectCdnCost(input);
    expect(errors).toEqual([]);
    const costRows = records.filter(r => r.domain === ACCOUNT_TOTAL_DOMAIN);
    expect(costRows).toHaveLength(2);
    expect(costRows[0]).toMatchObject({ cloud: "aws", profile: "aws-x", accountId: "111", cost: 12.34, currency: "USD", product: "CloudFront" });
    const usageRows = records.filter(r => r.domain === "cdn.example.com");
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({ trafficGB: 10.5, requests: 1000, cost: null });
  });

  it("CE 费用行按账号筛选过滤", async () => {
    const aws = makeAwsPort({
      listAccountIds: async () => ["111", "222"],
      getMonthlyCostByAccount: async () => [
        { month: "2026-05", accountId: "111", cost: 1, currency: "USD" },
        { month: "2026-05", accountId: "222", cost: 2, currency: "USD" },
      ],
    });
    const config = makeConfig({ cloud: "aws", aws: { ...emptyProvider, excludeAccounts: ["222"] } });
    const { records } = await collectCdnCost(makeInput({ config, profileAdapter: makeProfileAdapter([awsProfile]), aws }));
    expect(records.map(r => r.accountId)).toEqual(["111"]);
  });

  it("单账号采集失败只记录错误不中断其他账号", async () => {
    const aws = makeAwsPort({
      listAccountIds: async () => ["111", "222"],
      listDistributions: async (_p, accountId) => {
        if (accountId === "111") throw new Error("AccessDenied");
        return [{ id: "E2", domain: "ok.example.com" }];
      },
      getDistributionMonthlyUsage: async () => [{ month: "2026-04", trafficGB: 1, requests: 2 }],
    });
    const input = makeInput({ config: makeConfig({ cloud: "aws" }), profileAdapter: makeProfileAdapter([awsProfile]), aws });
    const { records, errors } = await collectCdnCost(input);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ cloud: "aws", scope: "111" });
    expect(records.some(r => r.domain === "ok.example.com")).toBe(true);
  });

  it("CE 调用失败记入 errors，用量采集仍继续", async () => {
    const aws = makeAwsPort({
      listAccountIds: async () => ["111"],
      getMonthlyCostByAccount: async () => { throw new Error("ce denied"); },
      listDistributions: async () => [{ id: "E3", domain: "d.example.com" }],
      getDistributionMonthlyUsage: async () => [{ month: "2026-05", trafficGB: 3, requests: 4 }],
    });
    const input = makeInput({ config: makeConfig({ cloud: "aws" }), profileAdapter: makeProfileAdapter([awsProfile]), aws });
    const { records, errors } = await collectCdnCost(input);
    expect(errors.some(e => e.scope === "cost-explorer")).toBe(true);
    expect(records).toHaveLength(1);
  });

  it("viewArn 透传给 listAccountIds 供 Resource Explorer 发现账号", async () => {
    const seen: (string | undefined)[] = [];
    const aws = makeAwsPort({ listAccountIds: async (_p, viewArn) => { seen.push(viewArn); return []; } });
    const config = makeConfig({ cloud: "aws", aws: { ...emptyProvider, resourceExplorerViewArn: "arn:aws:resource-explorer-2:us-west-2:111:view/v/1" } });
    await collectCdnCost(makeInput({ config, profileAdapter: makeProfileAdapter([awsProfile]), aws }));
    expect(seen).toEqual(["arn:aws:resource-explorer-2:us-west-2:111:view/v/1"]);
  });

  it("profile 缺 accountId 时通过 profileAdapter 补齐", async () => {
    const profile: Profile = { name: "aws-y", cloud: "aws", isValid: true };
    const adapter = makeProfileAdapter([profile]);
    adapter.getAccountId = async () => "999";
    const seen: string[] = [];
    const aws = makeAwsPort({ listAccountIds: async (p) => { seen.push(p.accountId || ""); return []; } });
    await collectCdnCost(makeInput({ config: makeConfig({ cloud: "aws" }), profileAdapter: adapter, aws }));
    expect(seen).toEqual(["999"]);
  });
});

describe("collectCdnCost 阿里云", () => {
  const aliProfile: Profile = { name: "ali-x", cloud: "aliyun", isValid: true, accountId: "333" };

  it("资源目录多账号：每个成员账号每个月查询一次账单", async () => {
    const calls: Array<{ owner?: string; month: string }> = [];
    const aliyun = makeAliyunPort({
      listRdAccountIds: async () => ["a1", "a2"],
      getMonthlyBill: async (_p, owner, month) => {
        calls.push({ owner, month });
        return [{ month, accountId: owner || "", domain: "x.cn", product: "CDN", trafficGB: 1, requests: null, cost: 0.5, currency: "CNY" }];
      },
    });
    const config = makeConfig({ cloud: "aliyun", cdnCost: { months: 1, aliyunBssEndpoint: "business.aliyuncs.com" } });
    const input = makeInput({ config, profileAdapter: makeProfileAdapter([aliProfile]), aliyun });
    const { records, errors } = await collectCdnCost(input);
    expect(errors).toEqual([]);
    // 2 账号 × 2 账期（1 完整月 + 本月）
    expect(calls).toHaveLength(4);
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ cloud: "aliyun", profile: "ali-x", domain: "x.cn", currency: "CNY" });
  });

  it("非管理账号（无资源目录）查询自身账单", async () => {
    const owners: Array<string | undefined> = [];
    const aliyun = makeAliyunPort({
      getMonthlyBill: async (_p, owner, month) => {
        owners.push(owner);
        return [{ month, accountId: "", domain: "y.cn", product: "DCDN", trafficGB: null, requests: null, cost: 1, currency: "CNY" }];
      },
    });
    const config = makeConfig({ cloud: "aliyun", cdnCost: { months: 0, aliyunBssEndpoint: "business.aliyuncs.com" } });
    const { records } = await collectCdnCost(makeInput({ config, profileAdapter: makeProfileAdapter([aliProfile]), aliyun }));
    expect(owners).toEqual([undefined]);
    // 账单行没有 accountId 时回退到 profile accountId
    expect(records[0].accountId).toBe("333");
  });

  it("成员账号筛选生效且单月失败不中断", async () => {
    const aliyun = makeAliyunPort({
      listRdAccountIds: async () => ["a1", "a2", "a3"],
      getMonthlyBill: async (_p, owner, month) => {
        if (owner === "a1") throw new Error("bill error");
        return [{ month, accountId: owner || "", domain: "z.cn", product: "CDN", trafficGB: 2, requests: 200, cost: 3, currency: "CNY" }];
      },
    });
    const config = makeConfig({
      cloud: "aliyun",
      aliyun: { ...emptyProvider, accounts: ["a1", "a2"] },
      cdnCost: { months: 0, aliyunBssEndpoint: "business.aliyuncs.com" },
    });
    const { records, errors } = await collectCdnCost(makeInput({ config, profileAdapter: makeProfileAdapter([aliProfile]), aliyun }));
    expect(errors).toHaveLength(1);
    expect(errors[0].scope).toContain("a1");
    expect(records.map(r => r.accountId)).toEqual(["a2"]);
  });
});

describe("collectCdnCost 缓存", () => {
  const awsProfile: Profile = { name: "aws-c", cloud: "aws", isValid: true, accountId: "111" };

  it("缓存命中时不调用云端口", async () => {
    const cached = [{ cloud: "aws", profile: "aws-c", accountId: "111", month: "2026-05", product: "CloudFront", domain: ACCOUNT_TOTAL_DOMAIN, trafficGB: null, requests: null, cost: 9, currency: "USD", collectedAt: "2026-06-11T00:00:00.000Z" }];
    const cache = makeMockCache({ isValid: () => true, getRaw: () => cached });
    const listAccountIds = vi.fn(async () => ["111"]);
    const config = makeConfig({ cloud: "aws", forceRefresh: false });
    const input = makeInput({ config, profileAdapter: makeProfileAdapter([awsProfile]), cacheAdapter: cache, aws: makeAwsPort({ listAccountIds }) });
    const { records } = await collectCdnCost(input);
    expect(records).toEqual(cached);
    expect(listAccountIds).not.toHaveBeenCalled();
  });

  it("forceRefresh 时跳过缓存并写回", async () => {
    const setRaw = vi.fn();
    const cache = makeMockCache({ isValid: () => true, getRaw: () => [], setRaw });
    const config = makeConfig({ cloud: "aws", forceRefresh: true });
    const input = makeInput({ config, profileAdapter: makeProfileAdapter([awsProfile]), cacheAdapter: cache, aws: makeAwsPort({ listAccountIds: async () => [] }) });
    await collectCdnCost(input);
    expect(setRaw).toHaveBeenCalledWith("aws-c", "cdncost", "m4", expect.any(Array));
  });
});
