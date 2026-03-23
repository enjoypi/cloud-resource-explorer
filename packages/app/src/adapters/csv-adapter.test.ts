import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { FileCSVAdapter, BOM } from "./csv-adapter.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Resource } from "../entities/index.js";

const CSV_HEADERS = ["Cloud", "Profile", "AccountID", "Type", "ResourceID", "Name", "Region", "Project", "Spec", "Engine", "Status", "CreatedAt", "CollectedAt"];

const validDate = fc
  .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2030-01-01").getTime() })
  .map((ts) => new Date(ts));

const resourceArb = fc.record({
  cloud: fc.constantFrom("aws" as const, "aliyun" as const),
  profile: fc.string({ minLength: 1, maxLength: 32 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
  accountId: fc.string({ minLength: 0, maxLength: 16 }).filter((s) => /^[0-9]*$/.test(s)),
  type: fc.constantFrom("compute", "storage", "network", "slb", "database", "cache"),
  id: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => !s.includes(",") && !s.includes("\n")),
  name: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => !s.includes(",") && !s.includes("\n")),
  region: fc.string({ minLength: 1, maxLength: 32 }).filter((s) => /^[a-zA-Z0-9-]+$/.test(s)),
  project: fc.string({ minLength: 0, maxLength: 32 }).filter((s) => !s.includes(",") && !s.includes("\n")),
  tags: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 16 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
    fc.string({ minLength: 1, maxLength: 32 }).filter((s) => !s.includes(",") && !s.includes("\n") && !s.includes(";") && !s.includes("=")),
  ),
  collectedAt: validDate,
});

describe("Property 5: CSV 输出完整性", () => {
  describe("BOM 编码", () => {
    it("CSV 文件以 UTF-8 BOM 开头", () => {
      fc.assert(fc.property(fc.array(resourceArb, { minLength: 1, maxLength: 10 }), (resources) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-bom-"));
        const adapter = new FileCSVAdapter();
        adapter.writeSummary(resources as Resource[], tempDir);
        const content = fs.readFileSync(path.join(tempDir, "summary.csv"), "utf-8");
        expect(content.startsWith(BOM)).toBe(true);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }), { numRuns: 100 });
    });
  });

  describe("必需列", () => {
    it("CSV 包含所有必需的列头", () => {
      fc.assert(fc.property(fc.array(resourceArb, { minLength: 1, maxLength: 10 }), (resources) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-headers-"));
        const adapter = new FileCSVAdapter();
        adapter.writeSummary(resources as Resource[], tempDir);
        const content = fs.readFileSync(path.join(tempDir, "summary.csv"), "utf-8");
        const firstLine = content.replace(BOM, "").split("\n")[0];
        const headers = firstLine.split(",");
        for (const h of CSV_HEADERS) {
          expect(headers).toContain(h);
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
      }), { numRuns: 100 });
    });
  });

  describe("按类型分文件", () => {
    it("writeByType 为每种资源类型生成独立文件", () => {
      fc.assert(fc.property(fc.array(resourceArb, { minLength: 1, maxLength: 20 }), (resources) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-bytype-"));
        const adapter = new FileCSVAdapter();
        adapter.writeByType(resources as Resource[], tempDir);
        const types = new Set(resources.map((r) => r.type));
        for (const type of types) {
          const filePath = path.join(tempDir, `${type}.csv`);
          expect(fs.existsSync(filePath)).toBe(true);
          const content = fs.readFileSync(filePath, "utf-8");
          expect(content.startsWith(BOM)).toBe(true);
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
      }), { numRuns: 100 });
    });
  });

  describe("数据完整性", () => {
    it("CSV 行数等于资源数 + 1 (header)", () => {
      fc.assert(fc.property(fc.array(resourceArb, { minLength: 1, maxLength: 10 }), (resources) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-rows-"));
        const adapter = new FileCSVAdapter();
        adapter.writeSummary(resources as Resource[], tempDir);
        const content = fs.readFileSync(path.join(tempDir, "summary.csv"), "utf-8");
        const lines = content.replace(BOM, "").split("\n").filter((l) => l.trim());
        expect(lines.length).toBe(resources.length + 1);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }), { numRuns: 100 });
    });
  });
});
