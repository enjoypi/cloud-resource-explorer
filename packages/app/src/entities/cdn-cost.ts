// CDN 用量与费用账期记录。月份均为 UTC 账期（YYYY-MM）。
export interface CdnCostRecord {
  cloud: "aws" | "aliyun";
  profile: string;
  accountId: string;
  month: string;
  /** CloudFront | CDN | DCDN 等产品名 */
  product: string;
  /** CDN 域名或 CloudFront Distribution 标识；账号级费用行为 ACCOUNT_TOTAL_DOMAIN */
  domain: string;
  /** null 表示该行无此维度数据（如 AWS 账号级费用行没有流量明细） */
  trafficGB: number | null;
  requests: number | null;
  cost: number | null;
  currency: string;
  collectedAt: string;
}

/** AWS Cost Explorer 对 CloudFront 仅能给到账号级费用，用此标识区分明细行 */
export const ACCOUNT_TOTAL_DOMAIN = "ACCOUNT_TOTAL";

export interface CdnCostError {
  cloud: "aws" | "aliyun";
  profile: string;
  /** 出错的范围，如账号 ID、distribution ID、账期 */
  scope: string;
  message: string;
}

export interface CdnCostConfig {
  /** 采集最近 N 个完整月（外加本月至今） */
  months: number;
  /** 阿里云 BSS endpoint：国内站 business.aliyuncs.com，国际站 business.ap-southeast-1.aliyuncs.com */
  aliyunBssEndpoint: string;
}
