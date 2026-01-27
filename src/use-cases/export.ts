import type { Resource } from "../entities/index.js";
import type { CSVAdapter } from "../adapters/csv-adapter.js";
import type { LogAdapter, LogEntry } from "../adapters/log-adapter.js";
import { log } from "../utils/index.js";

export interface ExportInput {
  resources: Resource[];
  csvAdapter: CSVAdapter;
  logAdapter: LogAdapter;
  outputDir: string;
}

export interface ExportResult {
  totalResources: number;
  byType: Map<string, number>;
  outputDir: string;
}

export async function exportResources(input: ExportInput): Promise<ExportResult> {
  const { resources, csvAdapter, logAdapter, outputDir } = input;
  const startTime = Date.now();

  csvAdapter.writeByType(resources, outputDir);
  csvAdapter.writeSummary(resources, outputDir);

  const byType = new Map<string, number>();
  for (const r of resources) {
    byType.set(r.type, (byType.get(r.type) || 0) + 1);
  }

  const duration = Date.now() - startTime;
  const logEntry: LogEntry = {
    profile: "export",
    region: "global",
    type: "summary",
    status: "success",
    duration,
    source: "api",
  };
  logAdapter.log(logEntry);

  log.debug(` Exported ${resources.length} resources to ${outputDir}`);
  return { totalResources: resources.length, byType, outputDir };
}
