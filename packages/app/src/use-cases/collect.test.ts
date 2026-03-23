import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { collect, generateTasks, isGlobalResource, expandTypes } from "./collect.js";
import type { CollectInput } from "./collect.js";
import type { ProfileAdapter } from "../adapters/profile-adapter.js";
import type { CacheAdapter } from "../adapters/cache-adapter.js";
import type { Config } from "../entities/index.js";

const profileArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
  cloud: fc.constantFrom("aws" as const, "aliyun" as const),
  isValid: fc.constant(true),
});

const regionArb = fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9-]+$/.test(s));

const ssoSessionArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
  startUrl: fc.webUrl(),
  region: fc.constantFrom("us-east-1", "us-west-2", "eu-west-1"),
  isValid: fc.boolean(),
});

const emptyProvider = { profiles: [], excludeProfiles: [], regions: [], excludeRegions: [], accounts: [], excludeAccounts: [] };

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    cloud: "aws", types: ["storage"],
    aliyun: { ...emptyProvider }, aws: { ...emptyProvider },
    outputDir: "./output", logDir: "./logs", cacheDir: "./.cache",
    cacheTtl: 60, forceRefresh: true, concurrency: 1,
    sleepMin: 0, sleepMax: 0, logLevel: "info", version: "1.0.0",
    ...overrides,
  } as Config;
}

function makeMockCache(): CacheAdapter {
  return { getRaw: () => null, setRaw: () => {}, isValid: () => false, clear: () => {}, ensureDir: () => {} };
}

