import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { Config, ProviderConfig } from "./config.js";

const emptyProvider: ProviderConfig = { profiles: [], excludeProfiles: [], regions: [], excludeRegions: [], accounts: [], excludeAccounts: [] };

describe("Config", () => {
  it("should validate config types with fast-check", () => {
    fc.assert(fc.property(fc.record({
      cloud: fc.constantFrom("aws" as const, "aliyun" as const, "all" as const),
      types: fc.array(fc.string()),
      aliyun: fc.constant(emptyProvider),
      aws: fc.constant(emptyProvider),
      outputDir: fc.string(),
      logDir: fc.string(),
      cacheDir: fc.string(),
      cacheTtl: fc.nat(),
      forceRefresh: fc.boolean(),
      concurrency: fc.nat({ max: 20 }),
      sleepMin: fc.nat({ max: 5 }),
      sleepMax: fc.nat({ max: 10 }),
      logLevel: fc.constantFrom("trace" as const, "debug" as const, "info" as const, "warn" as const, "error" as const, "fatal" as const),
      version: fc.string(),
    }), (config) => {
      expect(["aws", "aliyun", "all"]).toContain(config.cloud);
      expect(config.cacheTtl).toBeGreaterThanOrEqual(0);
      return true;
    }), { numRuns: 100 });
  });
});
