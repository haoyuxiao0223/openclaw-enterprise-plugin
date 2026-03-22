# OpenClaw Enterprise — 企业级 Agent 平台架构升级 PRD

> **版本**：v1.0  
> **日期**：2026-03-20  
> **状态**：Draft  
> **定位**：本文档描述 OpenClaw 从个人 AI 助理到企业级开源 Agent 平台的架构升级方案。  
> **核心原则**：本次升级是架构级提升，不是功能点级优化。我们定义的是接口、契约和扩展点，而非具体业务功能。企业用户基于此架构添加自己的 Skills、渠道和业务集成。

---

## 目录

- [第一部分：愿景与定位](#第一部分愿景与定位)
  - [1.1 产品愿景](#11-产品愿景)
  - [1.2 核心差异：个人版 vs 企业版](#12-核心差异个人版-vs-企业版)
  - [1.3 开源定位](#13-开源定位)
- [第二部分：架构设计原则](#第二部分架构设计原则)
  - [2.1 五项工程原则](#21-五项工程原则)
  - [2.2 架构约束](#22-架构约束)
- [第三部分：目标架构总览](#第三部分目标架构总览)
  - [3.1 分层架构](#31-分层架构)
  - [3.2 核心进程模型](#32-核心进程模型)
  - [3.3 部署拓扑](#33-部署拓扑)
- [第四部分：内核抽象层（Kernel Abstractions）](#第四部分内核抽象层kernel-abstractions)
  - [4.1 存储后端抽象（StorageBackend）](#41-存储后端抽象storagebackend)
  - [4.2 队列后端抽象（QueueBackend）](#42-队列后端抽象queuebackend)
  - [4.3 缓存后端抽象（CacheBackend）](#43-缓存后端抽象cachebackend)
  - [4.4 密钥管理抽象（SecretBackend）](#44-密钥管理抽象secretbackend)
  - [4.5 事件总线抽象（EventBus）](#45-事件总线抽象eventbus)
  - [4.6 分布式锁抽象（LockBackend）](#46-分布式锁抽象lockbackend)
- [第五部分：六维架构模块设计](#第五部分六维架构模块设计)
  - [5.1 可治理模块（Governance）](#51-可治理模块governance)
  - [5.2 可审计模块（Audit）](#52-可审计模块audit)
  - [5.3 可协作模块（Collaboration）](#53-可协作模块collaboration)
  - [5.4 可嵌入模块（Embedding）](#54-可嵌入模块embedding)
  - [5.5 可隔离模块（Isolation）](#55-可隔离模块isolation)
  - [5.6 可靠性模块（Reliability）](#56-可靠性模块reliability)
- [第六部分：模块依赖与交互](#第六部分模块依赖与交互)
- [第七部分：迁移策略](#第七部分迁移策略)
  - [7.1 兼容性约束](#71-兼容性约束)
  - [7.2 迁移路径](#72-迁移路径)
  - [7.3 阶段里程碑](#73-阶段里程碑)
- [第八部分：开源生态设计](#第八部分开源生态设计)
- [第九部分：验收标准](#第九部分验收标准)

---

## 第一部分：愿景与定位

### 1.1 产品愿景

将 OpenClaw 从**个人 AI 助理**升级为**企业级开源 Agent 平台框架**。

升级后的 OpenClaw 是一个**架构骨架**（Skeleton），而非一个开箱即用的企业产品。它提供：

- **接口契约**：定义身份、权限、审计、隔离、可靠性等维度的标准接口
- **参考实现**：为每个接口提供一到两个开源参考实现（如 PostgreSQL 存储、Redis 队列）
- **扩展点**：企业用户通过实现接口来对接自己的基础设施（IdP、SIEM、消息队列、容器平台）

类比：OpenClaw Enterprise 之于 AI Agent，如同 Spring Boot 之于 Java Web 应用 —— 提供架构约定和可插拔组件，而非具体业务逻辑。

### 1.2 核心差异：个人版 vs 企业版

| 维度 | 个人版（当前） | 企业版（目标） |
|------|----------------|----------------|
| **运行模型** | 单 Gateway 进程，Agent 在进程内 | Gateway 无状态调度 + Agent Runtime 独立进程 |
| **存储** | 本地文件系统（JSON/SQLite） | 可插拔存储后端（接口 + PG/Redis 参考实现） |
| **身份** | Token/Password | 可插拔身份提供者（接口 + OIDC 参考实现） |
| **权限** | Gateway method scope | 可插拔策略引擎（接口 + RBAC 参考实现） |
| **审计** | 分散的日志文件 | 统一审计管道（接口 + 日志/Webhook Sink 参考实现） |
| **隔离** | 工具执行容器沙箱 | 可插拔隔离后端（接口 + Docker/K8s 参考实现） |
| **队列** | 内存队列 | 可插拔队列后端（接口 + Redis/内存参考实现） |
| **可靠性** | 分散的重试逻辑 | 统一的 FSM + Checkpoint + 重试框架 |

### 1.3 开源定位

```
┌─────────────────────────────────────────────────────┐
│  企业用户的业务层                                      │
│  ┌─────┐ ┌──────┐ ┌────────┐ ┌──────────────────┐  │
│  │Skills│ │渠道   │ │工作流   │ │业务系统嵌入       │  │
│  │定制  │ │接入   │ │编排    │ │(OA/CRM/ERP)     │  │
│  └─────┘ └──────┘ └────────┘ └──────────────────┘  │
├─────────────────────────────────────────────────────┤
│  OpenClaw Enterprise 开源架构层（本 PRD 范围）        │
│  ┌──────────────────────────────────────────────┐   │
│  │ 六维架构模块                                   │   │
│  │ 可治理│可审计│可协作│可嵌入│可隔离│可靠性       │   │
│  ├──────────────────────────────────────────────┤   │
│  │ 内核抽象层                                     │   │
│  │ Storage│Queue│Cache│Secret│EventBus│Lock      │   │
│  ├──────────────────────────────────────────────┤   │
│  │ 参考实现                                       │   │
│  │ PG │ Redis │ OIDC │ Docker │ K8s │ Prometheus │   │
│  └──────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  OpenClaw Core（现有核心能力）                        │
│  Agent Runtime│Channel Plugin│Tool Plugin│Provider  │
└─────────────────────────────────────────────────────┘
```

**开源协议**：与现有 OpenClaw 保持一致。
**仓库结构**：企业级架构代码作为 OpenClaw 主仓库的一部分，通过目录和包结构隔离。

---

## 第二部分：架构设计原则

### 2.1 五项工程原则

| 原则 | 在本项目中的体现 |
|------|------------------|
| **可扩展性优先** | 所有六维模块都通过接口定义，企业用户实现接口即可替换任何组件。核心代码不引用具体实现，只依赖接口。 |
| **可维护性至上** | 模块间通过 EventBus 解耦。每个模块有清晰的单一职责。接口定义附带 JSDoc 文档和使用示例。 |
| **健壮性是底线** | 所有外部调用（存储、队列、密钥服务）必须经过重试 + 超时 + 熔断链。FSM 强制拒绝非法状态转换。 |
| **性能意识** | 内存参考实现保留为默认后端（单机部署零外部依赖）。外部后端的连接池、批量操作、延迟加载纳入接口规范。 |
| **安全为本** | 审计管道是系统级中间件，无法被单个模块绕过。租户隔离在内核抽象层强制执行，而非交给上层应用。 |

### 2.2 架构约束

以下约束是不可妥协的硬性要求：

| 约束 | 说明 |
|------|------|
| **接口与实现分离** | 内核抽象层只定义 TypeScript 接口（`interface`），不包含任何具体实现。参考实现放在独立包中。 |
| **零外部依赖可启动** | 企业版必须保留"单机单进程 + 内存/文件系统"的启动模式，作为开发/测试/个人使用的默认配置。不强制要求 PostgreSQL/Redis/K8s。 |
| **租户上下文贯穿** | 所有 API 调用、事件、日志、存储操作都必须携带 `TenantContext`（包含 tenantId、userId、agentId）。这是架构级约束，不是可选功能。 |
| **审计不可绕过** | 审计管道作为中间件层运行在 Gateway 核心调用链中，所有通过 Gateway 的操作自动产生审计事件。模块不能 opt-out。 |
| **向后兼容** | 现有 OpenClaw 个人版用户升级后，在不配置任何企业功能时，行为和性能不退化。企业功能全部通过配置开启。 |
| **插件边界不变** | 现有的 Plugin SDK（`openclaw/plugin-sdk/*`）保持稳定。企业架构模块通过新的 SPI（Service Provider Interface）扩展，不侵入现有插件体系。 |

---

## 第三部分：目标架构总览

### 3.1 分层架构

```
┌────────────────────────────────────────────────────────────────┐
│                        API 层 (API Layer)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ REST API │ │WebSocket │ │OpenAI API│ │ Webhook Ingress  │  │
│  │ + OpenAPI│ │ JSON-RPC │ │ compat.  │ │                  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                     中间件链 (Middleware Chain)                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────┐  │
│  │ AuthN  │→│ AuthZ  │→│ Tenant │→│ Audit  │→│ RateLimit  │  │
│  │身份认证 │ │权限校验 │ │租户注入 │ │审计记录 │ │限流        │  │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                    业务编排层 (Orchestration Layer)              │
│  ┌───────────────┐ ┌───────────────┐ ┌─────────────────────┐  │
│  │ Agent Scheduler│ │Task FSM Engine│ │ Workflow Orchestrator│  │
│  │ Agent 调度器   │ │任务状态机引擎  │ │ 工作流编排器         │  │
│  └───────────────┘ └───────────────┘ └─────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                   Agent 运行时层 (Agent Runtime Layer)           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐  │
│  │Agent Process │ │Tool Sandbox │ │ Channel Adapter         │  │
│  │Agent 运行时  │ │工具沙箱      │ │ 通道适配器              │  │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│                   内核抽象层 (Kernel Abstraction Layer)          │
│  ┌───────┐┌──────┐┌──────┐┌───────┐┌────────┐┌──────┐       │
│  │Storage││Queue ││Cache ││Secret ││EventBus││ Lock │       │
│  └───────┘└──────┘└──────┘└───────┘└────────┘└──────┘       │
├────────────────────────────────────────────────────────────────┤
│                   基础设施层 (Infrastructure Layer)              │
│  ┌──────────┐ ┌───────┐ ┌──────────┐ ┌────────┐ ┌────────┐  │
│  │PostgreSQL│ │ Redis │ │Docker/K8s│ │  Vault │ │Promethe│  │
│  │(参考实现) │ │(参考)  │ │(参考)    │ │(参考)  │ │us(参考)│  │
│  └──────────┘ └───────┘ └──────────┘ └────────┘ └────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 核心进程模型

**当前模型**：单体进程

```
[Gateway 进程]
  ├─ Agent A 运行时（内存）
  ├─ Agent B 运行时（内存）
  ├─ 命令队列（内存）
  ├─ Session 存储（文件）
  └─ Docker 容器（仅工具执行）
```

**目标模型**：可选的进程分离

```
模式 A：单体模式（默认，兼容个人版）
  [Gateway 进程] — 与当前行为一致，零外部依赖

模式 B：分离模式（企业生产部署）
  [API Gateway]  ←→ [队列] ←→ [Agent Worker 1..N]
       │                              │
       ├─ 身份/权限/审计中间件         ├─ Agent Runtime
       ├─ 路由/调度                    ├─ 工具沙箱（容器）
       └─ REST/WS/Webhook 入口        └─ 通道适配器
                    │
              [外部存储]
              PG + Redis + Vault
```

**设计要点**：
- 模式 A 和模式 B 共享同一套代码，通过**配置**切换，而非代码分支
- 内核抽象层在两种模式下提供相同的接口，但底层实现不同（内存 vs 外部服务）
- Agent Runtime 在模式 A 中是 Gateway 进程内的函数调用，在模式 B 中是独立进程/容器

### 3.3 部署拓扑

#### 拓扑一：开发者/个人（单机，零依赖）

```
┌────────────────────────────┐
│      OpenClaw 单进程        │
│  Gateway + Agent Runtime   │
│  内存队列 + 文件存储        │
│  Docker 沙箱（可选）        │
└────────────────────────────┘
```

- 等价于当前 OpenClaw 个人版
- 无需 PostgreSQL、Redis、Kubernetes
- `openclaw gateway run` 即可启动

#### 拓扑二：小型团队（单机，有外部存储）

```
┌────────────────────────────┐
│      OpenClaw 单进程        │
│  Gateway + Agent Runtime   │
│         │                  │
│    ┌────┴────┐             │
│    │ PG/Redis│             │
│    └─────────┘             │
└────────────────────────────┘
```

- 适合 5-20 人团队
- 多租户、审计、持久化队列已开启
- 仍为单进程，但数据在外部存储

#### 拓扑三：企业级（K8s 集群）

```
┌──────────────────────────────────────────┐
│  Kubernetes Cluster                       │
│                                           │
│  ┌─────────────┐  ┌─────────────┐        │
│  │ API Gateway │  │ API Gateway │  (HPA) │
│  │ (Deployment)│  │ (Deployment)│        │
│  └──────┬──────┘  └──────┬──────┘        │
│         └────────┬───────┘               │
│            ┌─────┴─────┐                 │
│            │  Redis     │                │
│            │  (Queue +  │                │
│            │   Cache)   │                │
│            └─────┬──────┘                │
│         ┌────────┼────────┐              │
│  ┌──────┴─────┐  │  ┌─────┴──────┐      │
│  │Agent Worker│  │  │Agent Worker│ (HPA)│
│  │ (Pod)      │  │  │ (Pod)      │      │
│  └────────────┘  │  └────────────┘      │
│            ┌─────┴──────┐                │
│            │ PostgreSQL │                │
│            │ (StatefulS)│                │
│            └────────────┘                │
│            ┌────────────┐                │
│            │   Vault    │                │
│            └────────────┘                │
└──────────────────────────────────────────┘
```

---

## 第四部分：内核抽象层（Kernel Abstractions）

内核抽象层是整个企业级架构的基石。它定义了六个核心基础设施接口，所有上层模块只依赖这些接口，不依赖具体实现。

**目录结构**：

```
src/enterprise/
├── kernel/                     # 内核抽象层：纯接口定义
│   ├── storage.ts              # StorageBackend 接口
│   ├── queue.ts                # QueueBackend 接口
│   ├── cache.ts                # CacheBackend 接口
│   ├── secret.ts               # SecretBackend 接口
│   ├── event-bus.ts            # EventBus 接口
│   ├── lock.ts                 # LockBackend 接口
│   └── tenant-context.ts       # TenantContext 类型定义
├── kernel-impl/                # 参考实现
│   ├── memory/                 # 内存实现（默认，零依赖）
│   ├── postgres/               # PostgreSQL 实现
│   ├── redis/                  # Redis 实现
│   └── filesystem/             # 文件系统实现（兼容个人版）
├── governance/                 # 可治理模块
├── audit/                      # 可审计模块
├── collaboration/              # 可协作模块
├── embedding/                  # 可嵌入模块
├── isolation/                  # 可隔离模块
└── reliability/                # 可靠性模块
```

### 4.1 存储后端抽象（StorageBackend）

**职责**：所有持久化数据的读写（Session、Config、Credentials、Agent 元数据、审计记录）。

**接口设计**：

```typescript
interface TenantContext {
  tenantId: string;
  userId?: string;
  agentId?: string;
  requestId: string;
  source: string; // "api" | "channel" | "cron" | "internal"
}

interface StorageBackend {
  // 生命周期
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;

  // 泛型 CRUD（所有操作自动注入 tenantId 隔离）
  get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null>;
  set<T>(ctx: TenantContext, collection: string, key: string, value: T): Promise<void>;
  delete(ctx: TenantContext, collection: string, key: string): Promise<boolean>;
  list<T>(ctx: TenantContext, collection: string, query: StorageQuery): Promise<PaginatedResult<T>>;

  // 原子操作
  atomicUpdate<T>(
    ctx: TenantContext,
    collection: string,
    key: string,
    updater: (current: T | null) => T
  ): Promise<T>;

  // 批量操作
  batchGet<T>(ctx: TenantContext, collection: string, keys: string[]): Promise<Map<string, T>>;
  batchSet<T>(ctx: TenantContext, collection: string, entries: Array<{ key: string; value: T }>): Promise<void>;

  // 事务（可选能力，后端可声明不支持）
  transaction?<T>(ctx: TenantContext, fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;
}

interface StorageQuery {
  prefix?: string;
  filter?: Record<string, unknown>;
  orderBy?: string;
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  details?: Record<string, unknown>;
}
```

**参考实现**：

| 实现 | 包路径 | 适用场景 |
|------|--------|----------|
| `MemoryStorageBackend` | `kernel-impl/memory/storage.ts` | 开发/测试，单进程 |
| `FileSystemStorageBackend` | `kernel-impl/filesystem/storage.ts` | 个人版兼容（迁移自现有 JSON 文件存储） |
| `PostgresStorageBackend` | `kernel-impl/postgres/storage.ts` | 企业生产部署 |

**设计要点**：
- `TenantContext` 作为第一参数贯穿所有操作，在存储层强制租户隔离
- `FileSystemStorageBackend` 封装现有的 `sessions.json`、`openclaw.json` 等文件操作，保证向后兼容
- `PostgresStorageBackend` 使用 `tenant_id` 列做行级安全（Row-Level Security）
- `collection` 映射到逻辑分组（如 `"sessions"`、`"config"`、`"credentials"`），不同后端映射为不同结构（内存 Map / 文件目录 / 数据库表）

### 4.2 队列后端抽象（QueueBackend）

**职责**：任务调度、消息传递、异步处理。替代当前内存中的命令队列和 Followup 队列。

**接口设计**：

```typescript
interface QueueBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;

  // 入队
  enqueue(ctx: TenantContext, queue: string, message: QueueMessage, options?: EnqueueOptions): Promise<string>; // 返回 messageId

  // 消费（Pull 模式）
  dequeue(queue: string, options?: DequeueOptions): Promise<QueueMessage | null>;

  // 消费（Push 模式，长轮询/订阅）
  subscribe(queue: string, handler: QueueHandler, options?: SubscribeOptions): QueueSubscription;

  // 确认/拒绝
  ack(queue: string, messageId: string): Promise<void>;
  nack(queue: string, messageId: string, options?: NackOptions): Promise<void>;

  // 队列管理
  getQueueDepth(queue: string): Promise<number>;
  purge(queue: string): Promise<number>;

  // DLQ
  getDeadLetterMessages(queue: string, options?: PaginationOptions): Promise<PaginatedResult<QueueMessage>>;
  replayDeadLetter(queue: string, messageId: string): Promise<void>;
}

interface QueueMessage {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  priority?: "high" | "normal" | "low";
  idempotencyKey?: string;
  scheduledAt?: Date;  // 延迟队列
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  metadata?: Record<string, string>;
}

interface EnqueueOptions {
  priority?: "high" | "normal" | "low";
  delay?: number;          // 延迟毫秒数
  idempotencyKey?: string; // 去重 key
  maxAttempts?: number;    // 最大重试次数（默认 3）
  ttl?: number;            // 消息过期时间
}

interface DequeueOptions {
  waitTimeMs?: number;     // 长轮询等待
  visibilityTimeout?: number; // 处理超时后自动 nack
}

interface QueueHandler {
  (message: QueueMessage): Promise<void>;
}

interface QueueSubscription {
  unsubscribe(): Promise<void>;
}
```

**参考实现**：

| 实现 | 包路径 | 适用场景 |
|------|--------|----------|
| `MemoryQueueBackend` | `kernel-impl/memory/queue.ts` | 开发/测试（封装现有 command-queue 行为） |
| `RedisQueueBackend` | `kernel-impl/redis/queue.ts` | 企业生产（BullMQ 或自实现） |
| `PostgresQueueBackend` | `kernel-impl/postgres/queue.ts` | 轻量企业（不想引入 Redis） |

**设计要点**：
- `idempotencyKey` 在队列层面做去重，替代当前内存 dedupe 缓存
- `priority` 替代当前 Lane 的硬编码并发控制
- `scheduledAt` 提供延迟队列能力
- `maxAttempts` + `nack` + DLQ 形成完整的重试 → 死信链
- `MemoryQueueBackend` 内部复用现有 `command-queue.ts` 的 lane-aware FIFO 逻辑

### 4.3 缓存后端抽象（CacheBackend）

**职责**：高频读取数据的缓存（健康状态、配置快照、Session 元数据、Dedupe）。

```typescript
interface CacheBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;

  // 原子自增（用于计数、限流）
  increment(key: string, delta?: number, ttlMs?: number): Promise<number>;

  // 分布式 Dedupe
  setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean>;
}
```

**参考实现**：`MemoryCacheBackend`（Map + TTL）、`RedisCacheBackend`。

### 4.4 密钥管理抽象（SecretBackend）

**职责**：凭证和敏感配置的安全存储与访问。升级现有 `SecretRef`（env/file/exec）为统一接口。

```typescript
interface SecretBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // 读取密钥
  getSecret(ctx: TenantContext, path: string): Promise<string | null>;

  // 写入密钥（不是所有后端都支持）
  setSecret?(ctx: TenantContext, path: string, value: string): Promise<void>;

  // 删除密钥
  deleteSecret?(ctx: TenantContext, path: string): Promise<boolean>;

  // 列出密钥路径（不返回值）
  listSecretPaths?(ctx: TenantContext, prefix: string): Promise<string[]>;

  // 密钥轮换事件
  onRotation?(handler: (path: string) => void): void;
}
```

**参考实现**：
- `SecretRefBackend`：封装现有 `SecretRef`（env/file/exec）机制，向后兼容
- `VaultBackend`：HashiCorp Vault（企业部署）
- `EnvBackend`：纯环境变量（轻量场景）

### 4.5 事件总线抽象（EventBus）

**职责**：模块间解耦通信。审计事件、生命周期事件、状态变更事件的统一传输通道。

```typescript
interface EventBus {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // 发布事件
  publish(event: PlatformEvent): Promise<void>;

  // 批量发布
  publishBatch(events: PlatformEvent[]): Promise<void>;

  // 订阅事件
  subscribe(pattern: string, handler: EventHandler): EventSubscription;

  // 一次性订阅（用于请求-响应模式）
  once(pattern: string, timeoutMs: number): Promise<PlatformEvent>;
}

interface PlatformEvent {
  id: string;
  type: string;          // 如 "audit.operation", "task.state.changed", "agent.health"
  tenantId: string;
  source: string;        // 产生事件的模块
  timestamp: Date;
  data: unknown;
  metadata?: Record<string, string>;
}

interface EventHandler {
  (event: PlatformEvent): Promise<void>;
}

interface EventSubscription {
  unsubscribe(): void;
}
```

**参考实现**：
- `InProcessEventBus`：进程内 EventEmitter（默认，零依赖）
- `RedisEventBus`：Redis Pub/Sub + Streams（多实例场景）

**设计要点**：
- 审计模块订阅 `audit.*` 事件
- 可靠性模块订阅 `task.state.*` 事件
- 外部系统通过 Webhook Sink 或 Kafka Sink 消费事件（属于可嵌入模块的扩展点）
- `InProcessEventBus` 保证单机场景零延迟，多实例场景切换到 Redis

### 4.6 分布式锁抽象（LockBackend）

**职责**：分布式互斥（Cron 单实例执行、Session 写锁、领导选举）。

```typescript
interface LockBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // 获取锁
  acquire(key: string, options: LockOptions): Promise<LockHandle | null>;

  // 释放锁
  release(handle: LockHandle): Promise<void>;

  // 续租
  extend(handle: LockHandle, extensionMs: number): Promise<boolean>;

  // 领导选举（高层抽象）
  electLeader(group: string, candidateId: string, options: LeaderElectionOptions): LeaderElection;
}

interface LockOptions {
  ttlMs: number;         // 锁过期时间
  waitMs?: number;       // 等待获取锁的最长时间（0 = 立即返回）
  retryIntervalMs?: number;
}

interface LockHandle {
  key: string;
  token: string;         // 防误释放
  expiresAt: Date;
}

interface LeaderElection {
  isLeader(): boolean;
  onElected(handler: () => void): void;
  onDeposed(handler: () => void): void;
  resign(): Promise<void>;
}
```

**参考实现**：
- `InProcessLockBackend`：基于内存 Map（单进程，封装现有 `session-write-lock.ts`）
- `RedisLockBackend`：Redlock 算法（多实例场景）

---

## 第五部分：六维架构模块设计

### 5.1 可治理模块（Governance）

**目录结构**：

```
src/enterprise/governance/
├── identity/
│   ├── identity-provider.ts       # IdentityProvider 接口
│   ├── user-directory.ts          # UserDirectory 接口
│   ├── session-token.ts           # SessionToken 类型 + 管理接口
│   └── impl/
│       ├── oidc-provider.ts       # OIDC 参考实现
│       ├── token-provider.ts      # 兼容现有 Token/Password 认证
│       └── static-directory.ts    # 静态用户目录（配置文件）
├── authorization/
│   ├── policy-engine.ts           # PolicyEngine 接口
│   ├── rbac-types.ts              # Role, Permission, Resource 类型
│   └── impl/
│       ├── scope-policy.ts        # 兼容现有 method-scopes
│       └── rbac-policy.ts         # RBAC 参考实现
├── data-protection/
│   ├── content-filter.ts          # ContentFilter 接口（输入/输出过滤）
│   ├── data-classifier.ts         # DataClassifier 接口（敏感数据检测）
│   └── impl/
│       └── regex-classifier.ts    # 正则匹配参考实现
├── quota/
│   ├── quota-manager.ts           # QuotaManager 接口
│   └── impl/
│       └── token-quota.ts         # LLM Token 配额参考实现
└── middleware/
    ├── authn-middleware.ts         # 认证中间件（调用 IdentityProvider）
    ├── authz-middleware.ts         # 授权中间件（调用 PolicyEngine）
    └── tenant-middleware.ts        # 租户上下文注入中间件
```

#### 5.1.1 IdentityProvider 接口

```typescript
interface IdentityProvider {
  readonly type: string; // "oidc" | "saml" | "token" | "password" | ...

  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  // 从请求中提取并验证身份
  authenticate(request: AuthRequest): Promise<AuthResult>;

  // 刷新令牌（可选）
  refreshToken?(refreshToken: string): Promise<AuthResult>;

  // 吊销令牌（可选）
  revokeToken?(token: string): Promise<void>;
}

interface AuthRequest {
  headers: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  clientIp: string;
  method: string;
  path: string;
}

interface AuthResult {
  authenticated: boolean;
  identity?: UserIdentity;
  error?: string;
  expiresAt?: Date;
}

interface UserIdentity {
  userId: string;
  tenantId: string;
  email?: string;
  displayName?: string;
  roles: string[];
  groups: string[];
  metadata?: Record<string, string>;
}
```

**扩展方式**：企业用户实现 `IdentityProvider` 接口，注册到 Gateway 启动配置中。例如，对接内部 LDAP 只需实现 `authenticate` 方法。

#### 5.1.2 PolicyEngine 接口

```typescript
interface PolicyEngine {
  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  // 权限校验
  authorize(request: AuthzRequest): Promise<AuthzDecision>;

  // 批量校验（UI 用，判断哪些操作可用）
  batchAuthorize(requests: AuthzRequest[]): Promise<AuthzDecision[]>;

  // 动态加载策略（热更新）
  loadPolicies(policies: PolicyDefinition[]): Promise<void>;
}

interface AuthzRequest {
  subject: UserIdentity;        // 谁
  action: string;               // 做什么（如 "sessions.send", "config.set"）
  resource: ResourceDescriptor; // 对什么资源
  context?: Record<string, unknown>; // 环境上下文（IP、时间、设备等）
}

interface ResourceDescriptor {
  type: string;     // "agent" | "session" | "channel" | "config" | "tool" | ...
  id?: string;      // 具体资源 ID
  tenantId: string;
  attributes?: Record<string, unknown>; // 资源属性（用于 ABAC）
}

interface AuthzDecision {
  allowed: boolean;
  reason?: string;
  obligations?: AuthzObligation[]; // 附加要求（如"必须审计"、"必须脱敏"）
}

interface AuthzObligation {
  type: string;  // "audit" | "redact" | "approve" | ...
  params?: Record<string, unknown>;
}

interface PolicyDefinition {
  id: string;
  version: number;
  rules: PolicyRule[];
}

interface PolicyRule {
  effect: "allow" | "deny";
  subjects: string[];   // 角色/组模式匹配
  actions: string[];    // 操作模式匹配
  resources: string[];  // 资源模式匹配
  conditions?: Record<string, unknown>;
}
```

**设计要点**：
- `AuthzDecision.obligations` 允许策略引擎附加额外要求（如"此操作必须经过审批"、"返回结果必须脱敏"），上层中间件负责执行这些 obligations
- `PolicyDefinition` 支持运行时热加载，企业用户可通过 API 动态更新策略
- 参考实现 `ScopePolicyEngine` 封装现有 `method-scopes.ts` 逻辑，保证零配置时行为不变

#### 5.1.3 ContentFilter 接口（数据保护）

```typescript
interface ContentFilter {
  readonly direction: "inbound" | "outbound" | "both";

  // 过滤内容，返回处理后的内容 + 告警
  filter(ctx: TenantContext, content: FilterableContent): Promise<FilterResult>;
}

interface FilterableContent {
  text?: string;
  attachments?: Array<{ name: string; mimeType: string; data: Buffer }>;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}

interface FilterResult {
  passed: boolean;
  content: FilterableContent;  // 可能被修改（脱敏）
  violations: FilterViolation[];
  action: "allow" | "redact" | "block" | "review"; // 最终动作
}

interface FilterViolation {
  rule: string;
  severity: "info" | "warning" | "critical";
  description: string;
  matchedContent?: string;
}
```

**扩展方式**：企业注册多个 `ContentFilter`，按 `direction` 和优先级组成过滤链。输入过滤在 Agent 收到消息时执行，输出过滤在 Agent 发送回复前执行。

### 5.2 可审计模块（Audit）

**目录结构**：

```
src/enterprise/audit/
├── audit-event.ts             # AuditEvent 标准类型
├── audit-pipeline.ts          # AuditPipeline 引擎
├── audit-sink.ts              # AuditSink 接口
├── audit-middleware.ts         # Gateway 审计中间件
├── impl/
│   ├── log-sink.ts            # 文件/stdout Sink（默认）
│   ├── eventbus-sink.ts       # EventBus Sink（内部消费）
│   ├── webhook-sink.ts        # Webhook Sink（对接 SIEM）
│   └── storage-sink.ts        # StorageBackend Sink（持久化查询）
└── query/
    └── audit-query.ts         # 审计日志查询接口
```

#### 5.2.1 AuditEvent 标准类型

```typescript
interface AuditEvent {
  // 标识
  id: string;
  timestamp: Date;
  version: "1.0";

  // 主体
  tenantId: string;
  actor: AuditActor;

  // 操作
  action: string;             // "sessions.send" | "config.set" | "tool.execute" | ...
  category: AuditCategory;
  outcome: "success" | "failure" | "denied";

  // 资源
  resource: AuditResource;

  // 上下文
  source: AuditSource;

  // 详情
  details?: Record<string, unknown>;
  duration?: number;
  error?: string;
}

type AuditCategory =
  | "authentication"
  | "authorization"
  | "data_access"
  | "data_mutation"
  | "agent_action"
  | "tool_execution"
  | "config_change"
  | "admin_action"
  | "system_event";

interface AuditActor {
  type: "user" | "agent" | "system" | "api_key";
  id: string;
  name?: string;
  ip?: string;
  userAgent?: string;
}

interface AuditResource {
  type: string;
  id?: string;
  name?: string;
  tenantId: string;
}

interface AuditSource {
  service: string;    // "gateway" | "agent-runtime" | "worker"
  instance?: string;
  requestId: string;
}
```

#### 5.2.2 AuditSink 接口

```typescript
interface AuditSink {
  readonly name: string;

  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  // 写入审计事件（必须高可用，失败时应缓冲重试）
  write(event: AuditEvent): Promise<void>;
  writeBatch(events: AuditEvent[]): Promise<void>;

  // 声明 Sink 能力
  capabilities(): AuditSinkCapabilities;
}

interface AuditSinkCapabilities {
  queryable: boolean;       // 是否支持查询
  realtime: boolean;        // 是否实时投递
  tamperProof: boolean;     // 是否防篡改
}
```

#### 5.2.3 AuditPipeline 引擎

```typescript
interface AuditPipeline {
  // 注册 Sink（支持多 Sink 并行写入）
  registerSink(sink: AuditSink): void;

  // 发射审计事件（非阻塞，内部缓冲批量写入）
  emit(event: AuditEvent): void;

  // 查询审计日志（委托给支持 queryable 的 Sink）
  query(ctx: TenantContext, query: AuditQuery): Promise<PaginatedResult<AuditEvent>>;

  // 指标
  getMetrics(): AuditMetrics;
}
```

**设计要点**：
- `AuditPipeline` 内部维护一个异步缓冲队列，批量写入 Sink，不阻塞业务请求
- 多个 Sink 可并行注册（如同时写文件和推送 Webhook）
- 审计中间件自动为每个 Gateway RPC 调用生成 AuditEvent，无需业务代码显式调用
- Sink 写入失败时，Pipeline 内部重试，极端情况下降级到本地文件 fallback，不丢弃审计事件

### 5.3 可协作模块（Collaboration）

**目录结构**：

```
src/enterprise/collaboration/
├── task/
│   ├── task-types.ts          # Task 实体类型
│   ├── task-fsm.ts            # Task 有限状态机
│   └── task-store.ts          # Task 存储接口（委托 StorageBackend）
├── workflow/
│   ├── workflow-engine.ts     # WorkflowEngine 接口
│   ├── workflow-types.ts      # Workflow, Step, Transition 类型
│   └── impl/
│       └── simple-workflow.ts # 线性工作流参考实现
├── handoff/
│   ├── handoff-manager.ts     # HandoffManager 接口（人机转交）
│   └── handoff-types.ts       # Handoff 请求/响应类型
└── knowledge/
    ├── knowledge-store.ts     # KnowledgeStore 接口（共享知识库）
    └── impl/
        └── storage-knowledge.ts # 基于 StorageBackend 的参考实现
```

#### 5.3.1 Task 实体与状态机

```typescript
interface Task {
  id: string;
  tenantId: string;
  agentId: string;
  sessionKey: string;
  parentTaskId?: string;    // 子任务关联

  type: TaskType;
  state: TaskState;
  stateHistory: TaskStateTransition[];

  input: unknown;
  output?: unknown;
  error?: TaskError;
  checkpoint?: TaskCheckpoint;

  priority: "high" | "normal" | "low";
  timeoutMs: number;
  maxAttempts: number;
  attemptCount: number;
  idempotencyKey?: string;

  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

type TaskType = "llm_call" | "tool_execution" | "workflow_step" | "message_delivery" | "custom";

type TaskState =
  | "pending"      // 已创建，等待入队
  | "queued"       // 已入队，等待执行
  | "running"      // 正在执行
  | "paused"       // 暂停（等待人工审批等）
  | "completed"    // 成功完成
  | "failed"       // 失败（已耗尽重试）
  | "killed"       // 被主动终止
  | "timeout";     // 超时

interface TaskStateTransition {
  from: TaskState;
  to: TaskState;
  reason: string;
  timestamp: Date;
  actor: string;  // "system" | userId
}
```

**合法状态转换表**：

```
pending   → queued, killed
queued    → running, killed
running   → completed, failed, paused, killed, timeout
paused    → running, killed
failed    → queued (重试)
timeout   → queued (重试)
completed → (终态)
killed    → (终态)
```

状态机严格拒绝不在此表中的转换，并在违反时抛出 `IllegalStateTransitionError`。

#### 5.3.2 WorkflowEngine 接口

```typescript
interface WorkflowEngine {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // 注册工作流定义
  registerWorkflow(definition: WorkflowDefinition): Promise<void>;

  // 启动工作流实例
  startWorkflow(
    ctx: TenantContext,
    workflowId: string,
    input: unknown,
    options?: WorkflowOptions
  ): Promise<WorkflowInstance>;

  // 查询工作流实例
  getWorkflowInstance(ctx: TenantContext, instanceId: string): Promise<WorkflowInstance | null>;

  // 信号/事件注入（用于人工介入、外部回调）
  signal(ctx: TenantContext, instanceId: string, signal: WorkflowSignal): Promise<void>;
}

interface WorkflowDefinition {
  id: string;
  version: number;
  steps: WorkflowStep[];
  transitions: WorkflowTransition[];
  errorHandler?: string; // step id
  timeoutMs?: number;
}

interface WorkflowStep {
  id: string;
  type: "agent_task" | "human_review" | "condition" | "parallel" | "wait_signal";
  config: Record<string, unknown>;
  timeoutMs?: number;
}

interface WorkflowTransition {
  from: string;       // step id
  to: string;         // step id
  condition?: string; // 表达式
}

interface WorkflowSignal {
  type: string;
  data: unknown;
  sender: string;
}
```

**设计要点**：
- `WorkflowEngine` 是接口而非具体实现。参考实现提供线性工作流（步骤顺序执行），企业用户可实现复杂 DAG 编排
- `human_review` 类型的 Step 会暂停工作流，等待外部 `signal` 注入（实现人机协作的会话转交）
- 工作流实例的状态通过 `StorageBackend` 持久化，支持断点恢复

### 5.4 可嵌入模块（Embedding）

**目录结构**：

```
src/enterprise/embedding/
├── api/
│   ├── rest-api-builder.ts     # REST API 路由自动生成
│   ├── openapi-generator.ts    # OpenAPI 文档生成
│   └── api-versioning.ts       # API 版本管理
├── rate-limit/
│   ├── rate-limiter.ts         # RateLimiter 接口
│   └── impl/
│       ├── memory-limiter.ts   # 内存令牌桶
│       └── redis-limiter.ts    # 分布式令牌桶
├── api-key/
│   ├── api-key-manager.ts      # API Key 生命周期管理接口
│   └── impl/
│       └── storage-api-key.ts  # 基于 StorageBackend 的参考实现
├── event-sink/
│   ├── external-event-sink.ts  # ExternalEventSink 接口
│   └── impl/
│       ├── webhook-event-sink.ts
│       └── stdout-event-sink.ts
└── sdk/
    └── message-envelope.ts     # 统一消息信封格式
```

#### 5.4.1 RateLimiter 接口

```typescript
interface RateLimiter {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // 检查是否允许请求
  check(key: RateLimitKey): Promise<RateLimitResult>;

  // 消费配额
  consume(key: RateLimitKey, tokens?: number): Promise<RateLimitResult>;

  // 重置配额
  reset(key: RateLimitKey): Promise<void>;
}

interface RateLimitKey {
  tenantId: string;
  userId?: string;
  resource?: string;  // 如 "api", "llm", "tool"
  action?: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
  retryAfter?: number; // 秒
}
```

#### 5.4.2 REST API 构建器

**设计理念**：不手写 REST 路由，而是从现有 Gateway RPC 方法定义自动生成 RESTful 端点。

```typescript
interface RestApiBuilder {
  // 从 Gateway 方法注册表自动生成 REST 路由
  buildFromMethods(methods: GatewayMethodRegistry): RestRouteMap;

  // 生成 OpenAPI 3.0 文档
  generateOpenApiSpec(routes: RestRouteMap): OpenApiDocument;

  // 注册自定义路由（扩展点）
  registerCustomRoute(route: CustomRestRoute): void;
}
```

**设计要点**：
- 现有 WebSocket JSON-RPC 方法（如 `sessions.send`）自动映射为 `POST /api/v1/sessions/:key/send`
- OpenAPI 文档从 Gateway 方法的 Schema 定义自动生成
- API 版本通过 URL 前缀（`/api/v1/`）管理
- 每个 REST 端点自动经过中间件链（AuthN → AuthZ → Tenant → Audit → RateLimit）

#### 5.4.3 统一消息信封

```typescript
interface MessageEnvelope {
  id: string;
  version: "1.0";
  tenantId: string;
  timestamp: Date;

  // 来源
  source: {
    type: "user" | "agent" | "system" | "webhook";
    id: string;
    channel?: string;
  };

  // 目标
  target: {
    agentId: string;
    sessionKey?: string;
  };

  // 内容（通道无关的统一格式）
  content: {
    type: "text" | "rich" | "command" | "event";
    text?: string;
    richElements?: RichElement[];  // 卡片、按钮、表单等
    command?: { name: string; args: Record<string, unknown> };
    attachments?: Attachment[];
  };

  // 元数据
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  replyTo?: string;
}
```

**设计要点**：
- `MessageEnvelope` 是通道无关的统一消息格式。Channel Adapter 负责将各通道消息（Telegram、Slack、自定义 IM）转换为此格式
- `richElements` 支持结构化 UI（卡片、按钮、下拉选择），由各 Channel Adapter 负责渲染为通道原生格式
- 企业用户嵌入 Agent 到自己的系统时，只需对接 `MessageEnvelope`，不需要理解具体通道协议

### 5.5 可隔离模块（Isolation）

**目录结构**：

```
src/enterprise/isolation/
├── runtime/
│   ├── agent-runtime-backend.ts    # AgentRuntimeBackend 接口
│   ├── runtime-types.ts            # RuntimeSpec, RuntimeStatus
│   └── impl/
│       ├── inprocess-runtime.ts    # 进程内运行时（默认，兼容个人版）
│       ├── docker-runtime.ts       # Docker 容器运行时
│       └── k8s-runtime.ts          # Kubernetes Pod 运行时
├── network/
│   ├── network-policy.ts           # NetworkPolicy 接口
│   └── impl/
│       ├── noop-policy.ts          # 无限制（默认）
│       └── allowlist-policy.ts     # 出站白名单
├── filesystem/
│   ├── fs-isolation.ts             # FsIsolation 接口
│   └── impl/
│       ├── shared-fs.ts            # 共享文件系统（默认）
│       └── volume-fs.ts            # 独立卷隔离
└── resource/
    ├── resource-limiter.ts         # ResourceLimiter 接口
    └── impl/
        └── cgroup-limiter.ts       # cgroup 资源限制
```

#### 5.5.1 AgentRuntimeBackend 接口

这是隔离维度最核心的接口。它定义了 Agent 运行时的生命周期管理。

```typescript
interface AgentRuntimeBackend {
  readonly type: string; // "inprocess" | "docker" | "kubernetes" | ...

  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  // 创建运行时实例
  create(spec: RuntimeSpec): Promise<RuntimeInstance>;

  // 启动
  start(instanceId: string): Promise<void>;

  // 停止（优雅）
  stop(instanceId: string, timeoutMs: number): Promise<void>;

  // 强制终止
  kill(instanceId: string): Promise<void>;

  // 查询状态
  getStatus(instanceId: string): Promise<RuntimeStatus>;

  // 列出运行中的实例
  listInstances(filter?: RuntimeFilter): Promise<RuntimeInstance[]>;

  // 执行命令（在运行时实例内）
  exec(instanceId: string, command: RuntimeExecRequest): Promise<RuntimeExecResult>;

  // 健康检查
  healthCheck(instanceId: string): Promise<HealthStatus>;
}

interface RuntimeSpec {
  tenantId: string;
  agentId: string;
  sessionKey?: string;

  // 隔离要求
  isolation: {
    network: NetworkPolicySpec;
    filesystem: FsIsolationSpec;
    resources: ResourceLimitSpec;
  };

  // 运行时配置
  image?: string;         // 容器镜像
  env?: Record<string, string>;
  volumes?: VolumeMount[];
  labels?: Record<string, string>;

  // 生命周期
  timeoutMs?: number;
  idleTimeoutMs?: number;
}

interface NetworkPolicySpec {
  mode: "none" | "allowlist" | "full";
  allowedHosts?: string[];   // 当 mode = "allowlist" 时
  allowedPorts?: number[];
}

interface FsIsolationSpec {
  workspaceAccess: "none" | "readonly" | "readwrite";
  persistentVolume?: boolean;
  maxDiskBytes?: number;
}

interface ResourceLimitSpec {
  cpuMillicores?: number;
  memoryMb?: number;
  pidsLimit?: number;
}

interface RuntimeStatus {
  instanceId: string;
  state: "creating" | "running" | "stopping" | "stopped" | "failed";
  startedAt?: Date;
  stoppedAt?: Date;
  resourceUsage?: {
    cpuPercent: number;
    memoryMb: number;
    networkRxBytes: number;
    networkTxBytes: number;
  };
}
```

**参考实现**：

| 实现 | 说明 |
|------|------|
| `InProcessRuntime` | Agent 运行在 Gateway 进程内（等价于当前行为）。`create` 是 no-op，`exec` 直接函数调用。 |
| `DockerRuntime` | 封装现有 `src/agents/sandbox/docker.ts`，将其扩展为完整的 Agent 生命周期管理（不仅仅是工具执行）。 |
| `KubernetesRuntime` | 通过 K8s API 创建 Pod。每个 Agent 是一个 Pod，Tool Sandbox 是 Pod 内的 Sidecar 容器。 |

**设计要点**：
- `InProcessRuntime` 保证个人版用户零改变
- `DockerRuntime` 复用现有沙箱的安全配置（capDrop、readOnlyRoot、no-new-privileges 等）
- `KubernetesRuntime` 通过 `RuntimeSpec.isolation` 自动生成 K8s manifest（Pod spec + NetworkPolicy + PVC + ResourceQuota）
- 企业用户可实现自己的 Runtime Backend（如 AWS ECS、Azure Container Instances、Firecracker MicroVM）

#### 5.5.2 NetworkPolicy 接口

```typescript
interface NetworkPolicyProvider {
  // 为 Agent 实例生成网络策略
  applyPolicy(instanceId: string, spec: NetworkPolicySpec): Promise<void>;

  // 移除策略
  removePolicy(instanceId: string): Promise<void>;

  // 验证出站请求（用于应用层网络控制）
  checkEgress(instanceId: string, host: string, port: number): Promise<boolean>;
}
```

### 5.6 可靠性模块（Reliability）

**目录结构**：

```
src/enterprise/reliability/
├── fsm/
│   ├── state-machine.ts          # StateMachine 泛型引擎
│   ├── task-fsm.ts               # Task 专用 FSM（合法转换表）
│   └── session-fsm.ts            # Session 专用 FSM
├── retry/
│   ├── retry-policy-registry.ts  # 统一重试策略注册表
│   ├── circuit-breaker.ts        # CircuitBreaker 接口 + 实现
│   └── retry-metrics.ts          # 重试指标收集
├── checkpoint/
│   ├── checkpoint-manager.ts     # CheckpointManager 接口
│   └── impl/
│       └── storage-checkpoint.ts # 基于 StorageBackend 的实现
├── timeout/
│   ├── timeout-manager.ts        # 统一超时管理器
│   └── cascade-kill.ts           # 级联终止逻辑
├── health/
│   ├── health-aggregator.ts      # 健康状态聚合器
│   └── metrics-provider.ts       # MetricsProvider 接口
└── dlq/
    ├── dead-letter-manager.ts    # DLQ 管理器
    └── dlq-alerter.ts            # DLQ 告警接口
```

#### 5.6.1 StateMachine 泛型引擎

```typescript
interface StateMachineDefinition<S extends string, E extends string> {
  initialState: S;
  terminalStates: S[];
  transitions: Array<{
    from: S | S[];
    event: E;
    to: S;
    guard?: (context: unknown) => boolean;
    action?: (context: unknown) => void | Promise<void>;
  }>;
}

interface StateMachine<S extends string, E extends string> {
  readonly currentState: S;
  readonly history: Array<{ from: S; to: S; event: E; timestamp: Date }>;

  // 触发状态转换（非法转换抛出 IllegalStateTransitionError）
  transition(event: E, context?: unknown): Promise<S>;

  // 检查是否可以转换
  canTransition(event: E): boolean;

  // 是否在终态
  isTerminal(): boolean;

  // 序列化/反序列化（用于持久化）
  serialize(): StateMachineSnapshot<S>;
  static restore<S, E>(snapshot: StateMachineSnapshot<S>, definition: StateMachineDefinition<S, E>): StateMachine<S, E>;
}
```

#### 5.6.2 CircuitBreaker

```typescript
interface CircuitBreaker {
  readonly name: string;
  readonly state: "closed" | "open" | "half-open";

  // 执行受保护的操作
  execute<T>(fn: () => Promise<T>): Promise<T>;

  // 手动操作
  reset(): void;
  trip(): void;

  // 指标
  getMetrics(): CircuitBreakerMetrics;
}

interface CircuitBreakerOptions {
  failureThreshold: number;    // 连续失败次数触发熔断（默认 5）
  resetTimeoutMs: number;      // 熔断持续时间（默认 30000）
  halfOpenMaxAttempts: number;  // 半开状态允许的探测次数（默认 1）
  failureFilter?: (error: Error) => boolean; // 哪些错误计入失败
}

interface CircuitBreakerMetrics {
  state: "closed" | "open" | "half-open";
  totalRequests: number;
  successCount: number;
  failureCount: number;
  lastFailure?: Date;
  lastSuccess?: Date;
}
```

#### 5.6.3 CheckpointManager

```typescript
interface CheckpointManager {
  // 创建检查点
  save(ctx: TenantContext, taskId: string, checkpoint: TaskCheckpoint): Promise<string>;

  // 读取最新检查点
  getLatest(ctx: TenantContext, taskId: string): Promise<TaskCheckpoint | null>;

  // 从检查点恢复
  restore(ctx: TenantContext, checkpointId: string): Promise<TaskCheckpoint>;

  // 清理过期检查点
  cleanup(ctx: TenantContext, retentionMs: number): Promise<number>;
}

interface TaskCheckpoint {
  id: string;
  taskId: string;
  stepIndex: number;       // 当前步骤位置
  state: unknown;          // 序列化的运行时状态
  completedSteps: string[];
  pendingSteps: string[];
  createdAt: Date;
  metadata?: Record<string, unknown>;
}
```

#### 5.6.4 统一超时管理器

```typescript
interface TimeoutManager {
  // 注册超时（返回取消句柄）
  register(taskId: string, config: TimeoutConfig): TimeoutHandle;

  // 取消超时
  cancel(handle: TimeoutHandle): void;

  // 注册超时事件处理器
  onTimeout(handler: (taskId: string, level: TimeoutLevel) => Promise<void>): void;

  // 注册预警处理器
  onWarning(handler: (taskId: string, percent: number) => Promise<void>): void;
}

interface TimeoutConfig {
  totalMs: number;
  warningPercent?: number;   // 预警阈值百分比（默认 80）
  levels: TimeoutLevel[];    // 级联终止策略
}

interface TimeoutLevel {
  action: "signal" | "abort" | "kill";
  delayMs: number; // 相对于超时触发点的延迟
}
```

**设计要点**：
- 默认的级联 Kill 策略：`signal`（AbortSignal）→ 5s → `abort`（进程 SIGTERM）→ 10s → `kill`（进程 SIGKILL + 容器销毁）
- `warningPercent` 达到时通过 EventBus 发出预警事件，可对接告警系统

#### 5.6.5 MetricsProvider 接口

```typescript
interface MetricsProvider {
  // 计数器
  counter(name: string, labels?: Record<string, string>): CounterMetric;

  // 直方图
  histogram(name: string, buckets?: number[], labels?: Record<string, string>): HistogramMetric;

  // 测量值
  gauge(name: string, labels?: Record<string, string>): GaugeMetric;

  // 暴露 Prometheus 格式
  serialize(): string;
}
```

**参考实现**：`NoopMetricsProvider`（默认）、`PrometheusMetricsProvider`。

---

## 第六部分：模块依赖与交互

### 6.1 依赖关系图

```
                    ┌─────────────┐
                    │  API Layer  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
        ┌─────┴─────┐ ┌───┴────┐ ┌────────┴────────┐
        │Governance  │ │ Audit  │ │   Embedding     │
        │(AuthN/AuthZ│ │Pipeline│ │(REST/RateLimit) │
        │ DLP/Quota) │ │        │ │                 │
        └─────┬──────┘ └───┬────┘ └────────┬────────┘
              │            │                │
              └────────────┼────────────────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
      ┌───────┴──────┐ ┌──┴───────┐ ┌──────┴────────┐
      │Collaboration │ │Isolation │ │  Reliability   │
      │(Task/Workflow│ │(Runtime/ │ │(FSM/Retry/     │
      │ Handoff)     │ │ Network) │ │ Checkpoint)    │
      └───────┬──────┘ └──┬───────┘ └──────┬────────┘
              │            │                │
              └────────────┼────────────────┘
                           │
              ┌────────────┴────────────────┐
              │     Kernel Abstractions     │
              │ Storage│Queue│Cache│Secret  │
              │ EventBus│Lock               │
              └────────────┬────────────────┘
                           │
              ┌────────────┴────────────────┐
              │    Reference Impls /        │
              │    Enterprise Infra         │
              │ PG│Redis│Docker│K8s│Vault   │
              └─────────────────────────────┘
```

### 6.2 中间件链调用顺序

每个进入 Gateway 的请求（REST/WebSocket/Webhook）依次经过：

```
Request → AuthN → TenantContext → AuthZ → RateLimit → [Business Logic] → ContentFilter → Audit → Response
                                                              │
                                                      (如果涉及 Agent 操作)
                                                              │
                                            AgentScheduler → TaskFSM → Queue → AgentRuntime
                                                              │
                                                        CheckpointManager
```

### 6.3 模块间通信

模块间不直接调用，通过 EventBus 解耦：

| 生产者 | 事件类型 | 消费者 |
|--------|----------|--------|
| AuthN 中间件 | `auth.login.success / failure` | Audit |
| AuthZ 中间件 | `authz.check.denied` | Audit |
| Task FSM | `task.state.changed` | Audit, Metrics, Workflow |
| Agent Runtime | `agent.started / stopped / error` | Health, Audit |
| Content Filter | `content.violation.detected` | Audit, Alert |
| Checkpoint | `checkpoint.saved / restored` | Audit |
| Queue | `queue.dlq.entered` | Alert |
| Circuit Breaker | `circuit.opened / closed` | Metrics, Alert |
| Timeout Manager | `task.timeout.warning / triggered` | Alert, CascadeKill |

---

## 第七部分：迁移策略

### 7.1 兼容性约束

| 约束 | 保证 |
|------|------|
| **现有配置格式** | `openclaw.json` 保持兼容，企业功能通过新增配置段 `enterprise: {...}` 开启 |
| **现有 Plugin SDK** | `openclaw/plugin-sdk/*` 接口不变。企业模块通过独立的 SPI 注入 |
| **现有 CLI** | 所有现有命令保持不变。企业命令通过 `openclaw enterprise ...` 子命令提供 |
| **现有部署方式** | `openclaw gateway run` 保持单进程模式。企业部署通过额外配置启用分离模式 |
| **默认行为** | 不配置 `enterprise` 段时，行为与升级前完全一致 |

### 7.2 迁移路径

```
Phase 0: 内核抽象层（不改变任何外部行为）
  └─ 定义 6 个内核接口
  └─ 实现 Memory/FileSystem 后端（封装现有代码）
  └─ 将现有代码的直接文件操作迁移到 StorageBackend 接口
  └─ 将现有内存队列迁移到 QueueBackend 接口
  └─ 将现有 session-write-lock 迁移到 LockBackend 接口
  └─ 将现有 SecretRef 封装为 SecretBackend
  └─ 将现有 EventEmitter 封装为 EventBus
  验证：所有现有测试通过，性能不退化

Phase 1: 六维架构模块骨架
  └─ 定义所有六维模块接口（纯 .ts interface 文件）
  └─ 实现兼容性参考实现（封装现有逻辑）
    └─ TokenIdentityProvider（封装现有 auth.ts）
    └─ ScopePolicyEngine（封装现有 method-scopes.ts）
    └─ InProcessRuntime（封装现有 Agent 运行时）
    └─ LogAuditSink（封装现有日志）
  └─ 引入中间件链，但默认行为透传
  验证：所有现有测试通过，企业接口可被外部实现

Phase 2: 企业参考实现
  └─ PostgresStorageBackend
  └─ RedisQueueBackend + RedisCacheBackend + RedisLockBackend
  └─ OidcIdentityProvider
  └─ RbacPolicyEngine
  └─ DockerRuntime（扩展现有沙箱）
  └─ WebhookAuditSink + StorageAuditSink
  └─ TaskFSM + CheckpointManager
  └─ CircuitBreaker + RetryPolicyRegistry
  └─ RestApiBuilder + OpenApiGenerator
  验证：企业部署 E2E 测试通过

Phase 3: K8s 部署与高级功能
  └─ KubernetesRuntime
  └─ Helm Chart
  └─ WorkflowEngine 参考实现
  └─ PrometheusMetricsProvider
  └─ 企业部署文档
  验证：K8s 集群 E2E 测试通过
```

### 7.3 阶段里程碑

| 阶段 | 时间 | 交付物 | 验收标准 |
|------|------|--------|----------|
| **Phase 0** | 4-6 周 | 内核抽象层 + Memory/FS 后端 | 全量测试通过，零行为变更，性能基准持平 |
| **Phase 1** | 4-6 周 | 六维模块接口 + 兼容实现 + 中间件链 | 企业接口可被外部 `implements`；现有功能不退化 |
| **Phase 2** | 8-10 周 | PG/Redis/OIDC/RBAC/Docker 参考实现 | 单机企业部署可运行；多租户 + 审计 + 隔离 E2E 通过 |
| **Phase 3** | 6-8 周 | K8s 部署 + Workflow + Metrics | K8s 集群 3 节点压测通过；OpenAPI 文档可用 |

---

## 第八部分：开源生态设计

### 8.1 仓库结构

```
openclaw/
├── src/                         # 现有核心代码（保持不变）
│   ├── gateway/
│   ├── agents/
│   ├── channels/
│   ├── ...
│   └── enterprise/              # 新增：企业级架构代码
│       ├── kernel/              # 内核接口（纯接口）
│       ├── kernel-impl/         # 参考实现
│       ├── governance/
│       ├── audit/
│       ├── collaboration/
│       ├── embedding/
│       ├── isolation/
│       └── reliability/
├── extensions/                  # 现有扩展（保持不变）
├── docs/
│   └── enterprise/              # 企业版文档
│       ├── architecture.md
│       ├── getting-started.md
│       ├── interfaces/          # 每个接口的使用指南
│       ├── deployment/          # 部署指南
│       └── examples/            # 集成示例
└── examples/                    # 新增：企业集成示例
    ├── custom-identity-provider/
    ├── custom-audit-sink/
    ├── custom-runtime-backend/
    └── k8s-deployment/
```

### 8.2 企业用户扩展方式

企业用户有三种扩展路径：

**路径 A：实现接口（最常见）**

```typescript
// 企业内部的 LDAP 认证实现
import type { IdentityProvider } from "openclaw/enterprise/kernel";

export class LdapIdentityProvider implements IdentityProvider {
  readonly type = "ldap";
  async authenticate(request: AuthRequest): Promise<AuthResult> {
    // 企业自定义逻辑
  }
}
```

**路径 B：注册插件（通过配置）**

```json5
// openclaw.json
{
  "enterprise": {
    "identity": {
      "provider": "@my-company/openclaw-ldap-provider"
    },
    "audit": {
      "sinks": ["@my-company/openclaw-splunk-sink"]
    },
    "storage": {
      "backend": "@my-company/openclaw-oracle-storage"
    }
  }
}
```

**路径 C：Fork + 定制（大型企业）**

- Fork 仓库，修改参考实现
- 利用接口稳定性保证，跟踪上游更新

### 8.3 接口稳定性承诺

| 接口层级 | 稳定性 | 说明 |
|----------|--------|------|
| `kernel/*` 内核接口 | **Stable** | 遵循语义化版本，Breaking Change 提前两个版本标记 `@deprecated` |
| 六维模块接口 | **Stable** | 同上 |
| 参考实现 | **Unstable** | 内部实现可随时变更，不保证 API 兼容 |
| 中间件链顺序 | **Stable** | 中间件执行顺序是架构契约，变更需 Major 版本 |

### 8.4 文档要求

每个接口必须附带：

1. **接口定义**：TypeScript interface + JSDoc
2. **设计说明**：为什么需要这个接口，解决什么问题
3. **参考实现说明**：内置的参考实现如何工作
4. **扩展指南**：企业用户如何实现自己的版本
5. **测试套件**：每个接口提供一组合规测试（conformance test），自定义实现必须通过这些测试

---

## 第九部分：验收标准

### 9.1 架构验收

| 标准 | 验证方法 |
|------|----------|
| **零外部依赖启动** | `openclaw gateway run` 无需 PG/Redis 即可启动，行为与升级前一致 |
| **接口覆盖六维度** | 每个维度至少有一个核心接口 + 一个参考实现 + 一个合规测试套件 |
| **租户隔离** | 配置两个租户后，租户 A 的 API 调用无法访问租户 B 的数据（集成测试验证） |
| **审计不可绕过** | 通过 Gateway 的任何操作都在审计日志中有记录（集成测试验证） |
| **状态机强制** | 尝试非法状态转换时抛出 `IllegalStateTransitionError`（单元测试验证） |
| **接口可替换** | 不修改核心代码，仅通过配置替换后端实现（集成测试验证） |

### 9.2 性能验收

| 指标 | 单机模式 | 企业模式（PG+Redis） |
|------|----------|---------------------|
| API 延迟增加 | < 5ms（中间件链开销） | < 15ms |
| 审计事件吞吐 | > 1000 events/s | > 5000 events/s |
| 队列入队延迟 | < 1ms（内存） | < 5ms（Redis） |
| 存储读取延迟 | < 1ms（内存/文件） | < 10ms（PG） |

### 9.3 开源验收

| 标准 | 验证方法 |
|------|----------|
| **文档完整性** | 每个接口有使用指南 + 扩展示例 |
| **示例项目** | `examples/` 包含至少 3 个完整的企业集成示例 |
| **合规测试** | 每个接口有独立的合规测试套件，企业自定义实现可直接运行 |
| **贡献指南** | 企业版 `CONTRIBUTING.md` 说明如何贡献新的后端实现 |

---

## 附录 A：配置结构预览

```json5
{
  // 现有配置保持不变
  "agents": [...],
  "channels": {...},
  "bindings": [...],

  // 新增：企业级配置段
  "enterprise": {
    "enabled": true,

    // 内核后端选择
    "kernel": {
      "storage": {
        "backend": "postgres",              // "memory" | "filesystem" | "postgres" | 自定义包名
        "postgres": {
          "connectionString": { "source": "env", "id": "DATABASE_URL" },
          "pool": { "min": 2, "max": 10 }
        }
      },
      "queue": {
        "backend": "redis",                 // "memory" | "redis" | "postgres"
        "redis": {
          "url": { "source": "env", "id": "REDIS_URL" }
        }
      },
      "cache": {
        "backend": "redis"                  // "memory" | "redis"
      },
      "secret": {
        "backend": "vault",                 // "secret-ref" | "env" | "vault"
        "vault": {
          "address": "https://vault.internal:8200",
          "authMethod": "kubernetes"
        }
      },
      "eventBus": {
        "backend": "redis"                  // "inprocess" | "redis"
      },
      "lock": {
        "backend": "redis"                  // "inprocess" | "redis"
      }
    },

    // 可治理
    "governance": {
      "identity": {
        "provider": "oidc",
        "oidc": {
          "issuer": "https://auth.company.com",
          "clientId": "openclaw-enterprise",
          "clientSecret": { "source": "env", "id": "OIDC_CLIENT_SECRET" }
        }
      },
      "authorization": {
        "engine": "rbac",
        "defaultRole": "viewer"
      },
      "dataProtection": {
        "filters": [
          { "type": "regex-classifier", "direction": "both" }
        ]
      },
      "quota": {
        "enabled": true,
        "defaultLimits": {
          "llmTokensPerDay": 100000,
          "apiCallsPerMinute": 60
        }
      }
    },

    // 可审计
    "audit": {
      "sinks": [
        { "type": "log", "path": "/var/log/openclaw/audit.jsonl" },
        { "type": "webhook", "url": "https://siem.company.com/ingest", "batchSize": 100 }
      ]
    },

    // 可隔离
    "isolation": {
      "runtime": {
        "backend": "docker",                // "inprocess" | "docker" | "kubernetes"
        "defaults": {
          "network": { "mode": "allowlist", "allowedHosts": ["api.openai.com"] },
          "resources": { "memoryMb": 512, "cpuMillicores": 500 }
        }
      }
    },

    // 可嵌入
    "embedding": {
      "restApi": { "enabled": true, "prefix": "/api/v1" },
      "openapi": { "enabled": true },
      "rateLimit": {
        "backend": "redis",
        "defaultLimits": { "requestsPerMinute": 120 }
      }
    },

    // 可靠性
    "reliability": {
      "retry": {
        "defaultPolicy": { "maxAttempts": 3, "baseDelayMs": 500, "maxDelayMs": 30000 }
      },
      "circuitBreaker": {
        "failureThreshold": 5,
        "resetTimeoutMs": 30000
      },
      "timeout": {
        "defaults": {
          "llmCall": 120000,
          "toolExecution": 60000,
          "sessionTotal": 600000
        },
        "cascadeKill": {
          "signalDelayMs": 0,
          "abortDelayMs": 5000,
          "killDelayMs": 15000
        }
      },
      "checkpoint": { "enabled": true },
      "metrics": { "provider": "prometheus", "port": 9090 }
    }
  }
}
```

---

## 附录 B：术语表

| 术语 | 定义 |
|------|------|
| **内核抽象层** | 6 个基础设施接口（Storage、Queue、Cache、Secret、EventBus、Lock）的集合，所有上层模块依赖此层 |
| **参考实现** | 每个接口附带的开源实现，企业用户可直接使用或替换 |
| **六维模块** | 可治理、可审计、可协作、可嵌入、可隔离、可靠性六个企业级架构模块 |
| **TenantContext** | 贯穿所有操作的租户上下文对象，包含 tenantId、userId、agentId、requestId |
| **中间件链** | API 请求经过的处理管道：AuthN → TenantContext → AuthZ → RateLimit → Business → ContentFilter → Audit |
| **合规测试** | 每个接口附带的测试套件，自定义实现必须通过以证明其符合接口契约 |
| **FSM** | 有限状态机（Finite State Machine），用于 Task 和 Session 的状态管理 |
| **DLQ** | 死信队列（Dead Letter Queue），存放重试耗尽的消息 |
| **SPI** | 服务提供者接口（Service Provider Interface），企业架构模块的扩展方式 |

---

## 附录 C：与现有代码的映射关系

| 现有代码 | 企业版对应 | 迁移方式 |
|----------|------------|----------|
| `src/gateway/auth.ts` | `governance/identity/impl/token-provider.ts` | 封装为 IdentityProvider 实现 |
| `src/gateway/method-scopes.ts` | `governance/authorization/impl/scope-policy.ts` | 封装为 PolicyEngine 实现 |
| `src/gateway/auth-rate-limit.ts` | `embedding/rate-limit/impl/memory-limiter.ts` | 封装为 RateLimiter 实现 |
| `src/config/sessions/store.ts` | `kernel-impl/filesystem/storage.ts` | 封装为 StorageBackend 实现 |
| `src/process/command-queue.ts` | `kernel-impl/memory/queue.ts` | 封装为 QueueBackend 实现 |
| `src/agents/session-write-lock.ts` | `kernel-impl/memory/lock.ts` | 封装为 LockBackend 实现 |
| `src/infra/retry.ts` | `reliability/retry/retry-policy-registry.ts` | 注册为统一重试策略 |
| `src/gateway/chat-abort.ts` | `reliability/timeout/timeout-manager.ts` | 纳入统一超时管理 |
| `src/agents/sandbox/docker.ts` | `isolation/runtime/impl/docker-runtime.ts` | 扩展为完整 AgentRuntimeBackend |
| `src/gateway/control-plane-audit.ts` | `audit/impl/log-sink.ts` | 封装为 AuditSink |
| `src/logging/diagnostic.ts` | `audit/audit-middleware.ts` | 纳入统一审计管道 |
| `src/agents/subagent-orphan-recovery.ts` | `reliability/health/health-aggregator.ts` | 纳入统一健康管理 |
| `src/gateway/channel-health-monitor.ts` | `reliability/health/health-aggregator.ts` | 纳入统一健康管理 |
| `src/infra/outbound/delivery-queue.ts` | `kernel-impl/filesystem/queue.ts` | 保留为投递队列的文件后端 |
| `src/config/types.secrets.ts` | `kernel/secret.ts` + `kernel-impl/secret-ref.ts` | 封装为 SecretBackend |
| 现有 Plugin SDK | 不变 | 企业模块通过独立 SPI 扩展 |
