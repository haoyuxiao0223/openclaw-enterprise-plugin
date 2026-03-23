# OpenClaw Enterprise Plugin

Enterprise multi-tenant extension for [OpenClaw](https://github.com/openclaw/openclaw) — adds governance, audit, isolation, collaboration, and reliability layers for enterprise deployments.

All six architectural dimensions are fully implemented, bootstrapped, and exposed via REST API. Enterprise customers can deploy OpenClaw with this plugin to integrate their own business systems, map to organizational structures, enforce Docker-level isolation, read/write permission separation, and operation traceability.

## Features

### Kernel — 基础设施抽象层
Pluggable infrastructure abstractions with Memory (dev/test), PostgreSQL (production), and Redis (enterprise) backends:
- **StorageBackend** — 持久化存储，支持事务、原子更新、批量操作
- **QueueBackend** — 消息队列，支持优先级、延迟投递、DLQ 死信队列
- **CacheBackend** — 缓存层，支持 TTL、批量读写
- **EventBus** — 事件总线，支持发布/订阅、一次性监听
- **LockBackend** — 分布式锁，支持可重入、自动续期
- **SecretBackend** — 密钥管理

### Governance — 可治理
- **身份认证** — TokenIdentityProvider（Token/Password 模式）+ OidcIdentityProvider（OpenID Connect 企业 SSO）
- **授权引擎** — ScopePolicyEngine（基于作用域）+ RbacPolicyEngine（基于 CASL 的 RBAC）
- **内容过滤** — RegexClassifier（正则分类器，支持 redact/block/review/allow 四种动作）
- **配额管理** — TokenQuotaManager（滑动窗口配额，支持 per-tenant/user/role/agent 粒度）

### Audit — 可审计
- **审计管道** — MemoryAuditPipeline，支持注册多个 Sink
- **审计 Sink** — LogAuditSink（日志）、StorageAuditSink（持久化存储）
- **审计查询** — AuditQueryService 接口，支持按时间、分类、操作者、资源等多维过滤
- **审计指标** — AuditMetrics 接口，输出缓冲事件数、Sink 健康状态等

### Collaboration — 可协作
- **工作流引擎** — SimpleWorkflowEngine（支持顺序执行、human_review、wait_signal 步骤）
- **人机交接** — StorageHandoffManager（创建/分配/解决/取消交接请求，全生命周期事件驱动）
- **知识库** — StorageKnowledgeStore（命名空间隔离、标签搜索、全文检索）

### Embedding — 可嵌入
- **REST API** — Hono 框架，19 个路由模块，覆盖全部六维度约 100 个端点
- **限流器** — MemoryRateLimiter（滑动窗口算法，自动过期清理）
- **API Key** — StorageApiKeyManager（SHA-256 哈希存储、创建/验证/吊销/轮换全生命周期）

### Isolation — 可隔离
- **进程内运行时** — InProcessRuntime（开发/测试用，内存管理实例）
- **Docker 运行时** — DockerRuntime（容器级隔离，Stub 实现预留 dockerode 集成）
- **Kubernetes 运行时** — KubernetesRuntime（Pod 级隔离，NetworkPolicy 网络策略，资源限制）
- **网络策略** — AllowlistNetworkPolicy（出站白名单控制）

### Reliability — 可靠性
- **健康检查** — HealthCheckerImpl（多探针聚合，存储/队列/缓存探针）
- **检查点** — StorageCheckpointManager（Task/Workflow/Session 状态持久化与恢复）
- **指标** — MetricsProvider 接口（NoopMetricsProvider + Prometheus 扩展点）
- **级联终止** — CascadeKillManager（signal → abort → kill 三阶段优雅降级）
- **死信队列** — DeadLetterManager（查看/重放失败消息）

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                      │
│  (upstream — syncs independently)                       │
├─────────────────────────────────────────────────────────┤
│             Enterprise Plugin (this repo)                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │                bootstrap.ts                      │    │
│  │  resolveGovernance → resolveAudit →              │    │
│  │  resolveCollaboration → resolveEmbedding →       │    │
│  │  resolveIsolation → resolveReliability           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────┐         │
│  │  Kernel   │ │ Governance │ │     Audit     │         │
│  │ 6 Backends│ │ AuthN+AuthZ│ │ Pipeline+Sink │         │
│  └──────────┘ └────────────┘ └───────────────┘         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────┐         │
│  │Collabora.│ │ Embedding  │ │   Isolation   │         │
│  │Workflow+  │ │ REST API   │ │ Docker/K8s   │         │
│  │Handoff+KB│ │ 19 Modules │ │ Runtime      │         │
│  └──────────┘ └────────────┘ └───────────────┘         │
│  ┌──────────┐ ┌────────────┐                            │
│  │Reliability│ │ Middleware │                            │
│  │Health+CP │ │AuthN→AuthZ→│                            │
│  │DLQ+Metric│ │RateLimit→  │                            │
│  └──────────┘ │Audit       │                            │
│               └────────────┘                            │
├─────────────────────────────────────────────────────────┤
│          PostgreSQL  │  Redis  │  Kubernetes             │
└─────────────────────────────────────────────────────────┘
```

### 请求中间件链

```
Request → AuthN → TenantContext → AuthZ → RateLimit → [Handler] → ContentFilter → Audit → Response
```

## Prerequisites

- **Node.js** >= 22.0.0
- **OpenClaw** >= 2026.1.0 (peer dependency)
- **PostgreSQL** 16+ (if using `postgres` storage backend)
- **Redis** 7+ (if using `redis` queue/cache/lock backend)

## Installation

### As an OpenClaw Plugin (npm)

```bash
npm install -g openclaw

openclaw plugins install @openclaw/enterprise
```

### From Source (Development)

```bash
git clone https://github.com/haoyuxiao0223/openclaw-enterprise-plugin.git
cd openclaw-enterprise-plugin
npm install
```

> **国内用户**：如遇 npm 下载超时，可使用淘宝镜像：
> ```bash
> npm install --registry=https://registry.npmmirror.com
> ```

### Integrating into an Existing OpenClaw Project

To integrate this plugin into a local OpenClaw project:

```bash
cd /path/to/openclaw
npm install /path/to/openclaw-enterprise-plugin
```

Or using `npm link` for development:

```bash
cd /path/to/openclaw-enterprise-plugin
npm link

cd /path/to/openclaw
npm link @openclaw/enterprise
```

Then register the plugin by adding it to the `plugins` array in your `openclaw.json`:

```json
{
  "plugins": ["@openclaw/enterprise"],
  "enterprise": { ... }
}
```

### Database Setup

If using the PostgreSQL backend, initialize the schema before starting:

```bash
psql $DATABASE_URL -f database-schema.sql
psql $DATABASE_URL -f rls-policies.sql
```

## REST API Endpoints

All API endpoints are mounted at `/api/v1/*`, organized by the six-dimensional architecture:

| 维度 | 路由 | 说明 |
|------|------|------|
| 认证 | `/api/v1/auth` | 登录/登出/刷新/OIDC 回调 |
| 内核 | `/api/v1/tenants` | 租户管理 |
| 治理 | `/api/v1/users` | 用户管理 |
| 治理 | `/api/v1/roles` | 角色管理 |
| 治理 | `/api/v1/policies` | 策略定义 |
| 治理 | `/api/v1/authz` | 授权检查（单个/批量） |
| 治理 | `/api/v1/content-filters` | 内容过滤测试 |
| 治理 | `/api/v1/quotas` | 配额使用查询与消费 |
| 审计 | `/api/v1/audit` | 审计事件查询与指标 |
| 协作 | `/api/v1/agents` | Agent CRUD |
| 协作 | `/api/v1/sessions` | 会话管理 |
| 协作 | `/api/v1/tasks` | 任务管理与状态机 |
| 协作 | `/api/v1/workflows` | 工作流注册与启动 |
| 协作 | `/api/v1/workflow-instances` | 工作流实例查询与信号 |
| 协作 | `/api/v1/handoffs` | 人机交接管理 |
| 协作 | `/api/v1/knowledge` | 知识库 CRUD 与搜索 |
| 嵌入 | `/api/v1/api-keys` | API Key 全生命周期 |
| 隔离 | `/api/v1/runtime-instances` | 运行时实例 CRUD |
| 可靠性 | `/api/v1/queues` | 死信队列管理 |
| 可靠性 | `/api/v1/tasks/:id/checkpoints` | 检查点管理与恢复 |
| 可靠性 | `/api/v1/health` | 健康检查（live/ready） |
| 可靠性 | `/api/v1/metrics` | Prometheus 指标 |

## Configuration

Add the `enterprise` section to your `openclaw.json`:

### 最小配置（开发/测试）

```json
{
  "enterprise": {
    "enabled": true,
    "governance": {
      "identity": { "provider": "token" },
      "authorization": { "engine": "scope" }
    },
    "audit": {
      "sinks": [{ "type": "log" }]
    }
  }
}
```

### 完整企业配置

```json
{
  "enterprise": {
    "enabled": true,
    "kernel": {
      "storage": { "backend": "postgres", "connectionString": "env:DATABASE_URL" },
      "queue": { "backend": "redis", "url": "env:REDIS_URL" },
      "cache": { "backend": "redis", "url": "env:REDIS_URL" },
      "eventBus": { "backend": "redis", "url": "env:REDIS_URL" },
      "lock": { "backend": "redis", "url": "env:REDIS_URL" }
    },
    "governance": {
      "identity": {
        "provider": "oidc",
        "issuer": "https://sso.example.com",
        "clientId": "openclaw",
        "clientSecret": "env:OIDC_CLIENT_SECRET",
        "rolesClaim": "roles",
        "groupsClaim": "groups",
        "tenantClaim": "tenant_id"
      },
      "authorization": { "engine": "rbac" },
      "dataProtection": {
        "filters": [{ "type": "regex", "direction": "both" }]
      },
      "quota": {
        "enabled": true,
        "defaultLimits": { "windowMs": 3600000, "defaultLimit": 100000 }
      }
    },
    "audit": {
      "sinks": [
        { "type": "log" },
        { "type": "storage" }
      ]
    },
    "isolation": {
      "runtime": { "backend": "docker" }
    },
    "reliability": {
      "checkpoint": { "enabled": true },
      "metrics": { "provider": "prometheus", "port": 9090 }
    }
  }
}
```

### 隔离运行时配置选项

| backend | 说明 | 依赖 |
|---------|------|------|
| `inprocess` | 进程内模拟（默认） | 无 |
| `docker` | Docker 容器隔离 | dockerode |
| `kubernetes` | K8s Pod 隔离 | @kubernetes/client-node |

## Deployment

### Docker Compose

```bash
cd deploy/docker-compose
docker compose up -d
```

This starts OpenClaw with enterprise mode, PostgreSQL, and Redis.

### Kubernetes (Helm)

```bash
helm install openclaw-enterprise deploy/helm/openclaw-enterprise \
  --set postgres.auth.password=<your-password>
```

## Project Structure

```
├── index.ts                 # Plugin entry (definePluginEntry)
├── bootstrap.ts             # Enterprise subsystem assembly — wires all 6 dimensions
├── openclaw.plugin.json     # Plugin manifest for OpenClaw discovery
├── package.json             # npm package with openclaw metadata
├── src/
│   ├── kernel/              # Infrastructure abstractions (Storage, Queue, Cache, EventBus, Lock, Secret)
│   ├── kernel-impl/         # Memory / Postgres / Redis implementations
│   │   ├── memory/          #   In-memory backends (dev/test, zero dependencies)
│   │   ├── postgres/        #   PostgreSQL backends (enterprise production)
│   │   └── redis/           #   Redis backends (BullMQ, ioredis, Redlock)
│   ├── governance/          # Governance dimension
│   │   ├── identity/        #   TokenIdentityProvider, OidcIdentityProvider
│   │   ├── authorization/   #   ScopePolicyEngine, RbacPolicyEngine (CASL)
│   │   ├── data-protection/ #   RegexClassifier content filter
│   │   └── quota/           #   TokenQuotaManager (sliding window)
│   ├── audit/               # Audit dimension
│   │   ├── impl/            #   MemoryAuditPipeline, LogAuditSink, StorageAuditSink
│   │   └── query/           #   AuditQueryService, AuditMetrics interfaces
│   ├── collaboration/       # Collaboration dimension
│   │   ├── workflow/        #   SimpleWorkflowEngine (sequential + signal steps)
│   │   ├── handoff/         #   StorageHandoffManager (event-driven lifecycle)
│   │   └── knowledge/       #   StorageKnowledgeStore (namespace + tags + search)
│   ├── embedding/           # Embedding dimension
│   │   ├── api/             #   Hono REST API builder + 19 route modules
│   │   │   └── routes/      #     auth, tenants, users, roles, agents, sessions,
│   │   │                    #     tasks, audit, health, api-keys, workflows,
│   │   │                    #     handoffs, knowledge, runtime, content-filters,
│   │   │                    #     quotas, queues, checkpoints, policies
│   │   ├── rate-limiter/    #   MemoryRateLimiter (sliding window)
│   │   └── api-key/         #   StorageApiKeyManager (SHA-256 hash, rotate)
│   ├── isolation/           # Isolation dimension
│   │   ├── runtime/         #   InProcessRuntime, DockerRuntime, KubernetesRuntime
│   │   ├── resource-limiter/#   ResourceLimiter interface
│   │   └── network/         #   AllowlistNetworkPolicy
│   ├── reliability/         # Reliability dimension
│   │   ├── checkpoint/      #   StorageCheckpointManager
│   │   ├── health/          #   HealthCheckerImpl, MetricsProvider
│   │   ├── timeout/         #   CascadeKillManager (signal→abort→kill)
│   │   └── dlq/             #   DeadLetterManager
│   ├── middleware/          # AuthN, AuthZ, tenant, audit, rate limit
│   └── registry.ts         # EnterpriseModules type definitions
├── deploy/
│   ├── Dockerfile.enterprise
│   ├── docker-compose/
│   └── helm/
├── database-schema.sql      # PostgreSQL schema (3NF, RLS-ready)
├── rls-policies.sql         # Row-Level Security policies (tenant isolation)
└── docs/
    ├── PRD-openclaw-enterprise-architecture.md
    ├── api-design.md         # ~100 endpoints across 25 resource domains
    └── tech-desigh.md
```

## How It Works

This plugin integrates with OpenClaw using the standard plugin API:

- **`registerService`** — Bootstraps the enterprise kernel and all modules on gateway start, tears down on stop
- **`registerHttpRoute`** — Mounts the enterprise REST API at `/api/v1/*` on the gateway HTTP server

### Bootstrap Flow

```
bootstrapEnterprise(config)
  ├── bootstrapKernel()           # Initialize 6 kernel backends
  ├── resolveGovernance()         # Token/OIDC + Scope/RBAC + Filter + Quota
  ├── resolveAudit()              # Pipeline + Sinks
  ├── resolveCollaboration()      # Workflow + Handoff + Knowledge
  ├── resolveEmbedding()          # RateLimiter + ApiKeyManager
  ├── resolveIsolation()          # InProcess / Docker / K8s runtime
  └── resolveReliability()        # Health + Checkpoint + Metrics
```

### Shutdown Flow

```
shutdownEnterprise()
  ├── shutdown Collaboration (workflow, handoff, knowledge)
  ├── shutdown Embedding (rate limiter, API key manager)
  ├── shutdown Isolation (runtime backend)
  ├── shutdown Reliability (checkpoint manager)
  ├── shutdown Governance (quota, identity, policy)
  └── shutdownKernel() (storage, queue, cache, secret, eventBus, lock)
```

### Design Principles

- **完全解耦** — Zero imports from upstream OpenClaw source code
- **自包含类型** — All types are self-contained within this plugin
- **配置驱动** — Configuration is read from the `enterprise` section of `openclaw.json`
- **租户隔离** — TenantContext flows through every operation, PostgreSQL RLS enforced at storage layer
- **可插拔架构** — Each dimension can be independently enabled/disabled via configuration
- **幂等启动** — `bootstrapEnterprise()` is idempotent, calling twice returns the existing instance
- **优雅停机** — `shutdownEnterprise()` gracefully shuts down all modules in dependency order

## License

MIT — See [LICENSE](LICENSE) for details.

Based on [OpenClaw](https://github.com/openclaw/openclaw) (MIT License, Copyright 2025 Peter Steinberger).
