# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

多云资源采集工具，支持 AWS 和阿里云资源采集、统计和 IAM 安全审计。

## 常用命令

```bash
pnpm build                                   # 构建
pnpm start                                   # 运行（采集所有资源）
pnpm test                                    # 运行所有测试（vitest）
pnpm test src/frameworks/config-loader.test.ts  # 运行单个测试文件

# CLI 选项
node dist/frameworks/cli.js --cloud aliyun   # 仅阿里云
node dist/frameworks/cli.js --cloud aws      # 仅 AWS
node dist/frameworks/cli.js --count-only     # 仅统计数量
node dist/frameworks/cli.js --iam-audit      # IAM 安全审计
node dist/frameworks/cli.js --iam-fast       # 极速审计（仅统计用户）
node dist/frameworks/cli.js --search <ip>    # 搜索资源
node dist/frameworks/cli.js -f               # 强制刷新缓存

# 调试
DEBUG=1 node dist/frameworks/cli.js          # 显示完整错误堆栈
```

## 技术栈

TypeScript + ESM（模块导入需 `.js` 后缀）、vitest 测试、pino 日志。

## 架构

Clean Architecture 分层，依赖方向：frameworks → use-cases → entities，adapters 实现 use-cases 定义的接口。

**数据流**：CLI 解析参数 → ConfigLoader 合并配置 → Use Case 调用 Adapter → 输出 CSV/JSON

**核心模块**：
- `entities/` - 领域模型（Resource, Config, Profile, IAMAudit）
- `adapters/` - 云平台 SDK 封装（AWS/阿里云）、缓存、CSV 导出、IAM 审计工具
- `use-cases/` - 业务逻辑（collect, export, count, iam-audit）
- `frameworks/` - 入口（cli.ts）、CLI 参数解析（cli-parser.ts）、配置加载（config-loader.ts）
- `utils/` - 日志（pino）、认证错误处理

**关键文件**：
- `adapters/profile-adapter.ts` - 从 ~/.aws/config 和 ~/.aliyun/config.json 发现多账号
- `adapters/aws-iam-audit.ts` / `aliyun-ram-audit.ts` - IAM 风险分析逻辑
- `adapters/iam-audit-utils.ts` - 策略解析、危险操作检测等审计工具函数
- `adapters/iam-audit-export.ts` - 审计报告导出和摘要打印
- `use-cases/iam-audit.ts` - 审计编排（支持 fastMode 极速模式）

## 配置

`config.yaml` 结构（完整示例见 `config.yaml.sample`）：
```yaml
cloud: all | aws | aliyun
types:                         # 资源类型（15 种）
  - cache, cdn, compute, container, database, dns, ebs
  - filesys, iam, kms, network, notify, queue, slb, storage
aliyun/aws:
  profiles: []                 # 包含的 Profile
  excludeProfiles: []          # 排除的 Profile
  regions: []                  # 包含的 Region
  excludeRegions: []           # 排除的 Region
  accounts: []                 # 包含的账号 ID
  excludeAccounts: []          # 排除的账号 ID
  resourceExplorerViewArn: ""  # AWS 组织级视图 ARN（仅 AWS）
outputDir: ./output            # CSV 输出目录
logDir: ./logs                 # 日志目录
cacheDir: ./.cache             # 缓存目录
cacheTtl: 60                   # 缓存有效期（分钟）
concurrency: 5                 # 并发采集任务数
sleepMin: 1                    # API 调用最小间隔（秒）
sleepMax: 3                    # API 调用最大间隔（秒）
logLevel: info                 # 日志级别
```

## 凭证刷新

```bash
aliyun configure --mode CloudSSO --profile <profile>  # 阿里云
aws sso login --sso-session <session-name>            # AWS
```
