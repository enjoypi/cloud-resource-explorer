import { execSync } from "node:child_process";

export interface ValidationResult {
  profile: string;
  valid: boolean;
  expiredAt?: Date;
  refreshCommand?: string;
}

function sanitizeProfileName(name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`无效的 profile 名称: ${name}`);
  return name;
}

export function validateAliyunCredential(profileName: string): ValidationResult {
  const safeName = sanitizeProfileName(profileName);
  const result: ValidationResult = { profile: profileName, valid: false };
  try {
    const config = JSON.parse(execSync(`aliyun configure get --profile ${safeName}`, { encoding: "utf-8", timeout: 10000 }));
    if (config.mode === "CloudSSO") {
      if (!config.access_key_id || !config.sts_token) {
        result.refreshCommand = `aliyun configure --mode CloudSSO --profile ${profileName}`;
        return result;
      }
      if (config.sts_expiration) {
        const expiredAt = new Date(config.sts_expiration * 1000);
        result.expiredAt = expiredAt;
        if (expiredAt < new Date()) {
          result.refreshCommand = `aliyun configure --mode CloudSSO --profile ${profileName}`;
          return result;
        }
      }
    }
    result.valid = true;
  } catch {
    result.refreshCommand = `aliyun configure --mode CloudSSO --profile ${profileName}`;
  }
  return result;
}
