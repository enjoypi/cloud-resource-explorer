#!/usr/bin/env node
import { YamlConfigLoader } from "./config-loader.js";
import { parseCliArgs, printHelp, VERSION } from "./cli-parser.js";
import { SDKProfileAdapter } from "../adapters/profile-adapter.js";
import { FileCacheAdapter } from "../adapters/cache-adapter.js";
import { FileCSVAdapter } from "../adapters/csv-adapter.js";
import { JsonLogAdapter } from "../adapters/log-adapter.js";
import { collect } from "../use-cases/collect.js";
import { exportResources } from "../use-cases/export.js";
import { countResources, printCountSummary } from "../use-cases/count.js";
import { runIAMAudit } from "../use-cases/iam-audit.js";
import { searchAWSResourcesByIP } from "../adapters/aws-resource-explorer.js";
import { writeIAMAuditReport, printAuditSummary } from "../adapters/iam-audit-export.js";
import { log, setLogLevel } from "../utils/index.js";
import { validateAliyunCredential } from "../adapters/aliyun-credentials.js";
import { validateAWSSSOSession } from "../adapters/aws-sso.js";
import type { Config } from "../entities/index.js";
import type { IAMAuditConfig } from "../entities/iam-audit.js";

async function validateCredentials(config: Config): Promise<boolean> {
  const invalidCredentials: string[] = [];
  if (config.cloud === "all" || config.cloud === "aliyun") {
    for (const profile of config.aliyun.profiles) {
      const result = validateAliyunCredential(profile);
      if (result.valid) log.info(`[阿里云] ${profile} 凭证有效 ✓`);
      else invalidCredentials.push(`[阿里云] ${profile} 凭证无效，请执行: ${result.refreshCommand}`);
    }
  }
  if (config.cloud === "all" || config.cloud === "aws") {
    const checkedSessions = new Set<string>();
    for (const profile of config.aws.profiles) {
      if (!checkedSessions.has(profile)) {
        checkedSessions.add(profile);
        const result = await validateAWSSSOSession(profile);
        if (result.valid) log.info(`[AWS] ${profile} SSO 会话有效 ✓`);
        else invalidCredentials.push(`[AWS] ${profile} SSO 会话无效，请执行: ${result.refreshCommand}`);
      }
    }
  }
  if (invalidCredentials.length > 0) {
    log.error("凭证验证失败，请先刷新以下凭证：");
    for (const msg of invalidCredentials) log.error(msg);
    return false;
  }
  return true;
}

async function runIAMAuditMode(config: Config, profileAdapter: SDKProfileAdapter, auditConfig: Partial<IAMAuditConfig>, fastMode = false): Promise<void> {
  log.info(fastMode ? "开始 IAM 极速审计（仅统计用户）..." : "开始 IAM 安全审计...");
  const startTime = Date.now();
  const { results, totalFindings, errors } = await runIAMAudit({ config, auditConfig, profileAdapter, fastMode });
  if (errors.length > 0) {
    log.warn(`${errors.length} 个账号审计失败`);
    for (const e of errors) log.error(`[${e.cloud}] ${e.profile}: ${e.error}`);
  }
  if (results.length > 0) {
    writeIAMAuditReport(results, `${config.outputDir}/iam-audit`);
    printAuditSummary(results);
  } else log.warn("没有完成任何账号的审计");
  log.info(`IAM 审计完成，耗时 ${((Date.now() - startTime) / 1000).toFixed(2)}s，发现 ${totalFindings} 个风险项`);
}

const SENSITIVE_KEYS = ["password", "secret", "key", "token", "credential", "auth"];
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some(s => lower.includes(s));
}

async function runSearch(config: Config, searchQuery: string): Promise<void> {
  log.info(`搜索: ${searchQuery}`);
  const viewArn = config.aws.resourceExplorerViewArn;
  const profileName = config.aws.profiles[0] || "default";
  const aggregatorAccountId = viewArn ? viewArn.split(":")[4] : undefined;
  log.debug(`使用 profile: ${profileName}, viewArn: ${viewArn}, accountId: ${aggregatorAccountId}`);
  const results = await searchAWSResourcesByIP(profileName, searchQuery, aggregatorAccountId, viewArn);
  if (results.length === 0) { log.info("未找到匹配的资源"); return; }
  console.log(`\n找到 ${results.length} 个资源:\n`);
  for (const r of results) {
    console.log(`  ${r.resourceType.padEnd(35)} ${r.region.padEnd(15)} ${r.accountId}`);
    console.log(`    ARN: ${r.arn}`);
    const ipProps = Object.entries(r.properties).filter(([k, v]) =>
      typeof v === "string" && !isSensitiveKey(k) && (v.includes(searchQuery) || k.toLowerCase().includes("ip")));
    for (const [k, v] of ipProps) console.log(`    ${k}: ${v}`);
    console.log();
  }
}

async function main(): Promise<void> {
  const { config: cliConfig, configPath, help, version, iamAudit, iamFast, countOnly, searchQuery, auditConfig } = parseCliArgs();
  if (help) { printHelp(); process.exit(0); }
  if (version) { console.log(VERSION); process.exit(0); }

  const configLoader = new YamlConfigLoader();
  const config = configLoader.load(configPath, cliConfig);
  setLogLevel(config.logLevel);
  const profileAdapter = new SDKProfileAdapter();

  if (iamAudit || iamFast) { await runIAMAuditMode(config, profileAdapter, auditConfig, iamFast); return; }
  if (searchQuery) { await runSearch(config, searchQuery); return; }
  if (!await validateCredentials(config)) process.exit(1);
  if (countOnly) { log.info("统计资源数量..."); printCountSummary(await countResources({ config, profileAdapter })); return; }

  const cacheAdapter = new FileCacheAdapter(config.cacheDir);
  const csvAdapter = new FileCSVAdapter();
  const logAdapter = new JsonLogAdapter(config.logDir);

  log.info("开始资源采集...");
  const startTime = Date.now();
  const { resources, errors } = await collect({ config, profileAdapter, cacheAdapter });
  if (errors.length > 0) {
    log.warn(`${errors.length} 个采集任务失败`);
    for (const e of errors) log.error(`${e.task.profile.name}/${e.task.type}/${e.task.region}: ${e.message}`);
  }
  await exportResources({ resources, csvAdapter, logAdapter, outputDir: config.outputDir });
  log.info(`采集完成，耗时 ${((Date.now() - startTime) / 1000).toFixed(2)}s，共 ${resources.length} 个资源`);
}

main().catch((e) => {
  log.fatal(e instanceof Error ? e.message : String(e));
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
