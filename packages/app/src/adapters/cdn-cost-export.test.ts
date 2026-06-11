import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeCdnCostCSV, printCdnCostSummary, recordToRow } from "./cdn-cost-export.js";
import type { CdnCostRecord } from "../entities/index.js";

function makeRecord(overrides: Partial<CdnCostRecord> = {}): CdnCostRecord {
  return {
    cloud: "aws", profile: "p1", accountId: "111", month: "2026-05",
    product: "CloudFront", domain: "cdn.example.com",
    trafficGB: 1.5, requests: 100, cost: 2.5, currency: "USD",
    collectedAt: "2026-06-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("recordToRow", () => {
  it("null 维度输出为空字符串", () => {
    const row = recordToRow(makeRecord({ trafficGB: null, requests: null, cost: null, currency: "" }));
    expect(row).toBe("aws,p1,111,2026-05,CloudFront,cdn.example.com,,,,,2026-06-11T00:00:00.000Z");
  });

  it("包含逗号的域名被转义", () => {
    const row = recordToRow(makeRecord({ domain: "a.com,b.com" }));
    expect(row).toContain('"a.com,b.com"');
  });
});

describe("writeCdnCostCSV", () => {
  const tmpDirs: string[] = [];
  afterEach(() => { for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it("写入 cdn-cost.csv，按 云/账期/账号/域名 排序", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdncost-"));
    tmpDirs.push(dir);
    const records = [
      makeRecord({ cloud: "aliyun", month: "2026-04", domain: "b.cn" }),
      makeRecord({ cloud: "aws", month: "2026-05", domain: "a.com" }),
      makeRecord({ cloud: "aliyun", month: "2026-04", domain: "a.cn" }),
    ];
    const filePath = writeCdnCostCSV(records, dir);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.replace(/^﻿/, "").trim().split("\n");
    expect(lines[0]).toBe("Cloud,Profile,AccountID,Month,Product,Domain,TrafficGB,Requests,Cost,Currency,CollectedAt");
    expect(lines.slice(1).map(l => l.split(",")[5])).toEqual(["a.cn", "b.cn", "a.com"]);
  });

  it("输出目录不存在时自动创建", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdncost-"));
    tmpDirs.push(dir);
    const filePath = writeCdnCostCSV([makeRecord()], path.join(dir, "nested"));
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe("printCdnCostSummary", () => {
  it("按 云+账期 汇总费用与流量", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
    printCdnCostSummary([
      makeRecord({ cost: 2, trafficGB: 1 }),
      makeRecord({ cost: 3, trafficGB: 2, domain: "other.com" }),
      makeRecord({ cloud: "aliyun", currency: "CNY", cost: 10, trafficGB: 5, month: "2026-04" }),
    ]);
    spy.mockRestore();
    const text = lines.join("\n");
    expect(text).toContain("aws");
    expect(text).toContain("2026-05");
    expect(text).toContain("5.00 USD");
    expect(text).toContain("10.00 CNY");
    expect(text).toContain("3.000 GB");
  });

  it("空记录提示无数据", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
    printCdnCostSummary([]);
    spy.mockRestore();
    expect(lines.join("\n")).toContain("无");
  });
});
