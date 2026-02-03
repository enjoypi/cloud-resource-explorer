# Data Model: Cloud Resource Explorer

## Entities

### Profile

```typescript
interface Profile {
  name: string           // Profile 名称
  cloud: 'aws' | 'aliyun'
  accountId?: string     // 云账号 ID
  region?: string        // 默认区域
  ssoSession?: string    // 关联的 SSO Session
}
```

### Resource

```typescript
interface Resource {
  id: string             // 资源 ID
  name: string           // 资源名称
  type: ResourceType     // 资源类型
  cloud: 'aws' | 'aliyun'
  profile: string        // 来源 Profile
  accountId: string      // 云账号 ID
  region: string         // 区域（全局资源为 'global'）
  project?: string       // 项目/资源组
  tags: Record<string, string>
  collectedAt: string    // 采集时间 ISO8601
  raw?: unknown          // 原始 API 响应
}

type ResourceType =
  | 'compute' | 'database' | 'storage' | 'network'
  | 'cache' | 'container' | 'cdn' | 'dns' | 'iam'
  | 'kms' | 'slb' | 'ebs' | 'filesys' | 'notify' | 'queue'
```

### CollectTask

```typescript
interface CollectTask {
  profile: string
  type: ResourceType
  region: string         // 'global' for global resources
  status: 'pending' | 'running' | 'success' | 'failed'
  error?: string
  resourceCount?: number
  duration?: number      // ms
}
```

### CacheEntry

```typescript
interface CacheEntry {
  key: string            // `${profile}/${type}/${region}`
  resources: Resource[]
  cachedAt: string       // ISO8601
  ttl: number            // minutes
}
```

### Config

```typescript
interface Config {
  cloud: 'aws' | 'aliyun' | 'all'
  concurrency: number
  cache: {
    ttl: number
    dir: string
  }
  retry: {
    maxAttempts: number
    backoff: 'exponential' | 'fixed'
    baseDelay?: number      // 毫秒，指数退避初始延迟，默认 1000
    maxDelay?: number       // 毫秒，最大延迟，默认 30000
    maxWaitTime?: number    // 毫秒，总超时时间，默认 120000
  }
  output: {
    dir: string
    format: 'csv'
  }
  log: {
    level: 'debug' | 'info' | 'warn' | 'error'
    dir: string
  }
  filters?: {
    profiles?: string[]
    excludeProfiles?: string[]
    regions?: string[]
    excludeRegions?: string[]
    types?: ResourceType[]
    accounts?: string[]
    excludeAccounts?: string[]
  }
}
```

## Relationships

```
Profile 1 ──── * CollectTask
CollectTask 1 ──── * Resource
CacheEntry 1 ──── * Resource
Config 1 ──── * Profile (filters)
```

## State Transitions

### CollectTask

```
pending → running → success
                  → failed (retry) → running
                  → failed (max retries)
```
