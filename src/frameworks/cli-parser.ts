import { parseArgs } from "node:util";
import type { Config } from "../entities/index.js";
import type { IAMAuditConfig } from "../entities/iam-audit.js";

export const VERSION = "1.0.0";

const MAX_LIST_SIZE = 100;
function parseList(value: string | undefined, maxSize = MAX_LIST_SIZE): string[] {
  if (typeof value !== "string") return [];
  const items = value.split(",").map(s => s.trim()).filter(Boolean);
  if (items.length > maxSize) throw new Error(`参数数量超过限制 (最大 ${maxSize})`);
  return items;
}

export interface CliParseResult {
  config: Partial<Config>;
  configPath: string;
  help: boolean;
  version: boolean;
  iamAudit: boolean;
  iamFast: boolean;
  countOnly: boolean;
  searchQuery: string | undefined;
  auditConfig: Partial<IAMAuditConfig>;
}

export function printHelp(): void {
  console.log(`
云资源采集工具 (Cloud Resource Collector)

Usage: cloud-resource-explorer [options]

Options:
  --cloud <type>          云平台: aws, aliyun, all (default: all)
  --type <types>          资源类型，逗号分隔 (default: all types)

  阿里云选项:
  --aliyun-profile <n>    指定阿里云 Profile，逗号分隔
  --aliyun-region <r>     指定阿里云 Region，逗号分隔
  --aliyun-account <ids>  指定阿里云账号 ID，逗号分隔

  AWS 选项:
  --aws-profile <n>       指定 AWS Profile，逗号分隔
  --aws-region <r>        指定 AWS Region，逗号分隔
  --aws-account <ids>     指定 AWS 账号 ID，逗号分隔

  IAM 审计选项:
  --iam-audit             运行 IAM 安全审计
  --iam-fast              极速审计（仅统计用户，不获取详细数据）
  --audit-key-age <days>  AccessKey 最大年龄天数 (default: 90)
  --audit-unused <days>   AccessKey 未使用天数阈值 (default: 90)
  --audit-login <days>    最后登录时间阈值 (default: 90)

  通用选项:
  --search <query>        搜索资源 (IP、名称、ARN 等)
  --count-only            仅统计资源数量，不采集详细列表
  --output <dir>          输出目录 (default: ./output)
  --log-dir <dir>         日志目录 (default: ./logs)
  --cache-dir <dir>       缓存目录 (default: ./.cache)
  --cache-ttl <min>       缓存有效期，分钟 (default: 60)
  --force-refresh, -f     强制刷新，忽略缓存
  --concurrency <n>       并发数 (default: 5)
  --log-level <level>     日志级别: trace, debug, info, warn, error (default: info)
  --config <path>         配置文件路径 (default: ./config.yaml)
  --help, -h              显示帮助
  --version, -v           显示版本号
`);
}

export function parseCliArgs(): CliParseResult {
  const { values } = parseArgs({
    options: {
      cloud: { type: "string" }, type: { type: "string" },
      "aliyun-profile": { type: "string" }, "aliyun-region": { type: "string" }, "aliyun-account": { type: "string" },
      "aws-profile": { type: "string" }, "aws-region": { type: "string" }, "aws-account": { type: "string" },
      "iam-audit": { type: "boolean" }, "iam-fast": { type: "boolean" }, "count-only": { type: "boolean" }, "search": { type: "string" },
      "audit-key-age": { type: "string" }, "audit-unused": { type: "string" }, "audit-login": { type: "string" },
      output: { type: "string" }, "log-dir": { type: "string" }, "cache-dir": { type: "string" }, "cache-ttl": { type: "string" },
      "force-refresh": { type: "boolean", short: "f" }, concurrency: { type: "string" }, "log-level": { type: "string" },
      config: { type: "string" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
    },
    strict: false,
  });

  const config: Partial<Config> = {};
  if (typeof values.cloud === "string" && ["aws", "aliyun", "all"].includes(values.cloud)) config.cloud = values.cloud as Config["cloud"];
  if (typeof values.type === "string") config.types = parseList(values.type);

  const aliyunProfiles = parseList(values["aliyun-profile"] as string);
  const aliyunRegions = parseList(values["aliyun-region"] as string, 50);
  const aliyunAccounts = parseList(values["aliyun-account"] as string);
  if (aliyunProfiles.length || aliyunRegions.length || aliyunAccounts.length) {
    config.aliyun = { profiles: aliyunProfiles, excludeProfiles: [], regions: aliyunRegions, excludeRegions: [], accounts: aliyunAccounts, excludeAccounts: [] };
  }

  const awsProfiles = parseList(values["aws-profile"] as string);
  const awsRegions = parseList(values["aws-region"] as string, 50);
  const awsAccounts = parseList(values["aws-account"] as string);
  if (awsProfiles.length || awsRegions.length || awsAccounts.length) {
    config.aws = { profiles: awsProfiles, excludeProfiles: [], regions: awsRegions, excludeRegions: [], accounts: awsAccounts, excludeAccounts: [] };
  }

  if (typeof values.output === "string") config.outputDir = values.output;
  if (typeof values["log-dir"] === "string") config.logDir = values["log-dir"];
  if (typeof values["cache-dir"] === "string") config.cacheDir = values["cache-dir"];
  if (typeof values["cache-ttl"] === "string") config.cacheTtl = parseInt(values["cache-ttl"], 10);
  if (values["force-refresh"] === true) config.forceRefresh = true;
  if (typeof values.concurrency === "string") config.concurrency = parseInt(values.concurrency, 10);
  if (typeof values["log-level"] === "string" && ["trace", "debug", "info", "warn", "error", "fatal"].includes(values["log-level"])) {
    config.logLevel = values["log-level"] as Config["logLevel"];
  }

  const auditConfig: Partial<IAMAuditConfig> = {};
  if (typeof values["audit-key-age"] === "string") auditConfig.accessKeyMaxAgeDays = parseInt(values["audit-key-age"], 10);
  if (typeof values["audit-unused"] === "string") auditConfig.accessKeyUnusedDays = parseInt(values["audit-unused"], 10);
  if (typeof values["audit-login"] === "string") auditConfig.lastLoginMaxDays = parseInt(values["audit-login"], 10);

  return {
    config, configPath: typeof values.config === "string" ? values.config : "./config.yaml",
    help: values.help === true, version: values.version === true,
    iamAudit: values["iam-audit"] === true, iamFast: values["iam-fast"] === true, countOnly: values["count-only"] === true,
    searchQuery: typeof values["search"] === "string" ? values["search"] : undefined, auditConfig,
  };
}
