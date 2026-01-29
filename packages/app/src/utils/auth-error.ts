import { log } from "./logger.js";

function isTokenExpiredError(error: any): boolean {
  const msg = String(error?.message || error).toLowerCase();
  return msg.includes("securitytoken") && msg.includes("expired");
}

export function logAliyunAuthError(profileName: string, error: any): void {
  if (isTokenExpiredError(error)) {
    log.error(`阿里云凭证已过期，请刷新 Token：aliyun configure --mode CloudSSO --profile ${profileName}`);
  } else {
    log.warn(`阿里云 API 错误 ${profileName}: ${error?.message || error}`);
  }
}
