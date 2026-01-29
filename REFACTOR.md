# SSO 验证包重构总结

## 变更内容

### 1. 项目结构调整

从单包结构重构为 monorepo：

```
cloud-resource-explorer/
├── packages/
│   ├── sso-validator/          # 新增：独立的 SSO 验证包
│   │   ├── src/
│   │   │   ├── aws.ts          # AWS SSO 验证逻辑
│   │   │   ├── aliyun.ts       # 阿里云 SSO 验证逻辑
│   │   │   └── index.ts        # 统一导出
│   │   ├── test/               # 单元测试
│   │   ├── examples/           # 使用示例
│   │   └── package.json
│   └── app/                    # 主应用（原 src/ 目录）
│       ├── src/
│       └── package.json
├── pnpm-workspace.yaml         # workspace 配置
└── package.json                # 根配置
```

### 2. 独立包功能

`@cloud-explorer/sso-validator` 提供：

- **AWS SSO 验证**
  - `parseAWSSSOSessions()` - 解析 `~/.aws/config` 中的 SSO Session
  - `validateAWSSSOSession(sessionName)` - 验证 Session 有效性

- **阿里云 CloudSSO 验证**
  - `validateAliyunCredential(profileName)` - 验证 Profile 有效性

### 3. 主应用集成

主应用通过 workspace 依赖使用独立包：

```typescript
// packages/app/src/adapters/aws-sso.ts
import { 
  parseAWSSSOSessions, 
  validateAWSSSOSession,
  type AWSSSOSession,
  type ValidationResult
} from "@cloud-explorer/sso-validator/aws";

// packages/app/src/adapters/aliyun-credentials.ts
import { 
  validateAliyunCredential,
  type ValidationResult
} from "@cloud-explorer/sso-validator/aliyun";
```

### 4. 构建流程

```bash
# 根目录执行，自动构建所有包
pnpm build

# 构建顺序：sso-validator → app
```

## 优势

1. **职责分离** - SSO 验证逻辑独立，可单独测试和发布
2. **可复用** - 其他项目可直接引用 `@cloud-explorer/sso-validator`
3. **类型安全** - 完整的 TypeScript 类型定义
4. **易维护** - 单一职责，代码更清晰

## 使用方式

### 独立使用

```typescript
import { aws, aliyun } from "@cloud-explorer/sso-validator";

// AWS
const sessions = aws.parseAWSSSOSessions();
const result = await aws.validateAWSSSOSession("my-session");

// 阿里云
const result = aliyun.validateAliyunCredential("my-profile");
```

### 在主应用中

主应用保持原有 API 不变，内部使用独立包实现。

## 测试

```bash
# 测试 SSO 验证包
cd packages/sso-validator && pnpm test

# 测试主应用
cd packages/app && pnpm test
```
