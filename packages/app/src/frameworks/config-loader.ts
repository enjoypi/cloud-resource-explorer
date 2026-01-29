import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Config, ProviderConfig } from "../entities/index.js";
import { log } from "../utils/index.js";
import { CACHE } from "../constants.js";

export interface ConfigLoader {
  load(yamlPath: string, cliArgs: Partial<Config>): Config;
}

const DEFAULT_PROVIDER: ProviderConfig = {
  profiles: [],
  excludeProfiles: [],
  regions: [],
  excludeRegions: [],
  accounts: [],
  excludeAccounts: [],
};

const DEFAULT_CONFIG: Config = {
  cloud: "all",
  types: ["compute", "storage", "network", "slb", "database", "cache", "cdn", "dns", "container", "iam"],
  aliyun: { ...DEFAULT_PROVIDER },
  aws: { ...DEFAULT_PROVIDER },
  outputDir: "./output",
  logDir: "./logs",
  cacheDir: "./.cache",
  cacheTtl: CACHE.DEFAULT_TTL_MINUTES,
  forceRefresh: false,
  concurrency: 5,
  sleepMin: 1,
  sleepMax: 3,
  logLevel: "info",
  version: "1.0.0",
};

function mergeProvider(cli?: Partial<ProviderConfig>, yaml?: Partial<ProviderConfig>): ProviderConfig {
  return {
    profiles: cli?.profiles ?? yaml?.profiles ?? DEFAULT_PROVIDER.profiles,
    excludeProfiles: cli?.excludeProfiles ?? yaml?.excludeProfiles ?? DEFAULT_PROVIDER.excludeProfiles,
    regions: cli?.regions ?? yaml?.regions ?? DEFAULT_PROVIDER.regions,
    excludeRegions: cli?.excludeRegions ?? yaml?.excludeRegions ?? DEFAULT_PROVIDER.excludeRegions,
    accounts: cli?.accounts ?? yaml?.accounts ?? DEFAULT_PROVIDER.accounts,
    excludeAccounts: cli?.excludeAccounts ?? yaml?.excludeAccounts ?? DEFAULT_PROVIDER.excludeAccounts,
    resourceExplorerViewArn: cli?.resourceExplorerViewArn ?? yaml?.resourceExplorerViewArn,
  };
}

export class YamlConfigLoader implements ConfigLoader {
  load(yamlPath: string, cliArgs: Partial<Config>): Config {
    let yamlConfig: Partial<Config> = {};
    if (fs.existsSync(yamlPath)) {
      try {
        const content = fs.readFileSync(yamlPath, "utf-8");
        yamlConfig = parseYaml(content) || {};
        log.debug(`Loaded config from ${yamlPath}`);
      } catch (e) {
        log.debug(`Failed to parse ${yamlPath}: ${e}`);
      }
    }
    const merged: Config = {
      cloud: cliArgs.cloud ?? yamlConfig.cloud ?? DEFAULT_CONFIG.cloud,
      types: cliArgs.types ?? yamlConfig.types ?? DEFAULT_CONFIG.types,
      aliyun: mergeProvider(cliArgs.aliyun, yamlConfig.aliyun),
      aws: mergeProvider(cliArgs.aws, yamlConfig.aws),
      outputDir: cliArgs.outputDir ?? yamlConfig.outputDir ?? DEFAULT_CONFIG.outputDir,
      logDir: cliArgs.logDir ?? yamlConfig.logDir ?? DEFAULT_CONFIG.logDir,
      cacheDir: cliArgs.cacheDir ?? yamlConfig.cacheDir ?? DEFAULT_CONFIG.cacheDir,
      cacheTtl: cliArgs.cacheTtl ?? yamlConfig.cacheTtl ?? DEFAULT_CONFIG.cacheTtl,
      forceRefresh: cliArgs.forceRefresh ?? yamlConfig.forceRefresh ?? DEFAULT_CONFIG.forceRefresh,
      concurrency: cliArgs.concurrency ?? yamlConfig.concurrency ?? DEFAULT_CONFIG.concurrency,
      sleepMin: cliArgs.sleepMin ?? yamlConfig.sleepMin ?? DEFAULT_CONFIG.sleepMin,
      sleepMax: cliArgs.sleepMax ?? yamlConfig.sleepMax ?? DEFAULT_CONFIG.sleepMax,
      logLevel: cliArgs.logLevel ?? yamlConfig.logLevel ?? DEFAULT_CONFIG.logLevel,
      version: DEFAULT_CONFIG.version,
    };
    log.info(`Final config: cloud=${merged.cloud}, types=${merged.types.join(",")}`);
    return merged;
  }
}
