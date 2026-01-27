import * as fs from "node:fs";
import * as path from "node:path";

export interface LogEntry {
  profile: string;
  region: string;
  type: string;
  status: "success" | "error" | "cached";
  duration: number;
  source: "api" | "cache";
  error?: { type: string; message: string };
}

export interface LogAdapter {
  log(entry: LogEntry): void;
}

export class JsonLogAdapter implements LogAdapter {
  private logFile: string;

  constructor(logDir: string) {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    this.logFile = path.join(logDir, `collect-${new Date().toISOString().split("T")[0]}.log`);
  }

  log(entry: LogEntry): void {
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    console.log(`[LOG] ${logLine}`);
    fs.appendFileSync(this.logFile, logLine + "\n", { mode: 0o600 });
  }
}
