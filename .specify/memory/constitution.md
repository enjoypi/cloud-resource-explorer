<!--
Sync Impact Report
==================
Version: 0.0.0 → 1.0.0 (MAJOR: 初始化项目宪法)
Added Principles:
  - I. TypeScript 优先
  - II. 简洁至上
  - III. 可观测性
Added Sections:
  - 技术栈约束
  - 开发工作流
Templates: 待同步
-->

# Cloud Resource Explorer Constitution

## Core Principles

### I. TypeScript 优先
- MUST 使用 TypeScript 编写所有代码
- MUST 使用 `pnpm` 作为包管理器
- MUST 使用 `deno` 直接执行 TypeScript（开发阶段无需构建）
- MUST 确保编译通过后再提交代码

### II. 简洁至上
- MUST 函数不超过 64 行，文件不超过 256 行
- MUST 遵循 SRP, OCP, DIP, DRY, KISS, YAGNI 原则
- MUST 高内聚低耦合：单一模块专注单一职责，通过抽象隔离变更
- SHOULD 注释仅用于复杂业务逻辑、算法或 Trick

### III. 可观测性
- MUST 在关键路径添加 DEBUG 级别日志
- MUST 使用结构化日志（pino）
- MUST 错误输出到 stderr，正常输出到 stdout

## 技术栈约束

| 类别 | 选择 |
|------|------|
| 语言 | TypeScript + ESM |
| 包管理 | pnpm |
| 运行时 | deno（开发）/ Node.js（生产） |
| 测试 | vitest |
| 日志 | pino |
| 配置 | YAML |
| 架构 | Clean Architecture |

## 开发工作流

- CLI 命令 MUST 支持非交互模式（`-y`, `--yes`, `--force`, `--quiet`）
- 文档和注释 MUST 使用中文 (zh-CN)
- 非必要不生成文档，禁止废话与重复内容

## Governance

- 宪法优先于所有其他实践
- 修订需要文档记录和迁移计划
- 所有 PR/Review 必须验证合规性

**Version**: 1.0.0 | **Ratified**: 2026-02-01 | **Last Amended**: 2026-02-01
