# Feature Specification: Cloud Resource Explorer

**Feature Branch**: `001-cloud-resource-explorer`
**Created**: 2026-02-01
**Status**: Draft
**Input**: 基于 requirements.md 生成

## User Scenarios & Testing

### User Story 1 - 多云资源采集 (Priority: P1)

运维人员执行采集命令，系统自动发现本地配置的 AWS 和阿里云 Profile，按资源类型和区域采集资源，生成 CSV 清单。

**Why this priority**: 核心功能，无此功能产品无价值

**Independent Test**: 执行 `node dist/frameworks/cli.js`，验证生成 CSV 文件包含资源数据

**Acceptance Scenarios**:

1. **Given** 本地已配置 AWS/阿里云 Profile，**When** 执行采集命令，**Then** 系统发现所有 Profile 并采集资源
2. **Given** Profile 凭证有效，**When** 采集完成，**Then** 生成包含资源信息的 CSV 文件
3. **Given** 某个 Profile 凭证过期，**When** 采集该 Profile，**Then** 记录错误并继续处理其他 Profile

---

### User Story 2 - 缓存加速 (Priority: P2)

运维人员重复执行采集，系统使用缓存数据避免重复 API 调用，支持强制刷新。

**Why this priority**: 提升效率，减少 API 调用成本

**Independent Test**: 执行两次采集，第二次应显著更快；使用 `-f` 参数强制刷新

**Acceptance Scenarios**:

1. **Given** 缓存文件存在且未过期，**When** 执行采集，**Then** 使用缓存数据
2. **Given** 使用 `-f` 参数，**When** 执行采集，**Then** 忽略缓存重新采集
3. **Given** 某个 Region 采集失败，**When** 重试，**Then** 其他 Region 缓存不受影响

---

### User Story 3 - 灵活筛选 (Priority: P2)

运维人员通过命令行参数筛选采集范围（云平台、Profile、Region、账号、资源类型）。

**Why this priority**: 支持精确控制采集范围，适应不同场景

**Independent Test**: 使用 `--cloud aws --type compute` 仅采集 AWS 计算资源

**Acceptance Scenarios**:

1. **Given** 指定 `--cloud aws`，**When** 执行采集，**Then** 仅采集 AWS 资源
2. **Given** 指定 `--type compute,storage`，**When** 执行采集，**Then** 仅采集指定类型
3. **Given** 指定 `--exclude-profile test`，**When** 执行采集，**Then** 排除 test Profile

---

### User Story 4 - 多账号采集 (Priority: P3)

运维人员通过 SSO 登录，系统自动获取组织/资源目录下所有成员账号并采集资源。

**Why this priority**: 企业级多账号管理需求

**Independent Test**: SSO 登录后执行采集，验证采集到多个成员账号资源

**Acceptance Scenarios**:

1. **Given** AWS SSO 登录成功，**When** 执行采集，**Then** 通过 Organizations 获取所有成员账号
2. **Given** 阿里云 CloudSSO 登录成功，**When** 执行采集，**Then** 通过资源目录获取所有成员账号
3. **Given** 成员账号列表，**When** 采集资源，**Then** 使用 AssumeRole 切换账号采集
4. **Given** 采集完成，**When** 查看结果，**Then** 资源记录包含成员账号 ID 和名称

---

### User Story 5 - 资源搜索 (Priority: P3)

运维人员通过命令行搜索已采集的资源，支持按 IP、名称、ARN 匹配。

**Why this priority**: 提升资源查找效率

**Independent Test**: `--search <query>` 返回匹配资源

**Acceptance Scenarios**:

1. **Given** 已采集资源，**When** 使用 `--search 10.0.`，**Then** 返回 IP 匹配的资源
2. **Given** 已采集资源，**When** 使用 `--search web-server`，**Then** 返回名称匹配的资源
3. **Given** 已采集资源，**When** 使用 `--search arn:aws:`，**Then** 返回 ARN 匹配的资源

---

### Edge Cases

- Profile 凭证过期或无效时，记录错误并跳过
- 某个 Region API 调用失败时，继续处理其他 Region
- API 限流（429/Throttling）时，使用指数退避重试（初始延迟 1 秒，每次重试延迟翻倍，最大延迟 30 秒），最多 3 次
- 网络超时时，记录错误并继续
- 配置文件不存在时，使用默认值

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 自动发现 `~/.aws/config` 和 `~/.aliyun/config.json` 中的 Profile
- **FR-002**: 系统 MUST 识别 SSO Session 和 CloudSSO Session 关联关系
- **FR-003**: 系统 MUST 按 Profile × Resource_Type × Region 组合创建采集任务
- **FR-004**: 系统 MUST 区分全局资源和区域资源的采集方式
- **FR-005**: 系统 MUST 生成 UTF-8 with BOM 编码的 CSV 文件
- **FR-006**: 系统 MUST 按 Profile/Type/Region 粒度缓存采集结果（默认 TTL 60 分钟，可配置）
- **FR-007**: 系统 MUST 支持命令行参数覆盖配置文件
- **FR-008**: 系统 MUST 输出结构化日志（pino）
- **FR-009**: 系统 MUST 对日志中的 IP 和资源 ID 进行脱敏处理
- **FR-010**: 系统 MUST 禁止记录任何凭证信息
- **FR-011**: 系统 MUST 支持 AWS Organizations 多账号采集（通过 AssumeRole）
- **FR-012**: 系统 MUST 默认使用 3 个并发采集任务（可配置）
- **FR-013**: 系统 MUST 在 API 限流时使用指数退避重试，最多 3 次（可配置）
- **FR-014**: 系统 MUST 支持按 IP、名称、ARN 搜索已采集资源

### Key Entities

- **Profile**: 云账号配置，包含云平台类型、认证方式、关联 Session
- **Resource**: 云资源，包含 ID、名称、类型、区域、账号、tags
- **Collect_Task**: 采集任务，由 Profile + Type + Region 组成
- **Cache**: 缓存条目，按 Profile/Type/Region 唯一标识

## Success Criteria

### Measurable Outcomes

- **SC-001**: 运维人员可在 5 分钟内完成单账号全类型资源采集
- **SC-002**: 缓存命中时（默认 TTL 60 分钟），采集时间减少 90% 以上
- **SC-003**: 支持 15 种资源类型的采集
- **SC-004**: 单个 Profile 失败不影响其他 Profile 采集
- **SC-005**: 生成的 CSV 文件可直接在 Excel 中打开且中文正常显示

## Clarifications

### Session 2026-02-01

- Q: AWS 是否支持 Organizations 多账号采集？ → A: 支持，与阿里云 CloudSSO 对等
- Q: 缓存默认 TTL？ → A: 60 分钟（可通过配置文件设置）
- Q: 默认并发数？ → A: 3（可通过配置文件设置）
- Q: API 限流处理策略？ → A: 指数退避重试，最多 3 次（可通过配置文件设置）
- Q: 资源搜索功能是否纳入范围？ → A: 纳入，支持按 IP/名称/ARN 搜索

### Session 2026-02-02

- Q: API 限流时的指数退避重试具体参数？ → A: 初始延迟 1 秒，每次重试延迟翻倍（2^attempt × baseDelay），最大延迟 30 秒，总超时时间 120 秒
