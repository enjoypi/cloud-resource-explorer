# SSO Validator

多云 SSO 凭证验证工具，支持 AWS SSO 和阿里云 CloudSSO。

## 安装

```bash
# npm
npm install @cloud-explorer/sso-validator

# pnpm
pnpm add @cloud-explorer/sso-validator

# yarn
yarn add @cloud-explorer/sso-validator
```

## 快速开始

### AWS SSO

```typescript
import { aws } from "@cloud-explorer/sso-validator";

// 解析所有 SSO Session
const sessions = aws.parseAWSSSOSessions();
console.log(`找到 ${sessions.length} 个 SSO Session`);

// 验证 Session
const result = await aws.validateAWSSSOSession("my-sso-session");
if (!result.valid) {
  console.log(`凭证已过期，请运行: ${result.refreshCommand}`);
  if (result.expiredAt) {
    console.log(`过期时间: ${result.expiredAt.toISOString()}`);
  }
} else {
  console.log("✓ SSO Session 有效");
}
```

### 阿里云 CloudSSO

```typescript
import { aliyun } from "@cloud-explorer/sso-validator";

const result = aliyun.validateAliyunCredential("my-profile");
if (!result.valid) {
  console.log(`凭证无效，请运行: ${result.refreshCommand}`);
  if (result.expiredAt) {
    console.log(`过期时间: ${result.expiredAt.toISOString()}`);
  }
} else {
  console.log("✓ 阿里云凭证有效");
}
```

## API 文档

### AWS 模块

#### `parseAWSSSOSessions(): AWSSSOSession[]`

解析 `~/.aws/config` 中的所有 SSO Session 配置。

**返回值**:
```typescript
interface AWSSSOSession {
  name: string;        // Session 名称
  startUrl: string;    // SSO 登录 URL
  region: string;      // AWS Region
  roleName?: string;   // 角色名称（可选）
}
```

#### `validateAWSSSOSession(sessionName: string): Promise<ValidationResult>`

验证指定 SSO Session 的凭证是否有效。

**参数**:
- `sessionName` - SSO Session 名称

**返回值**:
```typescript
interface ValidationResult {
  session: string;         // Session 名称
  valid: boolean;          // 是否有效
  expiredAt?: Date;        // 过期时间
  refreshCommand: string;  // 刷新命令
}
```

### 阿里云模块

#### `validateAliyunCredential(profileName: string): ValidationResult`

验证指定 Profile 的 CloudSSO 凭证是否有效。

**参数**:
- `profileName` - Profile 名称

**返回值**:
```typescript
interface ValidationResult {
  profile: string;          // Profile 名称
  valid: boolean;           // 是否有效
  expiredAt?: Date;         // 过期时间
  refreshCommand?: string;  // 刷新命令
}
```

## 使用场景

### 批量验证多个账号

```typescript
import { aws, aliyun } from "@cloud-explorer/sso-validator";

// AWS
const awsSessions = aws.parseAWSSSOSessions();
for (const session of awsSessions) {
  const result = await aws.validateAWSSSOSession(session.name);
  console.log(`${session.name}: ${result.valid ? "✓" : "✗"}`);
}

// 阿里云
const aliyunProfiles = ["prod", "dev", "test"];
for (const profile of aliyunProfiles) {
  const result = aliyun.validateAliyunCredential(profile);
  console.log(`${profile}: ${result.valid ? "✓" : "✗"}`);
}
```

### 自动刷新过期凭证

```typescript
import { execSync } from "node:child_process";
import { aws } from "@cloud-explorer/sso-validator";

const result = await aws.validateAWSSSOSession("my-session");
if (!result.valid) {
  console.log("凭证已过期，正在刷新...");
  execSync(result.refreshCommand, { stdio: "inherit" });
  console.log("✓ 凭证已刷新");
}
```

## 前置要求

- Node.js >= 18.0.0
- AWS CLI（用于 AWS SSO）
- 阿里云 CLI（用于阿里云 CloudSSO）

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request。