describe("collect use case", () => {
  describe("Property 2: CollectTask 生成完整性", () => {
    it("Regional_Resource 任务数 = |Profiles| × |Types| × |Regions|", () => {
      fc.assert(fc.property(
        fc.array(profileArb, { minLength: 1, maxLength: 5 }),
        fc.array(fc.constantFrom("compute", "network", "slb", "database", "cache", "container"), { minLength: 1, maxLength: 3 }),
        fc.array(regionArb, { minLength: 1, maxLength: 4 }),
        (profiles, types, regions) => {
          const uniqueProfiles = profiles.filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i);
          const getRegions = () => regions;
          const tasks = generateTasks(uniqueProfiles, types, getRegions);
          const expectedCount = uniqueProfiles.length * types.length * regions.length;
          expect(tasks.length).toBe(expectedCount);
          for (const task of tasks) { expect(task.region).not.toBe("global"); }
        },
      ), { numRuns: 100 });
    });

    it("Global_Resource 任务数 = |Profiles| × |Types| × 1", () => {
      fc.assert(fc.property(
        fc.array(profileArb, { minLength: 1, maxLength: 5 }),
        fc.array(fc.constantFrom("storage", "cdn", "dns", "iam"), { minLength: 1, maxLength: 3 }),
        fc.array(regionArb, { minLength: 1, maxLength: 4 }),
        (profiles, types, regions) => {
          const uniqueProfiles = profiles.filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i);
          const getRegions = () => regions;
          const tasks = generateTasks(uniqueProfiles, types, getRegions);
          const expectedCount = uniqueProfiles.length * types.length;
          expect(tasks.length).toBe(expectedCount);
          for (const task of tasks) { expect(task.region).toBe("global"); }
        },
      ), { numRuns: 100 });
    });
  });

  describe("Property 3: SSO 凭证失效处理", () => {
    it("失效 SSO Session 关联的所有 Profile 应被跳过并生成 SSOSessionError", async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(ssoSessionArb, { minLength: 1, maxLength: 3 }),
        fc.array(profileArb, { minLength: 2, maxLength: 5 }),
        async (sessions, baseProfiles) => {
          const uniqueSessions = sessions.filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i);
          if (uniqueSessions.length === 0) return true;
          const invalidSessions = uniqueSessions.filter(() => Math.random() > 0.5);
          if (invalidSessions.length === 0 && uniqueSessions.length > 0) invalidSessions.push(uniqueSessions[0]);
          const validSessionNames = new Set(uniqueSessions.filter((s) => !invalidSessions.includes(s)).map((s) => s.name));
          const invalidSessionNames = new Set(invalidSessions.map((s) => s.name));
          const profiles = baseProfiles
            .filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i)
            .map((p, i) => ({ ...p, cloud: "aws" as const, ssoSession: uniqueSessions[i % uniqueSessions.length] }));
          const expectedValidProfiles = profiles.filter((p) => !p.ssoSession || validSessionNames.has(p.ssoSession.name));
          const mockProfileAdapter = {
            discoverProfiles: async () => profiles,
            discoverSSOSessions: async () => uniqueSessions,
            validateSSOSession: async (session: any) => !invalidSessionNames.has(session.name),
            getAvailableRegions: async () => ["us-east-1"],
            getAccountId: async () => "123456789012",
            collectRaw: async (task: any) => [{ cloud: task.profile.cloud, profile: task.profile.name, type: task.type, id: "id-1", name: "name-1", region: task.region, project: "", collectedAt: new Date() }],
            convertRaw: (raw: any[]) => raw,
            countResources: async () => [],
          } as unknown as ProfileAdapter;
          const result = await collect({ config: makeConfig(), profileAdapter: mockProfileAdapter, cacheAdapter: makeMockCache() });
          for (const sessionName of invalidSessionNames) {
            const ssoError = result.ssoErrors.find((e) => e.session.name === sessionName);
            const affectedForSession = profiles.filter((p) => p.ssoSession?.name === sessionName).map((p) => p.name);
            if (affectedForSession.length > 0) {
              expect(ssoError).toBeDefined();
              expect(ssoError?.affectedProfiles.sort()).toEqual(affectedForSession.sort());
            }
          }
          expect(result.resources.length).toBe(expectedValidProfiles.length);
          return true;
        },
      ), { numRuns: 100 });
    });
  });

  describe("Property 4: 错误恢复", () => {
    it("单个任务失败不影响其他任务", async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(profileArb, { minLength: 2, maxLength: 5 }),
        fc.array(fc.constantFrom("compute", "storage", "network"), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 10 }),
        async (profiles, types, failIndex) => {
          const uniqueProfiles = profiles.filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i);
          if (uniqueProfiles.length < 2) return true;
          let taskCounter = 0;
          const mockProfileAdapter = {
            discoverProfiles: async (cloud: string) => uniqueProfiles.filter((p) => p.cloud === cloud),
            discoverSSOSessions: async () => [],
            validateSSOSession: async () => true,
            getAvailableRegions: async () => ["region-1"],
            getAccountId: async () => "123456789012",
            collectRaw: async (task: any) => {
              const currentTask = taskCounter++;
              const totalTasks = uniqueProfiles.length * types.length;
              if (currentTask === failIndex % totalTasks) throw new Error("Simulated failure");
              return [{ cloud: task.profile.cloud, profile: task.profile.name, type: task.type, id: `id-${currentTask}`, name: `name-${currentTask}`, region: task.region, project: "", collectedAt: new Date() }];
            },
            convertRaw: (raw: any[]) => raw,
            countResources: async () => [],
          } as unknown as ProfileAdapter;
          const config = makeConfig({ cloud: "all", types });
          const result = await collect({ config, profileAdapter: mockProfileAdapter, cacheAdapter: makeMockCache() });
          const totalTasks = uniqueProfiles.length * types.length;
          expect(result.errors.length).toBe(1);
          expect(result.resources.length).toBe(totalTasks - 1);
          return true;
        },
      ), { numRuns: 100 });
    });
  });

  describe("isGlobalResource", () => {
    it("storage, cdn, dns, iam 为全局资源", () => {
      expect(isGlobalResource("storage")).toBe(true);
      expect(isGlobalResource("cdn")).toBe(true);
      expect(isGlobalResource("dns")).toBe(true);
      expect(isGlobalResource("iam")).toBe(true);
    });
    it("compute, network, slb, database, cache, container 为区域资源", () => {
      for (const t of ["compute", "network", "slb", "database", "cache", "container"]) {
        expect(isGlobalResource(t)).toBe(false);
      }
    });
  });

  describe("expandTypes", () => {
    it("'all' 展开为所有资源类型", () => {
      const expanded = expandTypes(["all"]);
      const expectedTypes = ["compute", "storage", "ebs", "filesys", "network", "slb", "database", "cache", "cdn", "dns", "container", "iam", "kms", "queue", "notify"];
      for (const t of expectedTypes) { expect(expanded).toContain(t); }
      expect(expanded.length).toBe(expectedTypes.length);
    });
    it("具体类型保持不变", () => {
      expect(expandTypes(["compute", "storage"])).toEqual(["compute", "storage"]);
    });
  });
});
