import * as fs from "node:fs";
import * as path from "node:path";
import { TIME } from "../constants.js";
import { log } from "../utils/index.js";

export interface CacheAdapter {
  getRaw(profile: string, type: string, region: string): any[] | null;
  setRaw(profile: string, type: string, region: string, data: any[]): void;
  isValid(profile: string, type: string, region: string, ttl: number): boolean;
  clear(profile?: string, type?: string, region?: string): void;
  ensureDir(dirPath: string): void;
}

export class FileCacheAdapter implements CacheAdapter {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.ensureDir(cacheDir);
  }

  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }

  private getCacheFilePath(profile: string, type: string, region: string): string {
    const safe = (s: string) => {
      if (s.includes("..") || s.includes("/") || s.includes("\\")) throw new Error(`路径遍历攻击: ${s}`);
      return s.replace(/[^a-zA-Z0-9_-]/g, "_");
    };
    const fileName = `${safe(profile)}_${safe(type)}_${safe(region)}.json`;
    const fullPath = path.resolve(this.cacheDir, fileName);
    if (!fullPath.startsWith(path.resolve(this.cacheDir))) throw new Error("路径遍历攻击");
    return fullPath;
  }

  getRaw(profile: string, type: string, region: string): any[] | null {
    const filePath = this.getCacheFilePath(profile, type, region);
    if (!fs.existsSync(filePath)) {
      log.debug(` Cache miss: ${filePath}`);
      return null;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      log.debug(` Cache hit: ${filePath}, ${data.raw?.length} items`);
      return data.raw;
    } catch (e) {
      log.debug(` Cache read error: ${filePath}`, e);
      return null;
    }
  }

  setRaw(profile: string, type: string, region: string, data: any[]): void {
    const filePath = this.getCacheFilePath(profile, type, region);
    fs.writeFileSync(filePath, JSON.stringify({ timestamp: Date.now(), raw: data }, null, 2), { mode: 0o600 });
    log.debug(` Cache write: ${filePath}, ${data.length} items`);
  }

  isValid(profile: string, type: string, region: string, ttl: number): boolean {
    const filePath = this.getCacheFilePath(profile, type, region);
    if (!fs.existsSync(filePath)) return false;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const valid = Date.now() - (data.timestamp || 0) < ttl * TIME.MS_PER_MINUTE;
      log.debug(` Cache validity: ${filePath}, ttl=${ttl}min, valid=${valid}`);
      return valid;
    } catch { return false; }
  }

  clear(profile?: string, type?: string, region?: string): void {
    if (!fs.existsSync(this.cacheDir)) return;
    for (const file of fs.readdirSync(this.cacheDir)) {
      if (!file.endsWith(".json")) continue;
      const parts = file.replace(".json", "").split("_");
      if (parts.length < 3) continue;
      const [fileProfile, fileType, ...regionParts] = parts;
      const fileRegion = regionParts.join("_");
      if ((!profile || fileProfile === profile) && (!type || fileType === type) && (!region || fileRegion === region)) {
        fs.unlinkSync(path.join(this.cacheDir, file));
        log.debug(` Cache cleared: ${file}`);
      }
    }
  }
}
