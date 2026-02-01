# Tasks: Cloud Resource Explorer

**Input**: specs/001-cloud-resource-explorer/
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, research.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属用户故事（US1, US2, US3, US4）

## Phase 1: Setup

**Purpose**: 项目初始化（已有项目结构，验证现有代码）

- [ ] T001 验证现有项目结构符合 Clean Architecture
- [ ] T002 [P] 验证 pnpm workspace 配置 in pnpm-workspace.yaml
- [ ] T003 [P] 验证 TypeScript 配置 in packages/app/tsconfig.json

---

## Phase 2: Foundational

**Purpose**: 核心基础设施（阻塞所有用户故事）

- [ ] T004 验证 entities 定义 in packages/app/src/entities/
- [ ] T005 [P] 验证 Config 实体 in packages/app/src/entities/config.ts
- [ ] T006 [P] 验证 Profile 实体 in packages/app/src/entities/profile.ts
- [ ] T007 [P] 验证 Resource 实体 in packages/app/src/entities/resource.ts
- [ ] T008 验证日志适配器 in packages/app/src/adapters/log-adapter.ts
- [ ] T009 验证配置加载器 in packages/app/src/frameworks/config-loader.ts

**Checkpoint**: 基础设施就绪

---

## Phase 3: User Story 1 - 多云资源采集 (P1) 🎯 MVP

**Goal**: 自动发现 Profile，采集资源，生成 CSV

**Independent Test**: `pnpm build && node dist/frameworks/cli.js`

### Implementation

- [ ] T010 [US1] 验证 Profile 发现 in packages/app/src/adapters/profile-adapter.ts
- [ ] T011 [P] [US1] 验证 AWS 凭证工厂 in packages/app/src/adapters/aws-client-factory.ts
- [ ] T012 [P] [US1] 验证阿里云凭证 in packages/app/src/adapters/aliyun-credentials.ts
- [ ] T013 [US1] 验证 AWS 资源采集 in packages/app/src/adapters/aws-resource-explorer.ts
- [ ] T014 [US1] 验证阿里云资源采集 in packages/app/src/adapters/aliyun-resource-center.ts
- [ ] T015 [US1] 验证 CSV 导出 in packages/app/src/adapters/csv-adapter.ts
- [ ] T016 [US1] 验证采集用例（含并发控制和限流重试）in packages/app/src/use-cases/collect.ts
- [ ] T017 [US1] 验证导出用例 in packages/app/src/use-cases/export.ts
- [ ] T018 [US1] 验证 CLI 入口 in packages/app/src/frameworks/cli.ts

**Checkpoint**: US1 完成，可独立测试

---

## Phase 4: User Story 2 - 缓存加速 (P2)

**Goal**: 缓存采集结果，支持强制刷新

**Independent Test**: 执行两次采集，第二次使用缓存；`-f` 强制刷新

### Implementation

- [ ] T019 [US2] 验证缓存适配器 in packages/app/src/adapters/cache-adapter.ts
- [ ] T020 [US2] 集成缓存到采集用例 in packages/app/src/use-cases/collect.ts
- [ ] T021 [US2] 验证 `--force-refresh` 参数 in packages/app/src/frameworks/cli-parser.ts

**Checkpoint**: US2 完成，缓存功能可用

---

## Phase 5: User Story 3 - 灵活筛选 (P2)

**Goal**: 命令行参数筛选采集范围

**Independent Test**: `--cloud aws --type compute` 仅采集 AWS 计算资源

### Implementation

- [ ] T022 [US3] 验证 CLI 参数解析 in packages/app/src/frameworks/cli-parser.ts
- [ ] T023 [US3] 验证筛选逻辑 in packages/app/src/use-cases/collect.ts
- [ ] T024 [US3] 验证配置文件覆盖 in packages/app/src/frameworks/config-loader.ts

**Checkpoint**: US3 完成，筛选功能可用

---

## Phase 6: User Story 4 - 多账号采集 (P3)

**Goal**: SSO 多账号采集（AWS Organizations + 阿里云资源目录）

**Independent Test**: SSO 登录后采集多个成员账号资源

### Implementation

- [ ] T025 [P] [US4] 验证 AWS SSO 适配器 in packages/app/src/adapters/aws-sso.ts
- [ ] T026 [P] [US4] 验证 AWS Organizations in packages/app/src/adapters/aws-organizations.ts
- [ ] T027 [P] [US4] 验证阿里云资源目录 in packages/app/src/adapters/aliyun-resource-directory.ts
- [ ] T028 [US4] 集成多账号到采集用例 in packages/app/src/use-cases/collect.ts

**Checkpoint**: US4 完成，多账号功能可用

---

## Phase 7: User Story 5 - 资源搜索 (P3)

**Goal**: 按 IP/名称/ARN 搜索已采集资源

**Independent Test**: `--search <query>` 返回匹配资源

### Implementation

- [ ] T029 [US5] 验证搜索参数 in packages/app/src/frameworks/cli-parser.ts
- [ ] T030 [US5] 实现搜索用例 in packages/app/src/use-cases/search.ts（如不存在则创建）

**Checkpoint**: US5 完成，搜索功能可用

---

## Phase 8: Polish

**Purpose**: 跨故事优化

- [ ] T031 [P] 验证错误处理 in packages/app/src/utils/auth-error.ts
- [ ] T032 [P] 验证日志脱敏 in packages/app/src/adapters/log-adapter.ts
- [ ] T033 运行 `pnpm build` 确保编译通过
- [ ] T034 运行 `pnpm test` 确保测试通过

---

## Dependencies

### Phase Dependencies

```
Setup (P1) → Foundational (P2) → US1 (P3) → US2/US3 (P4/P5) → US4/US5 (P6/P7) → Polish (P8)
```

### User Story Dependencies

- **US1**: 无依赖，MVP
- **US2**: 依赖 US1（缓存需要采集功能）
- **US3**: 依赖 US1（筛选需要采集功能）
- **US4**: 依赖 US1（多账号需要采集功能）
- **US5**: 依赖 US1（搜索需要采集功能）

### Parallel Opportunities

```bash
# Phase 2 并行
T005, T006, T007  # entities 验证

# US1 并行
T011, T012        # 凭证适配器

# US4 并行
T025, T026, T027  # 多账号适配器
```

---

## Implementation Strategy

### MVP (US1 Only)

1. Phase 1-2: Setup + Foundational
2. Phase 3: US1 多云资源采集
3. **验证**: `pnpm build && node dist/frameworks/cli.js`

### Incremental

1. MVP → US2 缓存 → US3 筛选 → US4 多账号 → US5 搜索
2. 每个故事独立可测试

---

## Summary

| 指标 | 值 |
|------|-----|
| 总任务数 | 34 |
| US1 任务 | 9 |
| US2 任务 | 3 |
| US3 任务 | 3 |
| US4 任务 | 4 |
| US5 任务 | 2 |
| 可并行任务 | 13 |
| MVP 范围 | US1 (Phase 1-3) |
