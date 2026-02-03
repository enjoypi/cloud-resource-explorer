# 快速开始指南

## 最简单的用法

### 1. 基础采集（推荐）

准备 `config.yaml` 配置文件，然后运行：

```bash
# 采集所有云平台的所有资源类型
pnpm start
```

### 2. 使用配置文件

创建 `config.yaml`:

```yaml
cloud: all  # aws, aliyun, all

types:
  - compute  # EC2, ECS
  - storage  # S3, OSS
  - network  # VPC, SLB
  - database # RDS
  - iam      # 身份管理

# 阿里云配置
aliyun:
  profiles: ["dev", "prod"]

# AWS 配置
aws:
  profiles: ["default"]

outputDir: ./output  # 输出目录
cacheTtl: 60         # 缓存时间（分钟）
```

运行采集：

```bash
pnpm start
```

### 3. 命令行快速筛选

不需要修改配置文件，直接命令行指定：

```bash
# 只采集 AWS 的计算资源
pnpm start --cloud aws --type compute

# 只采集阿里云的特定 Profile
pnpm start --cloud aliyun --aliyun-profile dev

# 采集特定区域
pnpm start --aws-region us-east-1,ap-southeast-1
```

## 常用场景

### 场景 1: 首次采集

```bash
# 1. 配置你的云账号（见下方）
# 2. 运行采集
pnpm start
# 3. 查看结果
ls output/
```

### 场景 2: 仅统计数量

```bash
pnpm start --count-only
```

### 场景 3: 使用缓存（第二次运行）

```bash
# 默认会使用缓存（60分钟内）
pnpm start

# 强制刷新，忽略缓存
pnpm start -f  # 或 --force-refresh
```

### 场景 4: 搜索资源

```bash
# 按 IP 搜索
pnpm start --search 10.0.1.100

# 按名称搜索
pnpm start --search web-server

# 按 ARN 搜索
pnpm start --search arn:aws:ec2:
```

### 场景 5: IAM 安全审计

```bash
# 完整安全审计
pnpm start --iam-audit

# 快速审计（仅统计用户数）
pnpm start --iam-fast
```

## 配置云账号

### AWS 配置

在 `~/.aws/config` 中配置：

```ini
[profile default]
region = us-east-1

[profile prod]
region = us-west-2
sso_session = my-sso
sso_account_id = 123456789012
sso_role_name = AdministratorAccess
```

### 阿里云配置

在 `~/.aliyun/config.json` 中配置：

```json
{
  "current": "default",
  "profiles": [
    {
      "name": "default",
      "mode": "AK",
      "access_key_id": "YOUR_ACCESS_KEY_ID",
      "access_key_secret": "YOUR_ACCESS_KEY_SECRET",
      "region_id": "cn-hangzhou"
    }
  ]
}
```

## 输出说明

采集完成后，会在 `output/` 目录生成：

- `resources_YYYY-MM-DD.csv` - 所有资源列表（CSV 格式，可用 Excel 打开）
- `summary_YYYY-MM-DD.txt` - 统计摘要

## 常用参数速查

| 参数 | 说明 | 示例 |
|------|------|------|
| `--cloud` | 云平台 | `--cloud aws` |
| `--type` | 资源类型 | `--type compute,storage` |
| `--force-refresh, -f` | 强制刷新 | `-f` |
| `--count-only` | 仅统计 | `--count-only` |
| `--search` | 搜索资源 | `--search 10.0.` |
| `--iam-audit` | IAM 审计 | `--iam-audit` |
| `--config` | 配置文件 | `--config my.yaml` |
| `--help, -h` | 帮助 | `-h` |

## 问题排查

**凭证无效**:
```bash
# AWS 刷新 SSO
aws sso login --profile your-profile

# 阿里云刷新凭证
aliyun configure
```

**网络问题**:
```bash
# 增加超时时间
# 在 config.yaml 中设置
sleepMax: 10
```

**并发限制**:
```bash
# 减少并发数
# 在 config.yaml 中设置
concurrency: 3
```

## 高级用法

### 多账号采集

工具自动支持：
- AWS Organizations 成员账号
- 阿里云资源目录成员账号

只需配置主账号的 SSO，工具会自动发现并采集所有成员账号。

### 资源类型说明

| 类型 | 说明 | 云服务 |
|------|------|--------|
| compute | 计算资源 | EC2, ECS, Lambda |
| storage | 存储资源 | S3, OSS, EBS |
| network | 网络资源 | VPC, SLB, Route53 |
| database | 数据库 | RDS, DynamoDB |
| cache | 缓存 | ElastiCache, Redis |
| container | 容器 | ECS, EKS, ACK |
| cdn | CDN | CloudFront, CDN |
| dns | DNS | Route53, DNS |
| iam | 身份管理 | IAM, RAM |

## 更多帮助

```bash
# 查看完整帮助
pnpm start --help

# 查看版本
pnpm start --version
```
