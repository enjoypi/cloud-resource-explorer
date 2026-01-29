import * as fs from "node:fs";
import * as path from "node:path";
import type { Resource } from "../entities/index.js";
import { log } from "../utils/index.js";

export interface CSVAdapter {
  writeByType(resources: Resource[], outputDir: string): void;
  writeSummary(resources: Resource[], outputDir: string): void;
}

export const BOM = "\uFEFF";
const CSV_HEADERS = ["Cloud", "Profile", "AccountID", "Type", "ResourceID", "Name", "Region", "Project", "Spec", "Engine", "Status", "CreatedAt", "CollectedAt"];

export function escapeCSV(value: string): string {
  let safe = value;
  if (/^[=+\-@\t\r]/.test(value)) safe = "'" + value;
  return (safe.includes(",") || safe.includes('"') || safe.includes("\n"))
    ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function writeCSV(filePath: string, headers: string[], rows: string[], label: string): void {
  fs.writeFileSync(filePath, BOM + headers.join(",") + "\n" + rows.join("\n"), "utf-8");
  log.info(`写入${label}: ${filePath} (${rows.length} 条)`);
}

function resourceToRow(r: Resource): string {
  return [
    r.cloud, r.profile, r.accountId || "", r.type, r.id, r.name, r.region, r.project,
    r.spec || "", r.engine || "", r.status || "", r.createdAt || "",
    r.collectedAt instanceof Date ? r.collectedAt.toISOString() : String(r.collectedAt),
  ].map(escapeCSV).join(",");
}

function ensureDir(dir: string) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function writeResourceCSV(filePath: string, resources: Resource[], label: string) {
  const rows = resources.map(resourceToRow);
  fs.writeFileSync(filePath, BOM + CSV_HEADERS.join(",") + "\n" + rows.join("\n"), "utf-8");
  log.debug(`${label}: ${filePath}, ${rows.length} items`);
}

export class FileCSVAdapter implements CSVAdapter {
  writeByType(resources: Resource[], outputDir: string): void {
    ensureDir(outputDir);
    const byType = new Map<string, Resource[]>();
    for (const r of resources) {
      const list = byType.get(r.type);
      if (list) list.push(r); else byType.set(r.type, [r]);
    }
    for (const [type, list] of byType) {
      writeResourceCSV(path.join(outputDir, `${type}.csv`), list, type);
    }
  }

  writeSummary(resources: Resource[], outputDir: string): void {
    ensureDir(outputDir);
    writeResourceCSV(path.join(outputDir, "summary.csv"), resources, "summary");
  }
}
