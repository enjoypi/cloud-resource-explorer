# Implementation Plan: Cloud Resource Explorer

**Branch**: `001-cloud-resource-explorer` | **Date**: 2026-02-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-cloud-resource-explorer/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

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
**Constraints**: 并发数默认 3，缓存 TTL 默认 60 分钟，重试策略：初始延迟 1 秒，最大延迟 30 秒，总超时 120 秒
**Scale/Scope**: 支持 15 种资源类型，多账号（Organizations/资源目录）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. TypeScript 优先 | ✅ | TypeScript + pnpm + deno |
| II. 简洁至上 | ✅ | Clean Architecture 分层，函数 ≤64 行 |
| III. 可观测性 | ✅ | pino 结构化日志，DEBUG 级别 |

## Project Structure

### Documentation (this feature)

```text
specs/001-cloud-resource-explorer/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

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

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations detected. All constitutional requirements are satisfied.
