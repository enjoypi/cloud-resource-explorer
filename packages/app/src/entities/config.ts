export interface ProviderConfig {
  profiles: string[];
  excludeProfiles: string[];
  regions: string[];
  excludeRegions: string[];
  accounts: string[];
  excludeAccounts: string[];
  resourceExplorerViewArn?: string;
}

import type { CdnCostConfig } from "./cdn-cost.js";

export interface Config {
  cloud: "aws" | "aliyun" | "all";
  types: string[];
  aliyun: ProviderConfig;
  aws: ProviderConfig;
  cdnCost: CdnCostConfig;
  outputDir: string;
  logDir: string;
  cacheDir: string;
  cacheTtl: number;
  forceRefresh: boolean;
  concurrency: number;
  sleepMin: number;
  sleepMax: number;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  version: string;
}
