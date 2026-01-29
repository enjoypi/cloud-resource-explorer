import { LOG_LEVELS } from "../constants.js";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_PRIORITY: Record<LogLevel, number> = LOG_LEVELS;

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatMessage(level: LogLevel, msg: string, obj?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
  if (obj !== undefined) {
    return `${base} ${typeof obj === "object" ? JSON.stringify(obj) : obj}`;
  }
  return base;
}

export const log = {
  trace: (msg: string, obj?: unknown) => shouldLog("trace") && console.debug(formatMessage("trace", msg, obj)),
  debug: (msg: string, obj?: unknown) => shouldLog("debug") && console.debug(formatMessage("debug", msg, obj)),
  info: (msg: string, obj?: unknown) => shouldLog("info") && console.info(formatMessage("info", msg, obj)),
  warn: (msg: string, obj?: unknown) => shouldLog("warn") && console.warn(formatMessage("warn", msg, obj)),
  error: (msg: string, obj?: unknown) => shouldLog("error") && console.error(formatMessage("error", msg, obj)),
  fatal: (msg: string, obj?: unknown) => shouldLog("fatal") && console.error(formatMessage("fatal", msg, obj)),
};

export default log;
