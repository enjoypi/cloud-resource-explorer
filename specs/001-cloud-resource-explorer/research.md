# Research: Cloud Resource Explorer

## 技术决策

### 1. 云 SDK 选择

**Decision**: AWS SDK v3 + 阿里云 OpenAPI SDK
**Rationale**: 官方 SDK，TypeScript 原生支持，模块化按需加载
**Alternatives**: REST API 直接调用（维护成本高）

### 2. 缓存策略

**Decision**: 文件系统 JSON 缓存，按 Profile/Type/Region 粒度
**Rationale**: 简单可靠，无需额外依赖，支持离线查看
**Alternatives**: SQLite（过度设计）、Redis（需要额外服务）

### 3. 并发控制

**Decision**: p-limit 限制并发数，默认 3
**Rationale**: 避免触发云平台 API 限流，可配置调整
**Alternatives**: 无限制并发（易触发限流）

### 4. 限流重试

**Decision**: 指数退避重试，最多 3 次
**Rationale**: 标准做法，平衡成功率和等待时间
**Alternatives**: 固定间隔（效率低）、立即失败（成功率低）

### 5. 日志方案

**Decision**: pino 结构化日志
**Rationale**: 高性能，JSON 格式便于分析，支持日志级别
**Alternatives**: console.log（不支持结构化）、winston（性能较低）

### 6. 配置格式

**Decision**: YAML
**Rationale**: 可读性好，支持注释，符合项目宪法
**Alternatives**: JSON（不支持注释）、TOML（生态较小）

## 资源类型映射

| 类型 | AWS 服务 | 阿里云服务 |
|------|----------|------------|
| compute | EC2, Lambda | ECS, FC |
| database | RDS, DynamoDB | RDS, PolarDB |
| storage | S3 | OSS |
| network | VPC, ELB | VPC, SLB |
| cache | ElastiCache | Redis |
| container | ECS, EKS | ACK |
| cdn | CloudFront | CDN |
| dns | Route53 | DNS |
| iam | IAM | RAM |
| kms | KMS | KMS |
