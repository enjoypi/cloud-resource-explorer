# 云资源采集工具

## 🚀 一分钟开始

### 1. 配置你的云账号

在 `~/.aws/config` 或 `~/.aliyun/config.json` 中配置好你的云账号。

### 2. 运行采集

```bash
# 最简单：使用默认配置采集所有资源
pnpm start

# 或者快速筛选
pnpm start --cloud aws           # 只采集 AWS
pnpm start --type compute        # 只采集计算资源
pnpm start --search 10.0.         # 按 IP 搜索
```

### 3. 查看结果

采集完成后，打开 `output/resources_*.csv` 文件即可（可用 Excel 打开）。

---

## 📝 快速配置

创建 `config.yaml`：

```yaml
cloud: all  # aws, aliyun, all

types:      # 要采集的资源类型
  - compute  # 服务器、容器
  - storage  # 存储、磁盘
  - network  # 网络、负载均衡
  - database # 数据库
  - iam      # 身份管理

outputDir: ./output  # 输出目录
```

运行：`pnpm start`

---

## 🎯 常用命令

```bash
# 首次采集
pnpm start

# 第二次运行（自动使用缓存，更快）
pnpm start

# 强制重新采集
pnpm start -f

# 仅统计数量
pnpm start --count-only

# IAM 安全审计
pnpm start --iam-audit

# 按 IP 搜索
pnpm start --search 10.0.1.100
```

---

## 🔧 高级配置

### 只采集特定账号

```bash
# 阿里云
pnpm start --aliyun-profile dev,prod

# AWS
pnpm start --aws-profile default
```

### 只采集特定区域

```bash
# AWS 美国东部和亚太
pnpm start --aws-region us-east-1,ap-southeast-1
```

### 多账号自动发现

工具支持：
- ✅ AWS Organizations 成员账号
- ✅ 阿里云资源目录成员账号

只需配置主账号，自动采集所有成员账号资源。

---

## 📊 输出文件

采集完成后会生成：

- `output/resources_YYYY-MM-DD.csv` - 资源列表（CSV）
- `output/summary_YYYY-MM-DD.txt` - 统计摘要

---

## ❓ 常见问题

**凭证无效？**
```bash
# AWS 刷新
aws sso login --profile your-profile

# 阿里云刷新
aliyun configure
```

**网络超时？**
在 `config.yaml` 中增加：
```yaml
sleepMax: 10  # 增加等待时间
```

---

## 📚 更多帮助

```bash
# 查看完整帮助
pnpm start --help

# 查看详细文档
cat QUICKSTART.md
```

---

**核心理念：配置文件为主，命令行为辅。90% 的场景只需配置好 `config.yaml`，然后运行 `pnpm start` 即可。**
