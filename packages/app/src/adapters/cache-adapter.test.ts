import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { FileCacheAdapter } from "./cache-adapter.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const resourceArb = fc.record({
  cloud: fc.constantFrom("aws", "aliyun"),
  profile: fc.string({ minLength: 1, maxLength: 32 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
  type: fc.constantFrom("compute", "storage", "network", "slb", "database", "cache"),
  id: fc.string({ minLength: 1, maxLength: 64 }),
  name: fc.string({ minLength: 1, maxLength: 64 }),
  region: fc.string({ minLength: 1, maxLength: 32 }),
  project: fc.string({ minLength: 0, maxLength: 32 }),
  collectedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
});

const regionArb = fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9-]+$/.test(s));

describe("Property 6 & 9: 缓存与权限", () => {
  describe("Property 9: 目录权限 700", () => {
    it("缓存目录创建时权限为 700", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9]+$/.test(s)),
        (suffix) => {
          const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "cache-perm-"));
          const cacheDir = path.join(tempBase, `cache-${suffix}`);
          new FileCacheAdapter(cacheDir);
          const stats = fs.statSync(cacheDir);
          const mode = stats.mode & 0o777;
          expect(mode).toBe(0o700);
          fs.rmSync(tempBase, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });
  });

  describe("Property 6: 缓存文件名格式 {profile}_{type}_{region}.json", () => {
    it("缓存按 Profile + Type + Region 存储独立", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.constantFrom("compute", "storage", "network"),
        regionArb,
        fc.array(resourceArb, { minLength: 1, maxLength: 5 }),
        (profile, type, region, resources) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-test-"));
          const adapter = new FileCacheAdapter(tempDir);
          adapter.setRaw(profile, type, region, resources);
          const expectedFile = `${profile}_${type}_${region}.json`;
          const filePath = path.join(tempDir, expectedFile);
          expect(fs.existsSync(filePath)).toBe(true);
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });
  });

  describe("Property 6: TTL 判断正确", () => {
    it("未过期缓存 isValid 返回 true", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.constantFrom("compute", "storage", "network"),
        regionArb,
        fc.array(resourceArb, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 1440 }),
        (profile, type, region, resources, ttl) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-ttl-"));
          const adapter = new FileCacheAdapter(tempDir);
          adapter.setRaw(profile, type, region, resources);
          const valid = adapter.isValid(profile, type, region, ttl);
          expect(valid).toBe(true);
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });

    it("过期缓存 isValid 返回 false", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.constantFrom("compute", "storage", "network"),
        regionArb,
        fc.array(resourceArb, { minLength: 1, maxLength: 3 }),
        (profile, type, region, resources) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-ttl-"));
          const adapter = new FileCacheAdapter(tempDir);
          const filePath = path.join(tempDir, `${profile}_${type}_${region}.json`);
          const expiredTimestamp = Date.now() - 120 * 60 * 1000;
          const content = JSON.stringify({ timestamp: expiredTimestamp, raw: resources }, null, 2);
          fs.writeFileSync(filePath, content, { mode: 0o600 });
          const valid = adapter.isValid(profile, type, region, 60);
          expect(valid).toBe(false);
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });

    it("不存在的缓存 isValid 返回 false", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.constantFrom("compute", "storage", "network"),
        regionArb,
        fc.integer({ min: 1, max: 1440 }),
        (profile, type, region, ttl) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-ttl-"));
          const adapter = new FileCacheAdapter(tempDir);
          const valid = adapter.isValid(profile, type, region, ttl);
          expect(valid).toBe(false);
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });
  });

  describe("Property 6: 单个 Region 失败不影响其他 Region 缓存", () => {
    it("不同 Region 缓存独立", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.constantFrom("compute", "storage", "network"),
        regionArb, regionArb,
        fc.array(resourceArb, { minLength: 1, maxLength: 3 }),
        fc.array(resourceArb, { minLength: 1, maxLength: 3 }),
        (profile, type, region1, region2, resources1, resources2) => {
          if (region1 === region2) return true;
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-region-"));
          const adapter = new FileCacheAdapter(tempDir);
          adapter.setRaw(profile, type, region1, resources1);
          adapter.setRaw(profile, type, region2, resources2);
          const retrieved1 = adapter.getRaw(profile, type, region1);
          const retrieved2 = adapter.getRaw(profile, type, region2);
          expect(retrieved1?.length).toBe(resources1.length);
          expect(retrieved2?.length).toBe(resources2.length);
          fs.rmSync(tempDir, { recursive: true, force: true });
          return true;
        },
      ), { numRuns: 100 });
    });
  });

  describe("缓存数据完整性 (round-trip)", () => {
    it("set 后 get 返回相同数据", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.constantFrom("compute", "storage", "network"),
        regionArb,
        fc.array(resourceArb, { minLength: 1, maxLength: 5 }),
        (profile, type, region, resources) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-data-"));
          const adapter = new FileCacheAdapter(tempDir);
          adapter.setRaw(profile, type, region, resources);
          const retrieved = adapter.getRaw(profile, type, region)!;
          expect(retrieved).not.toBeNull();
          expect(retrieved.length).toBe(resources.length);
          for (let i = 0; i < resources.length; i++) {
            expect(retrieved[i].id).toBe(resources[i].id);
            expect(retrieved[i].name).toBe(resources[i].name);
            expect(retrieved[i].cloud).toBe(resources[i].cloud);
            expect(retrieved[i].type).toBe(resources[i].type);
          }
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });
  });
});
