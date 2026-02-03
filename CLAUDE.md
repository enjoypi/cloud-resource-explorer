# cloud-resource-explorer Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-02

## Active Technologies

- TypeScript 5.x + ESM + AWS SDK v3, 阿里云 OpenAPI SDK, pino, commander (001-cloud-resource-explorer)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x + ESM: Follow standard conventions

## Recent Changes

- 001-cloud-resource-explorer: Added TypeScript 5.x + ESM + AWS SDK v3, 阿里云 OpenAPI SDK, pino, commander

<!-- MANUAL ADDITIONS START -->

## 开发说明

### 项目结构
- Monorepo 架构，pnpm workspaces：packages/app（主应用）、packages/sso-validator（SSO 验证器）
- Clean Architecture 分层：entities → use-cases → adapters → frameworks
- 实体定义在 packages/app/src/entities/
- 适配器（云平台 SDK 封装）在 packages/app/src/adapters/
- 业务逻辑在 packages/app/src/use-cases/
- CLI 入口在 packages/app/src/frameworks/

### 构建与运行
- 使用 `pnpm build` 编译 TypeScript
- 使用 `pnpm start` 运行应用（不要直接运行 dist/ 目录，因为 ESM 模块解析问题）
- 开发调试：从 packages/app 目录执行 `node --loader ts-node/esm src/frameworks/cli.ts [参数]`
- 配置文件位置：packages/app/config.yaml

### 依赖管理
- 确保执行 `pnpm install` 安装所有依赖
- 工作区依赖使用 `workspace:*` 版本
- 主要依赖：AWS SDK v3、阿里云 OpenAPI SDK、pino（日志）、yaml（配置）
- 依赖未找到时，检查 pnpm workspace 依赖是否正确链接

### 测试
- 使用 `pnpm test` 运行 vitest 测试
- 使用 fast-check 进行属性测试（Property-based testing）
- 集成测试需要有效的云平台凭证
- 部分测试失败需修复依赖注入和 mock

### 配置
- 默认配置文件：./config.yaml（位于 packages/app 目录）
- 命令行参数会覆盖配置文件设置
- YAML 格式，支持数组和嵌套对象
- 主要配置项：cloud、types、aliyun、aws、outputDir、cacheTtl、concurrency

### TypeScript 配置
- tsconfig.json 中保持 `moduleResolution: "bundler"`
- 使用 `strict: true` 严格模式
- 输出目录：dist/

### 常见问题
- ESM 模块解析错误：确保 tsconfig.json 中 moduleResolution 为 "bundler"
- 依赖找不到：执行 `pnpm install` 重新安装依赖
- 构建失败：先构建 sso-validator 包（`cd packages/sso-validator && pnpm build`）
- CLI 运行报错：使用 `pnpm start` 而非直接运行 dist/ 目录

### 常用命令
```bash
pnpm start              # 运行主应用（使用配置文件）
pnpm start --help       # 显示帮助
pnpm start -f           # 强制刷新，忽略缓存
pnpm start --count-only # 仅统计资源数量
pnpm start --search <q> # 按 IP/名称/ARN 搜索
pnpm build             # 编译 TypeScript
pnpm test              # 运行测试
cd packages/app && ./collect.sh  # 简化脚本（常用操作封装）
```

### 快速开始
1. 配置云账号：在 ~/.aws/config 或 ~/.aliyun/config.json 中配置凭证
2. 编辑 config.yaml：指定要采集的云平台、资源类型、Profile 等
3. 运行采集：`pnpm start`
4. 查看结果：output/ 目录下的 CSV 文件

### 核心功能
- 多云资源采集：AWS + 阿里云
- 缓存加速：按 Profile/Type/Region 缓存，支持强制刷新
- 灵活筛选：命令行参数支持云平台、Profile、Region、账号、资源类型筛选
- 多账号采集：自动支持 AWS Organizations 和阿里云资源目录
- 资源搜索：按 IP、名称、ARN 搜索已采集资源
- IAM 审计：安全审计和极速审计模式

<!-- MANUAL ADDITIONS END -->
