import * as fs from "node:fs";
import * as path from "node:path";
import { writeCSV, escapeCSV } from "./csv-adapter.js";
import type { CdnCostRecord } from "../entities/index.js";

const HEADERS = ["Cloud", "Profile", "AccountID", "Month", "Product", "Domain", "TrafficGB", "Requests", "Cost", "Currency", "CollectedAt"];
const CSV_FILE_NAME = "cdn-cost.csv";

export function recordToRow(r: CdnCostRecord): string {
  return [
    r.cloud, r.profile, r.accountId, r.month, r.product, r.domain,
    r.trafficGB === null ? "" : String(r.trafficGB),
    r.requests === null ? "" : String(r.requests),
    r.cost === null ? "" : String(r.cost),
    r.currency, r.collectedAt,
  ].map(escapeCSV).join(",");
}

export function writeCdnCostCSV(records: CdnCostRecord[], outputDir: string): string {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const sorted = [...records].sort((a, b) =>
    a.cloud.localeCompare(b.cloud) || a.month.localeCompare(b.month)
    || a.accountId.localeCompare(b.accountId) || a.domain.localeCompare(b.domain));
  const filePath = path.join(outputDir, CSV_FILE_NAME);
  writeCSV(filePath, HEADERS, sorted.map(recordToRow), "CDN 用量费用");
  return filePath;
}

export function printCdnCostSummary(records: CdnCostRecord[]): void {
  if (records.length === 0) { console.log("无 CDN 用量费用数据"); return; }
  // 按 云+账期 汇总；费用按币种分别累计，避免跨币种相加
  const groups = new Map<string, { costs: Map<string, number>; trafficGB: number }>();
  for (const r of records) {
    const key = `${r.cloud} ${r.month}`;
    const g = groups.get(key) ?? { costs: new Map(), trafficGB: 0 };
    if (r.cost !== null && r.currency) g.costs.set(r.currency, (g.costs.get(r.currency) ?? 0) + r.cost);
    if (r.trafficGB !== null) g.trafficGB += r.trafficGB;
    groups.set(key, g);
  }
  console.log("\nCDN 用量费用汇总（按云平台/账期）:");
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!;
    const costText = [...g.costs.entries()].map(([cur, amt]) => `${amt.toFixed(2)} ${cur}`).join(" + ") || "-";
    console.log(`  ${key}  费用: ${costText}  流量: ${g.trafficGB.toFixed(3)} GB`);
  }
  console.log();
}
