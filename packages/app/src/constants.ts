export const TIME = {
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60 * 1000,
  MS_PER_DAY: 24 * 60 * 60 * 1000,
  SECONDS_PER_MINUTE: 60,
} as const;

export const PAGINATION = {
  MAX_RESULTS: 100,
  PAGE_SIZE: 100,
  ORG_ACCOUNTS_PAGE_SIZE: 20,
} as const;

export const TIMEOUT = {
  ALIYUN_CLI: 10000,
  CREDENTIAL_REPORT_MAX_WAIT: 30000,
  CREDENTIAL_REPORT_RETRY_INTERVAL: 2000,
} as const;

export const CACHE = {
  DEFAULT_TTL_MINUTES: 60,
} as const;

export const IAM_AUDIT = {
  DEFAULT_KEY_MAX_AGE_DAYS: 90,
  DEFAULT_KEY_UNUSED_DAYS: 90,
  DEFAULT_LAST_LOGIN_DAYS: 90,
  DEFAULT_MAX_DIRECT_POLICIES: 3,
} as const;

export const CLI = {
  MAX_LIST_SIZE: 100,
  MAX_CONCURRENCY: 20,
  MAX_TTL_MINUTES: 1440,
} as const;

export const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export const UI = {
  SEPARATOR_WIDTH: 60,
  TYPE_COLUMN_WIDTH: 40,
  REGION_COLUMN_WIDTH: 15,
  RESOURCE_TYPE_COLUMN_WIDTH: 35,
} as const;
