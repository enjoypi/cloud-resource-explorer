# Implementation Plan: Cloud Resource Explorer

**Branch**: `001-cloud-resource-explorer` | **Date**: 2026-02-01 | **Spec**: [spec.md](./spec.md)

## Summary

多云资源采集工具，支持 AWS 和阿里云的资源采集、缓存、导出和搜索。采用 Clean Architecture 分层，TypeScript + ESM 实现。

## Technical Context

**Language/Version**: TypeScript 5.x + ESM
**Primary Dependencies**: AWS SDK v3, 阿里云 OpenAPI SDK, pino, commander
**Storage**: 文件系统（JSON 缓存 + CSV 导出）
**Testing**: vitest
**Target Platform**: Node.js 18+ / deno
**Project Type**: Monorepo (pnpm workspace)
**Performance Goals**: 单账号全类型采集 < 5 分钟
**Constraints**: 并发数默认 3，缓存 TTL 默认 60 分钟
**Scale/Scope**: 支持 15 种资源类型，多账号（Organizations/资源目录）

## Constitution Check

| 原则 | 状态 | 说明 |
|------|------|------|
| I. TypeScript 优先 | ✅ | TypeScript + pnpm + deno |
| II. 简洁至上 | ✅ | Clean Architecture 分层，函数 ≤64 行 |
| III. 可观测性 | ✅ | pino 结构化日志，DEBUG 级别 |

## Project Structure

### Documentation

```text
specs/001-cloud-resource-explorer/
├── plan.md              # 本文件
├── spec.md              # 功能规格
├── research.md          # 技术调研（已完成）
├── data-model.md        # 数据模型
└── tasks.md             # 任务分解
```

### Source Code

```text
packages/
├── app/                 # 主应用
│   └── src/
│       ├── entities/    # 领域模型
│       ├── adapters/    # 云平台 SDK 封装
│       ├── use-cases/   # 业务逻辑
│       ├── frameworks/  # CLI 入口
│       └── utils/       # 工具函数
└── sso-validator/       # SSO 凭证验证独立包
```

**Structure Decision**: 已有 Monorepo 结构，遵循 Clean Architecture 分层

## Architecture

### 分层依赖

```
frameworks (CLI) → use-cases → entities
                      ↓
                  adapters (SDK)
```

### 核心模块

| 模块 | 职责 | 文件 |
|------|------|------|
| Profile 发现 | 读取本地配置文件 | `profile-adapter.ts` |
| 资源采集 | 调用云 API 采集资源 | `aliyun-resource-center.ts`, `aws-resource-explorer.ts` |
| 缓存管理 | 按 Profile/Type/Region 缓存 | `cache-adapter.ts` |
| CSV 导出 | UTF-8 BOM 编码输出 | `csv-adapter.ts` |
| 日志 | pino 结构化日志 | `log-adapter.ts` |
| 多账号 | Organizations/资源目录 | `aws-organizations.ts`, `aliyun-resource-directory.ts` |

### 配置结构 (YAML)

```yaml
cloud: all                    # aws | aliyun | all
concurrency: 3                # 并发数
cache:
  ttl: 60                     # 分钟
  dir: ./.cache
retry:
  maxAttempts: 3              # 最大重试次数
  backoff: exponential        # 退避策略
output:
  dir: ./output
  format: csv
log:
  level: info
  dir: ./logs
```

## Phases

### Phase 1: 核心采集 (P1)

- Profile 发现与认证
- 资源采集（15 种类型）
- CSV 导出

### Phase 2: 缓存与筛选 (P2)

- 缓存机制
- 命令行筛选参数
- 配置文件支持

### Phase 3: 多账号与搜索 (P3)

- AWS Organizations 支持
- 阿里云资源目录支持
- 资源搜索功能
