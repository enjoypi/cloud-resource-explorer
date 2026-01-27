# Requirements Document

## Introduction

云资源采集汇总工具（Resource_Collector）从多个云账号采集资源信息，汇总成统一格式的资源清单。

## Glossary

- **Resource_Collector**: 资源采集器，本系统的核心组件
- **Profile**: 云账号配置
- **SSO_Session**: AWS SSO 登录会话，一个 SSO 会话可关联多个 Profile
- **CloudSSO_Session**: 阿里云 CloudSSO 登录会话，可访问资源目录下所有成员账号
- **Resource_Directory**: 阿里云资源目录，管理多个成员账号的组织结构
- **RD_Account**: 资源目录成员账号，属于某个资源目录的云账号
- **Resource_Type**: 资源类型标识符（compute、storage、network 等）
- **Region**: 云平台区域标识符
- **Collect_Task**: 采集任务，由 Profile + Resource_Type + Region 组成
- **Global_Resource**: 全局资源，不区分 Region（storage、cdn、dns、iam）
- **Regional_Resource**: 区域资源，需按 Region 采集（compute、network、slb、database、cache、container 等）

## Requirements

### Requirement 1: Profile 发现与认证

**User Story:** 作为运维人员，我希望系统自动发现和管理云账号配置，以便无需手动配置即可采集多账号资源。

#### Acceptance Criteria

1. WHEN 脚本执行，THE Resource_Collector SHALL 自动发现所有已配置的 Profile <!-- REQ-001 -->
2. WHEN 发现 AWS SSO Profile 或阿里云 CloudSSO Profile，THE Resource_Collector SHALL 识别其关联的 SSO_Session 或 CloudSSO_Session <!-- REQ-002 -->
3. IF SSO_Session 或 CloudSSO_Session 凭证无效或过期，THEN THE Resource_Collector SHALL 记录 SSOSessionError 并跳过该 Session 下所有 Profile 或成员账号 <!-- REQ-007 -->

### Requirement 2: 资源采集

**User Story:** 作为运维人员，我希望系统按资源类型和区域采集云资源，以便获取完整的资源清单。

#### Acceptance Criteria

1. WHEN 采集资源，THE Resource_Collector SHALL 按资源类型采集对应字段（名称、ID、状态、区域、project、tags 等） <!-- REQ-003 -->
2. WHEN 采集 Regional_Resource，THE Resource_Collector SHALL 获取可用区域列表 <!-- REQ-004 -->
3. WHEN 生成 Regional_Resource 采集任务，THE Resource_Collector SHALL 为每个 Profile × Resource_Type × Region 组合创建独立的 Collect_Task <!-- REQ-005 -->
4. WHEN 生成 Global_Resource 采集任务，THE Resource_Collector SHALL 为每个 Profile × Resource_Type 组合创建一个 Collect_Task，并使用全局标识作为 Region <!-- REQ-006 -->
5. IF 某个 Collect_Task 失败，THEN THE Resource_Collector SHALL 记录 CollectError 并继续处理其他 Collect_Task <!-- REQ-008 -->
6. WHEN 采集资源，THE Resource_Collector SHALL 同时获取并记录资源所属的云账号 ID <!-- REQ-042 -->

### Requirement 3: 输出文件

**User Story:** 作为运维人员，我希望系统生成格式规范的 CSV 文件，以便在 Excel 等工具中查看和分析资源清单。

#### Acceptance Criteria

1. WHEN 生成输出文件，THE Resource_Collector SHALL 使用 UTF-8 with BOM 编码格式 <!-- REQ-009 -->
2. WHEN 写入资源清单，THE Resource_Collector SHALL 包含以下列：云平台、Profile、账号 ID、资源类型、资源 ID、名称、区域、project、tags、采集时间 <!-- REQ-010 -->
3. WHEN 导出资源，THE Resource_Collector SHALL 按资源类型生成独立文件和汇总文件 <!-- REQ-011 -->

### Requirement 4: 缓存机制

**User Story:** 作为运维人员，我希望系统缓存采集结果，以便减少重复 API 调用并加速后续采集。

#### Acceptance Criteria

1. WHEN 缓存采集结果，THE Resource_Collector SHALL 按 Profile、资源类型、Region 组合唯一标识缓存文件 <!-- REQ-012 -->
2. WHEN 创建缓存、输出或日志目录，THE Resource_Collector SHALL 设置仅限所有者读写的安全权限 <!-- REQ-013 -->
3. WHEN 缓存文件存在且在有效期内，THE Resource_Collector SHALL 使用缓存数据 <!-- REQ-014 -->
4. IF 某个 Region 采集失败，THEN THE Resource_Collector SHALL 保留其他 Region 的缓存不受影响 <!-- REQ-015 -->

### Requirement 5: 配置管理

**User Story:** 作为运维人员，我希望通过配置文件和命令行参数控制采集行为，以便灵活适应不同场景。

#### Acceptance Criteria

