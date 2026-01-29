# SSO Validator

多云 SSO 凭证验证工具，支持 AWS SSO 和阿里云 CloudSSO。

## 安装

```bash
pnpm add @cloud-explorer/sso-validator
```

## 使用

### AWS SSO

```typescript
import { validateAWSSSOSession, parseAWSSSOSessions } from "@cloud-explorer/sso-validator/aws";

// 解析所有 SSO Session
const sessions = parseAWSSSOSessions();

// 验证 Session
const result = await validateAWSSSOSession("my-sso-session");
if (!result.valid) {
  console.log(`请运行: ${result.refreshCommand}`);
}
```

### 阿里云 CloudSSO

```typescript
import { validateAliyunCredential } from "@cloud-explorer/sso-validator/aliyun";

const result = validateAliyunCredential("my-profile");
if (!result.valid) {
  console.log(`请运行: ${result.refreshCommand}`);
  if (result.expiredAt) {
    console.log(`过期时间: ${result.expiredAt}`);
  }
}
```

## API

### AWS

- `parseAWSSSOSessions()` - 解析 `~/.aws/config` 中的 SSO Session
- `validateAWSSSOSession(sessionName)` - 验证 SSO Session 是否有效

### 阿里云

- `validateAliyunCredential(profileName)` - 验证 CloudSSO Profile 是否有效
