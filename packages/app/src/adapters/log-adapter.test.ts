import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { JsonLogAdapter } from "./log-adapter.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Property 8: 日志安全性", () => {
  describe("maskIp - IP 脱敏", () => {
    it("IPv4 地址后两段被脱敏为 ***.***", () => {
      fc.assert(fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (a, b, c, d) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
          const adapter = new JsonLogAdapter(tempDir);
          const ip = `${a}.${b}.${c}.${d}`;
          const masked = adapter.maskIp(ip);
          expect(masked).toBe(`${a}.${b}.***.***`);
          expect(masked.endsWith("***.***")).toBe(true);
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });

    it("IPv6 地址后四段被脱敏", () => {
      const hexSegment = fc.string({ minLength: 1, maxLength: 4 }).filter(s => /^[0-9a-f]+$/i.test(s));
      fc.assert(fc.property(
        fc.array(hexSegment, { minLength: 8, maxLength: 8 }),
        (segments) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
          const adapter = new JsonLogAdapter(tempDir);
          const ip = segments.join(":");
          const masked = adapter.maskIp(ip);
          const expectedPrefix = segments.slice(0, 4).join(":");
          expect(masked.startsWith(expectedPrefix)).toBe(true);
          expect(masked).toContain("***");
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });
  });

  describe("truncateId - ID 截断", () => {
    it("长 ID 仅保留前 8 位", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 9, maxLength: 64 }),
        (id) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
          const adapter = new JsonLogAdapter(tempDir);
          const truncated = adapter.truncateId(id);
          expect(truncated.length).toBe(8);
          expect(truncated).toBe(id.substring(0, 8));
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });

    it("短 ID 保持不变", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        (id) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
          const adapter = new JsonLogAdapter(tempDir);
          const truncated = adapter.truncateId(id);
          expect(truncated).toBe(id);
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });
  });

  describe("log - 日志格式与安全", () => {
    it("日志为 JSON 格式且包含必需字段", () => {
      const statusArb = fc.constantFrom("success" as const, "error" as const, "cached" as const);
      const sourceArb = fc.constantFrom("api" as const, "cache" as const);
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        statusArb, fc.integer({ min: 0, max: 10000 }), sourceArb,
        (profile, region, type, status, duration, source) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
          const adapter = new JsonLogAdapter(tempDir);
          adapter.log({ profile, region, type, status, duration, source });
          const logFiles = fs.readdirSync(tempDir).filter((f) => f.endsWith(".log"));
          expect(logFiles.length).toBeGreaterThan(0);
          const content = fs.readFileSync(path.join(tempDir, logFiles[0]), "utf-8");
          const lines = content.trim().split("\n");
          const lastLine = lines[lines.length - 1];
          const parsed = JSON.parse(lastLine);
          expect(parsed).toHaveProperty("timestamp");
          expect(parsed).toHaveProperty("profile", profile);
          expect(parsed).toHaveProperty("region", region);
          expect(parsed).toHaveProperty("type", type);
          expect(parsed).toHaveProperty("status", status);
          expect(parsed).toHaveProperty("duration", duration);
          expect(parsed).toHaveProperty("source", source);
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });

    it("错误日志包含 type 和 message 字段", () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        (errorType, errorMsg) => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
          const adapter = new JsonLogAdapter(tempDir);
          adapter.log({
            profile: "test", region: "us-east-1", type: "compute",
            status: "error", duration: 100, source: "api",
            error: { type: errorType, message: errorMsg },
          });
          const logFiles = fs.readdirSync(tempDir).filter((f) => f.endsWith(".log"));
          const content = fs.readFileSync(path.join(tempDir, logFiles[0]), "utf-8");
          const parsed = JSON.parse(content.trim());
          expect(parsed.error).toHaveProperty("type", errorType);
          expect(parsed.error).toHaveProperty("message", errorMsg);
          expect(parsed).not.toHaveProperty("stack");
          expect(content).not.toContain("at ");
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      ), { numRuns: 100 });
    });
  });
});