1. WHEN 加载配置，THE Resource_Collector SHALL 从配置文件读取配置 <!-- REQ-016 -->
2. WHEN 同时存在命令行参数和配置文件配置，THE Resource_Collector SHALL 使用命令行参数值覆盖配置文件值 <!-- REQ-017 -->
3. WHEN 解析 --cloud 参数，THE Resource_Collector SHALL 接受 aws、aliyun 或 all 作为有效值 <!-- REQ-018 -->
4. WHEN 解析 --type 参数，THE Resource_Collector SHALL 接受逗号分隔的资源类型列表或 all 关键字 <!-- REQ-019 -->
5. WHEN 解析 --profile 参数，THE Resource_Collector SHALL 仅采集指定的 Profile <!-- REQ-020 -->
6. WHEN 解析 --exclude-profile 参数，THE Resource_Collector SHALL 排除指定的 Profile <!-- REQ-021 -->
7. WHEN 解析 --region 参数，THE Resource_Collector SHALL 仅采集指定的 Region（适用于所有云平台） <!-- REQ-022 -->
8. WHEN 解析 --exclude-region 参数，THE Resource_Collector SHALL 排除指定的 Region（适用于所有云平台） <!-- REQ-023 -->
9. WHEN 解析 --output 参数，THE Resource_Collector SHALL 使用指定目录作为输出目录 <!-- REQ-024 -->
10. WHEN 解析 --log-dir 参数，THE Resource_Collector SHALL 使用指定目录作为日志目录 <!-- REQ-025 -->
11. WHEN 解析 --cache-dir 参数，THE Resource_Collector SHALL 使用指定目录作为缓存目录 <!-- REQ-026 -->
12. WHEN 解析 --cache-ttl 参数，THE Resource_Collector SHALL 使用指定值作为缓存有效期（分钟） <!-- REQ-027 -->
13. WHEN 解析 --force-refresh 或 -f 参数，THE Resource_Collector SHALL 忽略缓存强制重新采集 <!-- REQ-028 -->
14. WHEN 解析 --concurrency 参数，THE Resource_Collector SHALL 使用指定值作为并发数，以 Collect_Task 为并发单位 <!-- REQ-029 -->
15. WHEN 解析 --sleep-min 和 --sleep-max 参数，THE Resource_Collector SHALL 在每个采集任务之间随机等待指定范围的秒数 <!-- REQ-040 -->
16. WHEN 解析 --log-level 参数，THE Resource_Collector SHALL 接受标准日志级别作为有效值 <!-- REQ-041 -->
17. WHEN 未指定 --output 参数，THE Resource_Collector SHALL 使用预设的默认输出目录 <!-- REQ-037 -->
18. WHEN 未指定 --log-dir 参数，THE Resource_Collector SHALL 使用预设的默认日志目录 <!-- REQ-038 -->
19. WHEN 未指定 --cache-dir 参数，THE Resource_Collector SHALL 使用预设的默认缓存目录 <!-- REQ-039 -->

### Requirement 6: 日志与安全

**User Story:** 作为运维人员，我希望系统记录结构化日志并保护敏感信息，以便追踪采集过程并确保安全合规。

#### Acceptance Criteria

1. WHEN 记录日志，THE Resource_Collector SHALL 输出机器可解析的结构化日志，包含 Profile、Region、资源类型、状态、耗时、数据来源字段 <!-- REQ-030 -->
2. WHEN 记录包含 IP 地址的日志，THE Resource_Collector SHALL 对 IP 进行部分脱敏处理 <!-- REQ-031 -->
3. WHEN 记录包含资源 ID 的日志，THE Resource_Collector SHALL 对资源 ID 进行截断处理 <!-- REQ-032 -->
4. IF 发生错误，THEN THE Resource_Collector SHALL 仅记录错误类型和错误消息 <!-- REQ-033 -->
5. WHEN 记录日志或输出，THE Resource_Collector SHALL 禁止记录任何凭证信息（Access Key ID、Secret Access Key、API Key、Token、Session Token、Refresh Token、Private Key、Certificate、密码等） <!-- REQ-034 -->

### Requirement 7: CLI 帮助与版本

**User Story:** 作为运维人员，我希望通过命令行获取帮助和版本信息，以便了解工具用法和当前版本。

#### Acceptance Criteria

1. WHEN 解析 --help 或 -h 参数，THE Resource_Collector SHALL 显示包含所有参数说明的帮助信息并以退出码 0 退出 <!-- REQ-035 -->
2. WHEN 解析 --version 或 -v 参数，THE Resource_Collector SHALL 显示语义化版本号并以退出码 0 退出 <!-- REQ-036 -->

### Requirement 8: 阿里云 CloudSSO 支持

**User Story:** 作为运维人员，我希望系统支持阿里云 CloudSSO 和资源目录，以便通过单一入口采集多个成员账号的资源。

#### Acceptance Criteria

1. WHEN 阿里云 SSO 登录成功，THE Resource_Collector SHALL 通过资源目录 API 获取所有成员账号列表 <!-- REQ-043 -->
2. WHEN 采集资源目录成员账号资源，THE Resource_Collector SHALL 使用 CloudSSO 的 AssumeRole 能力切换到目标账号 <!-- REQ-044 -->
3. WHEN 生成阿里云 SSO 账号采集任务，THE Resource_Collector SHALL 为每个成员账号 × Resource_Type × Region 组合创建独立的 Collect_Task <!-- REQ-045 -->
4. WHEN 采集阿里云 SSO 成员账号资源，THE Resource_Collector SHALL 记录资源所属的成员账号 ID 和账号名称 <!-- REQ-046 -->

### Requirement 9: 账号筛选

**User Story:** 作为运维人员，我希望按账号 ID 筛选采集范围，以便精确控制需要采集的云账号。

#### Acceptance Criteria

1. WHEN 解析 --aliyun-account 参数，THE Resource_Collector SHALL 仅采集指定的阿里云账号 ID <!-- REQ-047 -->
2. WHEN 解析 --exclude-aliyun-account 参数，THE Resource_Collector SHALL 排除指定的阿里云账号 ID <!-- REQ-048 -->
3. WHEN 解析 --aws-account 参数，THE Resource_Collector SHALL 仅采集指定的 AWS 账号 ID <!-- REQ-049 -->
4. WHEN 解析 --exclude-aws-account 参数，THE Resource_Collector SHALL 排除指定的 AWS 账号 ID <!-- REQ-050 -->
