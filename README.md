# Cloud Resource Explorer

多云资源采集工具，支持 AWS 和阿里云的资源采集、统计、搜索和 IAM 安全审计。

## 项目结构

```
cloud-resource-explorer/
├── packages/
│   ├── sso-validator/    # SSO 凭证验证独立包
│   └── app/              # 主应用
```

## 功能

- **资源采集** - 自动发现本地 Profile，采集 15 种资源类型（compute, database, storage, network 等）
- **多账号支持** - AWS Organizations / 阿里云资源目录，SSO 会话管理
- **资源统计** - 按 Profile/Region/类型统计资源数量
- **资源搜索** - 按 IP、名称、ARN 搜索（AWS）
- **IAM 安全审计** - AccessKey 过期/未使用、MFA 未启用、管理员权限、危险操作等风险检测
- **智能缓存** - 按 Profile/Type/Region 粒度缓存，支持 TTL 和强制刷新
- **CSV 导出** - 按资源类型生成独立文件和汇总文件

## 快速开始

```bash
# 安装依赖
pnpm install

# 构建（包括 sso-validator 和主应用）
pnpm build

# 复制并编辑配置
cp packages/app/config.yaml.sample packages/app/config.yaml

# 运行（采集所有资源）
cd packages/app && pnpm start
```

## 凭证配置

工具自动从本地配置文件发现账号：
- **AWS** - `~/.aws/config`（支持 SSO Session）
- **阿里云** - `~/.aliyun/config.json`（支持 CloudSSO）

```bash
# 阿里云凭证刷新
aliyun configure --mode CloudSSO --profile <profile>

# AWS 凭证刷新
aws sso login --sso-session <session-name>
```

## CLI 用法

```bash
# 基础
node dist/frameworks/cli.js                      # 采集所有资源
node dist/frameworks/cli.js --cloud aws           # 仅 AWS
node dist/frameworks/cli.js --cloud aliyun        # 仅阿里云
node dist/frameworks/cli.js --count-only          # 仅统计数量
node dist/frameworks/cli.js --search <query>      # 搜索资源

# IAM 审计
node dist/frameworks/cli.js --iam-audit           # 完整审计
node dist/frameworks/cli.js --iam-fast            # 极速审计（仅统计用户）

# 缓存控制
node dist/frameworks/cli.js -f                    # 强制刷新缓存

# 调试
DEBUG=1 node dist/frameworks/cli.js               # 显示完整错误堆栈
```

### 全部选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--cloud <type>` | 云平台：aws, aliyun, all | all |
| `--type <types>` | 资源类型，逗号分隔 | 全部 |
| `--aliyun-profile <n>` | 阿里云 Profile，逗号分隔 | |
| `--aliyun-region <r>` | 阿里云 Region，逗号分隔 | |
| `--aliyun-account <ids>` | 阿里云账号 ID，逗号分隔 | |
| `--aws-profile <n>` | AWS Profile，逗号分隔 | |
| `--aws-region <r>` | AWS Region，逗号分隔 | |
| `--aws-account <ids>` | AWS 账号 ID，逗号分隔 | |
| `--iam-audit` | 运行 IAM 安全审计 | |
| `--iam-fast` | 极速审计 | |
| `--audit-key-age <days>` | AccessKey 最大年龄 | 90 |
| `--audit-unused <days>` | AccessKey 未使用阈值 | 90 |
| `--audit-login <days>` | 最后登录阈值 | 90 |
| `--search <query>` | 搜索资源 | |
| `--count-only` | 仅统计数量 | |
| `--output <dir>` | 输出目录 | ./output |
| `--log-dir <dir>` | 日志目录 | ./logs |
| `--cache-dir <dir>` | 缓存目录 | ./.cache |
| `--cache-ttl <min>` | 缓存有效期（分钟） | 60 |
| `--force-refresh, -f` | 强制刷新缓存 | |
| `--concurrency <n>` | 并发数 | 5 |
| `--log-level <level>` | 日志级别 | info |
| `--config <path>` | 配置文件路径 | ./config.yaml |

## 配置文件

编辑 `config.yaml` 控制采集范围，详见 `config.yaml.sample`。

支持的资源类型：cache, cdn, compute, container, database, dns, ebs, filesys, iam, kms, network, notify, queue, slb, storage

## 架构

Clean Architecture 分层，依赖方向：frameworks → use-cases → entities

```
src/
├── entities/       # 领域模型（Resource, Config, Profile, IAMAudit）
├── adapters/       # 云平台 SDK 封装、缓存、CSV 导出、IAM 审计工具
├── use-cases/      # 业务逻辑（collect, export, count, iam-audit）
├── frameworks/     # CLI 入口、参数解析、配置加载
└── utils/          # 日志、认证错误处理
```

## 开发

```bash
pnpm build    # 构建
pnpm test     # 测试（vitest）
```

## 技术栈

TypeScript + ESM、pino 日志、vitest 测试
