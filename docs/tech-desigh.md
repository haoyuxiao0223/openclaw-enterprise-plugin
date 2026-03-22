# OpenClaw Enterprise 技术实现方案（方案一：渐进演进）

> **版本**：v1.0
> **日期**：2026-03-21
> **基于**：PRD v1.0 + 技术栈推荐方案（方案一）+ 现有代码分析
> **核心原则**：每个 Phase 结束时，所有现有测试必须通过，现有行为不退化。

---

## 目录

- [一、总体架构与目录结构](#一总体架构与目录结构)
- [二、依赖注入与启动引导](#二依赖注入与启动引导)
- [三、Phase 0：内核抽象层实现](#三phase-0内核抽象层实现)
- [四、Phase 1：六维架构模块骨架](#四phase-1六维架构模块骨架)
- [五、Phase 2：企业参考实现](#五phase-2企业参考实现)
- [六、Phase 3：K8s 部署与高级功能](#六phase-3k8s-部署与高级功能)
- [七、测试策略](#七测试策略)
- [八、部署方案](#八部署方案)
- [九、风险与缓解](#九风险与缓解)

---

## 一、总体架构与目录结构

### 1.1 新增目录结构

在现有 `src/` 下新增 `enterprise/` 目录，与现有代码平级隔离：

```
src/
├── enterprise/                          # ← 新增：企业级架构代码
│   ├── index.ts                         # 企业模块统一入口
│   ├── bootstrap.ts                     # 企业模块启动引导
│   ├── config.ts                        # 企业配置类型定义与解析
│   │
│   ├── kernel/                          # 内核抽象层（纯接口，零实现）
│   │   ├── index.ts                     # 统一导出所有内核接口
│   │   ├── storage.ts                   # StorageBackend 接口
│   │   ├── queue.ts                     # QueueBackend 接口
│   │   ├── cache.ts                     # CacheBackend 接口
│   │   ├── secret.ts                    # SecretBackend 接口
│   │   ├── event-bus.ts                 # EventBus 接口
│   │   ├── lock.ts                      # LockBackend 接口
│   │   ├── tenant-context.ts            # TenantContext 类型
│   │   ├── health.ts                    # HealthStatus 通用类型
│   │   └── errors.ts                    # 内核层错误类型
│   │
│   ├── kernel-impl/                     # 参考实现
│   │   ├── index.ts                     # 统一导出所有默认实现
│   │   ├── memory/                      # 内存实现（默认，零依赖）
│   │   │   ├── storage.ts
│   │   │   ├── queue.ts
│   │   │   ├── cache.ts
│   │   │   ├── event-bus.ts
│   │   │   ├── lock.ts
│   │   │   └── secret.ts
│   │   ├── filesystem/                  # 文件系统实现（兼容个人版）
│   │   │   ├── storage.ts              # 封装现有 sessions/store.ts
│   │   │   ├── queue.ts               # 封装现有 delivery-queue.ts
│   │   │   └── secret.ts              # 封装现有 SecretRef
│   │   ├── postgres/                    # Phase 2：PostgreSQL 实现
│   │   │   ├── storage.ts
│   │   │   ├── queue.ts
│   │   │   ├── migrations/
│   │   │   │   ├── 001-init-schema.ts
│   │   │   │   ├── 002-audit-tables.ts
│   │   │   │   └── runner.ts
│   │   │   └── connection.ts           # Kysely 实例管理
│   │   └── redis/                       # Phase 2：Redis 实现
│   │       ├── cache.ts
│   │       ├── queue.ts
│   │       ├── event-bus.ts
│   │       ├── lock.ts
│   │       └── connection.ts           # ioredis 实例管理
│   │
│   ├── governance/                      # 可治理模块
│   │   ├── identity/
│   │   │   ├── identity-provider.ts     # 接口
│   │   │   ├── user-directory.ts
│   │   │   └── impl/
│   │   │       ├── token-provider.ts    # 封装现有 auth.ts
│   │   │       └── oidc-provider.ts     # Phase 2
│   │   ├── authorization/
│   │   │   ├── policy-engine.ts         # 接口
│   │   │   └── impl/
│   │   │       ├── scope-policy.ts      # 封装现有 method-scopes
│   │   │       └── rbac-policy.ts       # Phase 2，基于 CASL
│   │   ├── data-protection/
│   │   │   ├── content-filter.ts
│   │   │   └── impl/
│   │   │       └── regex-classifier.ts
│   │   ├── quota/
│   │   │   ├── quota-manager.ts
│   │   │   └── impl/
│   │   │       └── token-quota.ts
│   │   └── middleware/
│   │       ├── authn-middleware.ts
│   │       ├── authz-middleware.ts
│   │       ├── tenant-middleware.ts
│   │       └── chain.ts                # 中间件链组装
│   │
│   ├── audit/                           # 可审计模块
│   │   ├── audit-event.ts
│   │   ├── audit-pipeline.ts
│   │   ├── audit-sink.ts               # 接口
│   │   ├── audit-middleware.ts
│   │   └── impl/
│   │       ├── log-sink.ts             # 封装现有日志
│   │       ├── eventbus-sink.ts
│   │       ├── webhook-sink.ts
│   │       └── storage-sink.ts
│   │
│   ├── collaboration/                   # 可协作模块
│   │   ├── task/
│   │   │   ├── task-types.ts
│   │   │   ├── task-fsm.ts             # 自研轻量 FSM
│   │   │   └── task-store.ts
│   │   ├── workflow/
│   │   │   ├── workflow-engine.ts       # 接口
│   │   │   └── impl/
│   │   │       └── simple-workflow.ts
│   │   ├── handoff/
│   │   │   ├── handoff-manager.ts
│   │   │   └── handoff-types.ts
│   │   └── knowledge/
│   │       ├── knowledge-store.ts
│   │       └── impl/
│   │           └── storage-knowledge.ts
│   │
│   ├── embedding/                       # 可嵌入模块
│   │   ├── api/
│   │   │   ├── rest-api-builder.ts     # 基于 Hono
│   │   │   ├── openapi-generator.ts
│   │   │   └── api-versioning.ts
│   │   ├── rate-limit/
│   │   │   ├── rate-limiter.ts          # 接口
│   │   │   └── impl/
│   │   │       ├── memory-limiter.ts    # rate-limiter-flexible
│   │   │       └── redis-limiter.ts
│   │   ├── api-key/
│   │   │   ├── api-key-manager.ts
│   │   │   └── impl/
│   │   │       └── storage-api-key.ts
│   │   └── sdk/
│   │       └── message-envelope.ts
│   │
│   ├── isolation/                       # 可隔离模块
│   │   ├── runtime/
│   │   │   ├── agent-runtime-backend.ts # 接口
│   │   │   └── impl/
│   │   │       ├── inprocess-runtime.ts # 封装现有 Agent 运行时
│   │   │       ├── docker-runtime.ts    # Phase 2，封装现有 sandbox
│   │   │       └── k8s-runtime.ts       # Phase 3
│   │   ├── network/
│   │   │   ├── network-policy.ts
│   │   │   └── impl/
│   │   │       ├── noop-policy.ts
│   │   │       └── allowlist-policy.ts
│   │   └── resource/
│   │       ├── resource-limiter.ts
│   │       └── impl/
│   │           └── cgroup-limiter.ts
│   │
│   └── reliability/                     # 可靠性模块
│       ├── fsm/
│       │   ├── state-machine.ts         # 泛型 FSM 引擎（自研）
│       │   ├── task-fsm.ts
│       │   └── session-fsm.ts
│       ├── retry/
│       │   ├── retry-policy-registry.ts # 封装现有 retry.ts
│       │   ├── circuit-breaker.ts       # 基于 Cockatiel
│       │   └── retry-metrics.ts
│       ├── checkpoint/
│       │   ├── checkpoint-manager.ts
│       │   └── impl/
│       │       └── storage-checkpoint.ts
│       ├── timeout/
│       │   ├── timeout-manager.ts
│       │   └── cascade-kill.ts
│       ├── health/
│       │   ├── health-aggregator.ts
│       │   └── metrics-provider.ts      # 接口
│       └── dlq/
│           ├── dead-letter-manager.ts
│           └── dlq-alerter.ts
```

### 1.2 现有代码不变原则

```
src/gateway/          # 不修改，仅在 Phase 1 中新增桥接点
src/agents/           # 不修改，仅通过接口适配
src/process/          # 不修改，MemoryQueueBackend 内部引用
src/config/           # 不修改，FileSystemStorageBackend 内部引用
src/infra/            # 不修改，RetryPolicyRegistry 内部引用
src/plugin-sdk/       # 不修改，企业模块通过独立 SPI 扩展
extensions/           # 不修改
```

---

## 二、依赖注入与启动引导

### 2.1 设计理念

OpenClaw 现有代码大量使用函数式依赖注入（`createDefaultDeps` 模式），不使用 IoC 容器。企业模块延续这一模式，使用**工厂函数 + 配置驱动**的依赖组装方式。

### 2.2 企业模块注册中心

```typescript
// src/enterprise/registry.ts

import type { StorageBackend } from "./kernel/storage.ts";
import type { QueueBackend } from "./kernel/queue.ts";
import type { CacheBackend } from "./kernel/cache.ts";
import type { SecretBackend } from "./kernel/secret.ts";
import type { EventBus } from "./kernel/event-bus.ts";
import type { LockBackend } from "./kernel/lock.ts";

/**
 * 企业模块的核心依赖集合。
 * 所有六维模块从此处获取内核后端实例，不直接 import 具体实现。
 */
export interface EnterpriseKernel {
  storage: StorageBackend;
  queue: QueueBackend;
  cache: CacheBackend;
  secret: SecretBackend;
  eventBus: EventBus;
  lock: LockBackend;
}

/**
 * 六维模块的运行时实例集合。
 * Gateway 启动时创建，生命周期与 Gateway 一致。
 */
export interface EnterpriseModules {
  kernel: EnterpriseKernel;
  governance: GovernanceModule | null;
  audit: AuditModule | null;
  collaboration: CollaborationModule | null;
  embedding: EmbeddingModule | null;
  isolation: IsolationModule | null;
  reliability: ReliabilityModule | null;
}
```

### 2.3 启动引导流程

```typescript
// src/enterprise/bootstrap.ts

import type { EnterpriseConfig } from "./config.ts";
import type { EnterpriseKernel, EnterpriseModules } from "./registry.ts";

/**
 * 企业模块启动引导。
 * 在 Gateway 启动流程（server.impl.ts）中调用。
 *
 * 设计原则：
 * - enterprise.enabled = false 时，此函数返回 null，Gateway 行为不变
 * - enterprise.enabled = true 时，按 kernel → modules 顺序初始化
 * - 每个模块的初始化失败不影响其他模块（降级策略）
 */
export async function bootstrapEnterprise(
  config: EnterpriseConfig | undefined,
): Promise<EnterpriseModules | null> {
  if (!config?.enabled) return null;

  // Step 1: 构建内核后端
  const kernel = await buildKernel(config.kernel);

  // Step 2: 初始化所有内核后端
  await Promise.all([
    kernel.storage.initialize(),
    kernel.queue.initialize(),
    kernel.cache.initialize(),
    kernel.secret.initialize(),
    kernel.eventBus.initialize(),
    kernel.lock.initialize(),
  ]);

  // Step 3: 构建六维模块（可选，按配置启用）
  const modules = await buildModules(kernel, config);

  return { kernel, ...modules };
}

/**
 * 企业模块关闭。按创建的逆序执行。
 */
export async function shutdownEnterprise(
  modules: EnterpriseModules,
): Promise<void> {
  // 先关闭六维模块
  // ... 各模块 shutdown

  // 再关闭内核后端
  const { kernel } = modules;
  await Promise.allSettled([
    kernel.lock.shutdown(),
    kernel.eventBus.shutdown(),
    kernel.secret.shutdown(),
    kernel.cache.shutdown(),
    kernel.queue.shutdown(),
    kernel.storage.shutdown(),
  ]);
}
```

### 2.4 内核后端工厂

```typescript
// src/enterprise/kernel-factory.ts

import type { EnterpriseKernelConfig } from "./config.ts";
import type { EnterpriseKernel } from "./registry.ts";

/**
 * 根据配置选择并构建内核后端实现。
 *
 * 策略：
 * - 每个后端先查配置中的 backend 字段
 * - "memory" / "filesystem" 直接同步加载（Phase 0 默认）
 * - "postgres" / "redis" / 自定义包名 使用动态 import（Phase 2 按需加载）
 */
export async function buildKernel(
  config: EnterpriseKernelConfig | undefined,
): Promise<EnterpriseKernel> {
  return {
    storage: await resolveStorageBackend(config?.storage),
    queue: await resolveQueueBackend(config?.queue),
    cache: await resolveCacheBackend(config?.cache),
    secret: await resolveSecretBackend(config?.secret),
    eventBus: await resolveEventBusBackend(config?.eventBus),
    lock: await resolveLockBackend(config?.lock),
  };
}

async function resolveStorageBackend(
  config?: { backend?: string },
): Promise<StorageBackend> {
  const backend = config?.backend ?? "memory";
  switch (backend) {
    case "memory": {
      const { MemoryStorageBackend } = await import(
        "./kernel-impl/memory/storage.ts"
      );
      return new MemoryStorageBackend();
    }
    case "filesystem": {
      const { FileSystemStorageBackend } = await import(
        "./kernel-impl/filesystem/storage.ts"
      );
      return new FileSystemStorageBackend();
    }
    case "postgres": {
      const { PostgresStorageBackend } = await import(
        "./kernel-impl/postgres/storage.ts"
      );
      return new PostgresStorageBackend(config);
    }
    default: {
      // 自定义包名：动态 import 第三方实现
      const mod = await import(backend);
      return mod.createStorageBackend(config);
    }
  }
}

// resolveQueueBackend, resolveCacheBackend 等同理，省略...
```

### 2.5 与现有 Gateway 的集成点

```typescript
// 修改位置：src/gateway/server.impl.ts
// 修改方式：在 createGatewayRuntimeState 函数中，新增可选的 enterprise 初始化

// 伪代码（实际修改以最小侵入为原则）：
export async function createGatewayRuntimeState(opts) {
  // ... 现有初始化逻辑不变 ...

  // 新增：企业模块初始化（仅当配置存在时）
  const enterpriseConfig = opts.config?.enterprise;
  const enterprise = await bootstrapEnterprise(enterpriseConfig);

  return {
    // ... 现有字段不变 ...
    enterprise, // 新增，可能为 null
  };
}
```

---

## 三、Phase 0：内核抽象层实现

> **目标**：定义 6 个内核接口 + 实现 Memory/FileSystem 后端 + 将现有代码迁移到接口调用
> **时间**：4-6 周
> **新增依赖**：无
> **验收标准**：全量测试通过，零行为变更，性能基准持平

### 3.1 TenantContext 类型定义

```typescript
// src/enterprise/kernel/tenant-context.ts

/**
 * 贯穿所有企业级操作的租户上下文。
 *
 * 设计要点：
 * - 个人版场景：tenantId = "default"，userId/agentId 可选
 * - 企业版场景：由 tenant-middleware 从认证结果中注入
 * - requestId 用于链路追踪和审计关联
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly requestId: string;
  readonly source: TenantContextSource;
}

export type TenantContextSource = "api" | "channel" | "cron" | "internal";

/**
 * 个人版默认上下文。
 * 当 enterprise.enabled = false 时，所有操作使用此上下文。
 */
export function createDefaultTenantContext(
  requestId?: string,
): TenantContext {
  return {
    tenantId: "default",
    requestId: requestId ?? crypto.randomUUID(),
    source: "internal",
  };
}
```

### 3.2 StorageBackend 接口与实现

#### 3.2.1 接口定义

```typescript
// src/enterprise/kernel/storage.ts

import type { TenantContext } from "./tenant-context.ts";
import type { HealthStatus } from "./health.ts";

export interface StorageBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;

  get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null>;
  set<T>(ctx: TenantContext, collection: string, key: string, value: T): Promise<void>;
  delete(ctx: TenantContext, collection: string, key: string): Promise<boolean>;
  list<T>(ctx: TenantContext, collection: string, query: StorageQuery): Promise<PaginatedResult<T>>;

  atomicUpdate<T>(
    ctx: TenantContext,
    collection: string,
    key: string,
    updater: (current: T | null) => T,
  ): Promise<T>;

  batchGet<T>(ctx: TenantContext, collection: string, keys: string[]): Promise<Map<string, T>>;
  batchSet<T>(ctx: TenantContext, collection: string, entries: Array<{ key: string; value: T }>): Promise<void>;

  transaction?<T>(ctx: TenantContext, fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;
}

export interface StorageQuery {
  prefix?: string;
  filter?: Record<string, unknown>;
  orderBy?: string;
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface StorageTransaction {
  get<T>(collection: string, key: string): Promise<T | null>;
  set<T>(collection: string, key: string, value: T): Promise<void>;
  delete(collection: string, key: string): Promise<boolean>;
}
```

#### 3.2.2 MemoryStorageBackend

```typescript
// src/enterprise/kernel-impl/memory/storage.ts

import type { StorageBackend, StorageQuery, PaginatedResult, StorageTransaction } from "../../kernel/storage.ts";
import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { HealthStatus } from "../../kernel/health.ts";

/**
 * 内存存储后端。
 *
 * 数据结构：Map<compositeKey, value>
 * compositeKey = `${tenantId}:${collection}:${key}`
 *
 * 适用场景：开发、测试、单进程个人版
 * 特性：支持 atomicUpdate（同步互斥）、不支持 transaction（声明能力为 false）
 */
export class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, unknown>();

  async initialize(): Promise<void> { /* no-op */ }
  async shutdown(): Promise<void> { this.store.clear(); }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0 };
  }

  async get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null> {
    const ck = this.compositeKey(ctx.tenantId, collection, key);
    return (this.store.get(ck) as T) ?? null;
  }

  async set<T>(ctx: TenantContext, collection: string, key: string, value: T): Promise<void> {
    const ck = this.compositeKey(ctx.tenantId, collection, key);
    this.store.set(ck, value);
  }

  async delete(ctx: TenantContext, collection: string, key: string): Promise<boolean> {
    const ck = this.compositeKey(ctx.tenantId, collection, key);
    return this.store.delete(ck);
  }

  async list<T>(ctx: TenantContext, collection: string, query: StorageQuery): Promise<PaginatedResult<T>> {
    const prefix = `${ctx.tenantId}:${collection}:`;
    const queryPrefix = query.prefix ? `${prefix}${query.prefix}` : prefix;

    const items: T[] = [];
    for (const [k, v] of this.store) {
      if (k.startsWith(queryPrefix)) {
        items.push(v as T);
      }
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    const sliced = items.slice(offset, offset + limit);

    return {
      items: sliced,
      total: items.length,
      hasMore: offset + limit < items.length,
    };
  }

  async atomicUpdate<T>(
    ctx: TenantContext,
    collection: string,
    key: string,
    updater: (current: T | null) => T,
  ): Promise<T> {
    const current = await this.get<T>(ctx, collection, key);
    const updated = updater(current);
    await this.set(ctx, collection, key, updated);
    return updated;
  }

  async batchGet<T>(ctx: TenantContext, collection: string, keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const val = await this.get<T>(ctx, collection, key);
      if (val !== null) result.set(key, val);
    }
    return result;
  }

  async batchSet<T>(
    ctx: TenantContext,
    collection: string,
    entries: Array<{ key: string; value: T }>,
  ): Promise<void> {
    for (const { key, value } of entries) {
      await this.set(ctx, collection, key, value);
    }
  }

  // transaction 未实现，声明为不支持
  transaction = undefined;

  private compositeKey(tenantId: string, collection: string, key: string): string {
    return `${tenantId}:${collection}:${key}`;
  }
}
```

#### 3.2.3 FileSystemStorageBackend（桥接现有代码）

```typescript
// src/enterprise/kernel-impl/filesystem/storage.ts

/**
 * 文件系统存储后端。
 *
 * 桥接策略（不修改现有文件）：
 * - collection = "sessions" → 委托给现有 loadSessionStore / updateSessionStoreEntry
 * - collection = "config" → 委托给现有 loadConfig / writeConfigFile
 * - collection = "credentials" → 委托给现有 credentials 目录读写
 * - 其他 collection → 使用通用 JSON 文件存储（~/.openclaw/enterprise/{tenantId}/{collection}/{key}.json）
 *
 * 这样做的好处：
 * 1. 现有代码路径不变，个人版用户零影响
 * 2. 新的 enterprise collection 自动获得文件持久化
 * 3. 迁移到 PG 后端时，只需切换 backend 配置
 */
export class FileSystemStorageBackend implements StorageBackend {
  private adapters: Map<string, CollectionAdapter>;

  constructor(private basePath?: string) {
    this.adapters = new Map();
  }

  async initialize(): Promise<void> {
    // 注册内置集合适配器
    this.adapters.set("sessions", new SessionCollectionAdapter());
    this.adapters.set("config", new ConfigCollectionAdapter());
    // 通用适配器作为 fallback
  }

  async get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null> {
    const adapter = this.adapters.get(collection);
    if (adapter) return adapter.get(ctx, key);
    return this.genericFileGet(ctx, collection, key);
  }

  // ... 其他方法类似：委托到 adapter 或通用文件操作
}

/**
 * Session 集合适配器：桥接到现有 sessions/store.ts
 */
class SessionCollectionAdapter implements CollectionAdapter {
  async get<T>(ctx: TenantContext, key: string): Promise<T | null> {
    // 内部调用现有 loadSessionStore + 按 key 查找
    // 不修改现有函数签名，只做包装调用
  }
  // ...
}
```

### 3.3 QueueBackend 接口与实现

#### 3.3.1 接口定义

```typescript
// src/enterprise/kernel/queue.ts
// 完全遵循 PRD 第 4.2 节定义，此处省略重复内容
```

#### 3.3.2 MemoryQueueBackend（桥接现有 command-queue）

```typescript
// src/enterprise/kernel-impl/memory/queue.ts

/**
 * 内存队列后端。
 *
 * 桥接策略：
 * - 内部使用与现有 command-queue.ts 相同的 lane-aware FIFO 逻辑
 * - 新增 PRD 要求的能力：优先级、延迟队列、DLQ、幂等去重
 * - 不修改现有 command-queue.ts，而是在此实现新版本
 *
 * 设计：
 * - 每个 queue name 对应一个内部 lane
 * - 优先级通过 3 个子队列实现（high/normal/low）
 * - 延迟消息通过 setTimeout 调度
 * - DLQ 是一个独立的内存数组
 * - 幂等 key 通过 TTL Map 去重
 */
export class MemoryQueueBackend implements QueueBackend {
  private queues = new Map<string, PriorityQueue>();
  private dlqs = new Map<string, QueueMessage[]>();
  private dedupeCache = new Map<string, number>(); // key → expireAt timestamp
  private subscriptions = new Map<string, Set<QueueHandler>>();

  async initialize(): Promise<void> { /* no-op */ }

  async shutdown(): Promise<void> {
    // 取消所有 setTimeout、清空队列
    this.queues.clear();
    this.dlqs.clear();
    this.dedupeCache.clear();
    for (const subs of this.subscriptions.values()) subs.clear();
  }

  async enqueue(
    ctx: TenantContext,
    queue: string,
    message: QueueMessage,
    options?: EnqueueOptions,
  ): Promise<string> {
    // 幂等检查
    if (options?.idempotencyKey) {
      const existing = this.dedupeCache.get(options.idempotencyKey);
      if (existing && existing > Date.now()) {
        return message.id; // 已存在，跳过
      }
      this.dedupeCache.set(
        options.idempotencyKey,
        Date.now() + (options.ttl ?? 300_000),
      );
    }

    // 延迟队列
    if (options?.delay && options.delay > 0) {
      setTimeout(() => this.doEnqueue(queue, message), options.delay);
      return message.id;
    }

    this.doEnqueue(queue, message);
    return message.id;
  }

  subscribe(
    queue: string,
    handler: QueueHandler,
    _options?: SubscribeOptions,
  ): QueueSubscription {
    if (!this.subscriptions.has(queue)) {
      this.subscriptions.set(queue, new Set());
    }
    this.subscriptions.get(queue)!.add(handler);

    return {
      unsubscribe: async () => {
        this.subscriptions.get(queue)?.delete(handler);
      },
    };
  }

  private doEnqueue(queue: string, message: QueueMessage): void {
    if (!this.queues.has(queue)) {
      this.queues.set(queue, new PriorityQueue());
    }
    this.queues.get(queue)!.push(message);

    // 通知订阅者
    const subs = this.subscriptions.get(queue);
    if (subs) {
      for (const handler of subs) {
        handler(message).catch(() => {
          // nack: 根据 maxAttempts 判断重试或进 DLQ
          this.handleNack(queue, message);
        });
      }
    }
  }

  private handleNack(queue: string, message: QueueMessage): void {
    message.attempts += 1;
    if (message.attempts >= message.maxAttempts) {
      // 进入 DLQ
      if (!this.dlqs.has(queue)) this.dlqs.set(queue, []);
      this.dlqs.get(queue)!.push(message);
    } else {
      // 重新入队
      this.doEnqueue(queue, message);
    }
  }

  // ... ack, nack, dequeue, getQueueDepth, purge, DLQ 方法
}

class PriorityQueue {
  private high: QueueMessage[] = [];
  private normal: QueueMessage[] = [];
  private low: QueueMessage[] = [];

  push(msg: QueueMessage): void {
    const q = msg.priority === "high" ? this.high
      : msg.priority === "low" ? this.low
      : this.normal;
    q.push(msg);
  }

  shift(): QueueMessage | undefined {
    return this.high.shift() ?? this.normal.shift() ?? this.low.shift();
  }

  get size(): number {
    return this.high.length + this.normal.length + this.low.length;
  }
}
```

### 3.4 CacheBackend 接口与实现

```typescript
// src/enterprise/kernel-impl/memory/cache.ts

/**
 * 内存缓存后端。
 *
 * 实现 TTL 过期：每次 get 时惰性检查过期，
 * 加周期性清理（每 60s 扫描一次过期条目）。
 */
export class MemoryCacheBackend implements CacheBackend {
  private store = new Map<string, { value: unknown; expiresAt: number | null }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<void> {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.store.clear();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }

  async increment(key: string, delta = 1, ttlMs?: number): Promise<number> {
    const current = ((await this.get<number>(key)) ?? 0) + delta;
    await this.set(key, current, ttlMs);
    return current;
  }

  async setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
    if (await this.get(key) !== null) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  // delete, has 省略...

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }
}
```

### 3.5 EventBus 接口与实现

```typescript
// src/enterprise/kernel-impl/memory/event-bus.ts

import EventEmitter from "eventemitter3"; // Phase 0 唯一候选引入，或用 Node 内建

/**
 * 进程内事件总线。
 *
 * 模式匹配规则：
 * - "audit.*" 匹配 "audit.login.success"
 * - "task.state.changed" 精确匹配
 * - "*" 匹配所有事件
 *
 * 实现：用简单的 glob 前缀匹配，不引入完整 glob 库
 */
export class InProcessEventBus implements EventBus {
  private emitter = new EventEmitter();
  private patternHandlers = new Map<string, Set<{ pattern: string; handler: EventHandler }>>();

  async initialize(): Promise<void> { /* no-op */ }
  async shutdown(): Promise<void> {
    this.emitter.removeAllListeners();
    this.patternHandlers.clear();
  }

  async publish(event: PlatformEvent): Promise<void> {
    // 精确匹配
    this.emitter.emit(event.type, event);

    // 模式匹配（前缀通配）
    for (const [_id, handlers] of this.patternHandlers) {
      for (const { pattern, handler } of handlers) {
        if (this.matchPattern(pattern, event.type)) {
          // 异步执行，不阻塞发布者
          handler(event).catch((err) => {
            console.error(`EventBus handler error for ${pattern}:`, err);
          });
        }
      }
    }
  }

  async publishBatch(events: PlatformEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  subscribe(pattern: string, handler: EventHandler): EventSubscription {
    const entry = { pattern, handler };
    const id = crypto.randomUUID();
    if (!this.patternHandlers.has(id)) {
      this.patternHandlers.set(id, new Set());
    }
    this.patternHandlers.get(id)!.add(entry);

    return {
      unsubscribe: () => {
        this.patternHandlers.get(id)?.delete(entry);
      },
    };
  }

  async once(pattern: string, timeoutMs: number): Promise<PlatformEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`EventBus.once timeout after ${timeoutMs}ms for pattern: ${pattern}`));
      }, timeoutMs);

      const sub = this.subscribe(pattern, async (event) => {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(event);
      });
    });
  }

  private matchPattern(pattern: string, eventType: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return eventType.startsWith(prefix + ".");
    }
    return pattern === eventType;
  }
}
```

### 3.6 LockBackend 接口与实现

```typescript
// src/enterprise/kernel-impl/memory/lock.ts

/**
 * 进程内锁后端。
 *
 * 桥接策略：
 * - 封装与现有 session-write-lock.ts 相同的逻辑模式
 * - 内存 Map 实现互斥，单进程内安全
 * - 领导选举在单进程中退化为"总是 leader"
 */
export class InProcessLockBackend implements LockBackend {
  private locks = new Map<string, { token: string; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<void> {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 5_000);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.locks.clear();
  }

  async acquire(key: string, options: LockOptions): Promise<LockHandle | null> {
    const now = Date.now();
    const deadline = now + (options.waitMs ?? 0);

    while (true) {
      const existing = this.locks.get(key);
      if (!existing || existing.expiresAt < now) {
        const token = crypto.randomUUID();
        const expiresAt = now + options.ttlMs;
        this.locks.set(key, { token, expiresAt });
        return { key, token, expiresAt: new Date(expiresAt) };
      }

      if (Date.now() >= deadline) return null;

      // 等待重试
      await new Promise((r) => setTimeout(r, options.retryIntervalMs ?? 50));
    }
  }

  async release(handle: LockHandle): Promise<void> {
    const existing = this.locks.get(handle.key);
    if (existing?.token === handle.token) {
      this.locks.delete(handle.key);
    }
  }

  async extend(handle: LockHandle, extensionMs: number): Promise<boolean> {
    const existing = this.locks.get(handle.key);
    if (existing?.token !== handle.token) return false;
    existing.expiresAt = Date.now() + extensionMs;
    return true;
  }

  electLeader(
    _group: string,
    candidateId: string,
    _options: LeaderElectionOptions,
  ): LeaderElection {
    // 单进程：总是 leader
    return {
      isLeader: () => true,
      onElected: (handler) => handler(),
      onDeposed: () => {},
      resign: async () => {},
    };
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks) {
      if (lock.expiresAt < now) this.locks.delete(key);
    }
  }
}
```

### 3.7 SecretBackend 接口与实现

```typescript
// src/enterprise/kernel-impl/memory/secret.ts

/**
 * 内存密钥后端（开发/测试用）。
 */
export class MemorySecretBackend implements SecretBackend {
  private secrets = new Map<string, string>();

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> { this.secrets.clear(); }

  async getSecret(_ctx: TenantContext, path: string): Promise<string | null> {
    return this.secrets.get(path) ?? null;
  }

  async setSecret(_ctx: TenantContext, path: string, value: string): Promise<void> {
    this.secrets.set(path, value);
  }

  async deleteSecret(_ctx: TenantContext, path: string): Promise<boolean> {
    return this.secrets.delete(path);
  }
}
```

```typescript
// src/enterprise/kernel-impl/filesystem/secret.ts

/**
 * 文件系统密钥后端。
 * 桥接现有 SecretRef（env/file/exec）机制。
 *
 * 路径映射：
 * - "env:OPENAI_API_KEY" → process.env.OPENAI_API_KEY
 * - "file:/path/to/secret" → 文件内容
 * - "exec:some-command" → 命令输出
 * - 纯字符串路径 → 从 ~/.openclaw/credentials/ 读取
 */
export class SecretRefBackend implements SecretBackend {
  // 内部调用现有 resolveSecretRefValues 逻辑
  // 不修改现有文件，仅做包装
}
```

### 3.8 Phase 0 迁移点清单

以下列出 Phase 0 中需要创建"桥接适配器"的现有代码位置。**每个桥接都是在企业模块内部调用现有函数，不修改现有函数本身**。

| 现有代码 | 企业版桥接 | 桥接方式 |
|----------|------------|----------|
| `src/config/sessions/store.ts` → `loadSessionStore` | `FileSystemStorageBackend.get("sessions", key)` | 内部调用 `loadSessionStore` 后按 key 过滤 |
| `src/config/sessions/store.ts` → `updateSessionStoreEntry` | `FileSystemStorageBackend.set("sessions", key, val)` | 内部调用 `updateSessionStoreEntry` |
| `src/config/io.ts` → `loadConfig` | `FileSystemStorageBackend.get("config", key)` | 内部调用 `loadConfig` |
| `src/process/command-queue.ts` → `enqueueCommand` | `MemoryQueueBackend.enqueue` | 复用相同的 lane-aware FIFO 逻辑，新增优先级/DLQ |
| `src/agents/session-write-lock.ts` | `InProcessLockBackend.acquire` | 内存锁，与文件锁语义一致 |
| `src/config/types.secrets.ts` → `SecretRef` | `SecretRefBackend.getSecret` | 内部调用 `resolveSecretRefValues` |
| `src/infra/outbound/delivery-queue.ts` | `FileSystemQueueBackend.enqueue` | 保留磁盘持久化语义 |
| 散落的 EventEmitter 使用 | `InProcessEventBus.subscribe` | 新的企业事件走 EventBus |

---

## 四、Phase 1：六维架构模块骨架

> **目标**：定义所有六维模块接口 + 实现兼容性参考实现 + 引入中间件链
> **时间**：4-6 周
> **新增依赖**：`hono`（已在 deps 中）、`@casl/ability`、`eventemitter3`、`cockatiel`
> **验收标准**：所有现有测试通过，企业接口可被外部 implements

### 4.1 中间件链实现

**关键发现**：`hono` 已在项目的 dependencies 中。利用 Hono 的中间件模型实现 PRD 的中间件链。

```typescript
// src/enterprise/governance/middleware/chain.ts

import { Hono } from "hono";
import type { EnterpriseKernel, EnterpriseModules } from "../../registry.ts";
import type { TenantContext } from "../../kernel/tenant-context.ts";

/**
 * 企业中间件链。
 *
 * 挂载到现有 Gateway 的 HTTP 路由上，处理企业 REST API 请求。
 * 现有 WebSocket RPC 路径不受影响（保持原有 auth 逻辑）。
 *
 * 链路：AuthN → TenantContext → AuthZ → RateLimit → [Handler] → ContentFilter → Audit
 */
export function createEnterpriseMiddlewareChain(
  modules: EnterpriseModules,
): Hono {
  const app = new Hono();

  // 1. 认证中间件
  app.use("*", createAuthnMiddleware(modules));

  // 2. 租户上下文注入
  app.use("*", createTenantMiddleware(modules));

  // 3. 授权中间件
  app.use("*", createAuthzMiddleware(modules));

  // 4. 限流中间件
  app.use("*", createRateLimitMiddleware(modules));

  // 5. 审计中间件（响应后触发，不阻塞）
  app.use("*", createAuditMiddleware(modules));

  return app;
}
```

#### 4.1.1 认证中间件

```typescript
// src/enterprise/governance/middleware/authn-middleware.ts

import type { MiddlewareHandler } from "hono";

/**
 * 认证中间件。
 *
 * 行为：
 * - 从请求头/Cookie/Query 中提取凭证
 * - 委托给配置的 IdentityProvider.authenticate()
 * - 认证成功：将 UserIdentity 存入 Hono context
 * - 认证失败：返回 401
 * - 未配置企业认证时：使用 TokenIdentityProvider（兼容现有 token/password 认证）
 */
export function createAuthnMiddleware(
  modules: EnterpriseModules,
): MiddlewareHandler {
  return async (c, next) => {
    const provider = modules.governance?.identityProvider;

    if (!provider) {
      // 未配置企业认证，透传（兼容模式）
      c.set("tenantContext", createDefaultTenantContext(c.req.header("x-request-id")));
      return next();
    }

    const result = await provider.authenticate({
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      clientIp: c.req.header("x-forwarded-for") ?? "unknown",
      method: c.req.method,
      path: c.req.path,
    });

    if (!result.authenticated || !result.identity) {
      return c.json({ error: result.error ?? "Unauthorized" }, 401);
    }

    c.set("identity", result.identity);
    return next();
  };
}
```

#### 4.1.2 审计中间件

```typescript
// src/enterprise/audit/audit-middleware.ts

import type { MiddlewareHandler } from "hono";

/**
 * 审计中间件。不可绕过。
 *
 * 在响应发出后异步记录审计事件，不阻塞业务请求。
 * 使用 Hono 的 after-response hook。
 */
export function createAuditMiddleware(
  modules: EnterpriseModules,
): MiddlewareHandler {
  return async (c, next) => {
    const startTime = Date.now();
    const requestId = c.get("tenantContext")?.requestId ?? crypto.randomUUID();

    await next();

    // 响应后异步审计（不 await，不阻塞）
    const pipeline = modules.audit?.pipeline;
    if (pipeline) {
      const event: AuditEvent = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        version: "1.0",
        tenantId: c.get("tenantContext")?.tenantId ?? "default",
        actor: {
          type: c.get("identity") ? "user" : "api_key",
          id: c.get("identity")?.userId ?? "anonymous",
          ip: c.req.header("x-forwarded-for"),
          userAgent: c.req.header("user-agent"),
        },
        action: `${c.req.method.toLowerCase()}.${c.req.path}`,
        category: "data_access",
        outcome: c.res.status < 400 ? "success" : "failure",
        resource: {
          type: "api",
          tenantId: c.get("tenantContext")?.tenantId ?? "default",
        },
        source: {
          service: "gateway",
          requestId,
        },
        duration: Date.now() - startTime,
      };

      // 非阻塞发射
      pipeline.emit(event);
    }
  };
}
```

### 4.2 AuditPipeline 实现

```typescript
// src/enterprise/audit/audit-pipeline.ts

/**
 * 审计管道引擎。
 *
 * 设计：
 * - 内部维护异步缓冲队列（最大 1000 条）
 * - 每 100ms 或缓冲满时批量写入所有 Sink
 * - Sink 写入失败时：重试 3 次，极端情况降级到 stderr
 * - 多个 Sink 并行写入
 */
export class AuditPipelineEngine implements AuditPipeline {
  private sinks: AuditSink[] = [];
  private buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxBufferSize = 1000;
  private readonly flushIntervalMs = 100;

  registerSink(sink: AuditSink): void {
    this.sinks.push(sink);
  }

  start(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  emit(event: AuditEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  async query(ctx: TenantContext, query: AuditQuery): Promise<PaginatedResult<AuditEvent>> {
    const queryableSink = this.sinks.find((s) => s.capabilities().queryable);
    if (!queryableSink) {
      throw new Error("No queryable audit sink configured");
    }
    // 委托给可查询的 Sink
    return (queryableSink as QueryableAuditSink).query(ctx, query);
  }

  getMetrics(): AuditMetrics {
    return {
      bufferedEvents: this.buffer.length,
      totalEmitted: this.totalEmitted,
      sinkCount: this.sinks.length,
    };
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);

    await Promise.allSettled(
      this.sinks.map((sink) =>
        sink.writeBatch(batch).catch((err) => {
          // 重试逻辑
          console.error(`Audit sink ${sink.name} write failed:`, err);
          // 降级：写入 stderr
          for (const event of batch) {
            process.stderr.write(JSON.stringify(event) + "\n");
          }
        }),
      ),
    );
  }

  private totalEmitted = 0;
}
```

### 4.3 可治理模块 — IdentityProvider 兼容实现

```typescript
// src/enterprise/governance/identity/impl/token-provider.ts

/**
 * Token/Password 身份提供者。
 * 封装现有 auth.ts 的 authorizeGatewayConnect 逻辑。
 *
 * 这是 Phase 0-1 的默认实现，保证在不配置 OIDC 时，
 * 认证行为与升级前完全一致。
 */
export class TokenIdentityProvider implements IdentityProvider {
  readonly type = "token";

  constructor(
    private authConfig: ResolvedGatewayAuth,
  ) {}

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async authenticate(request: AuthRequest): Promise<AuthResult> {
    // 从 request.headers 中提取 token/password
    const authHeader = request.headers["authorization"];
    const token = authHeader?.replace("Bearer ", "");

    // 委托给现有 authorizeGatewayConnect 的核心逻辑
    // 不直接调用（它需要 WS 上下文），而是复用相同的比较逻辑
    if (this.authConfig.mode === "none") {
      return {
        authenticated: true,
        identity: this.defaultIdentity(),
      };
    }

    if (this.authConfig.mode === "token" && token === this.authConfig.token) {
      return {
        authenticated: true,
        identity: this.defaultIdentity(),
      };
    }

    return { authenticated: false, error: "Invalid token" };
  }

  private defaultIdentity(): UserIdentity {
    return {
      userId: "owner",
      tenantId: "default",
      roles: ["admin"],
      groups: [],
    };
  }
}
```

### 4.4 可治理模块 — PolicyEngine 兼容实现

```typescript
// src/enterprise/governance/authorization/impl/scope-policy.ts

/**
 * Scope 策略引擎。
 * 封装现有 method-scopes.ts 的逻辑。
 *
 * 在 Phase 1 中，这是默认实现。
 * Phase 2 引入 CASL 后，RbacPolicyEngine 会取代此实现。
 */
export class ScopePolicyEngine implements PolicyEngine {
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async authorize(request: AuthzRequest): Promise<AuthzDecision> {
    // 如果是 admin 角色，允许所有操作
    if (request.subject.roles.includes("admin")) {
      return { allowed: true };
    }

    // 对于非 admin，使用现有 scope 检查逻辑
    // method-scopes 定义了每个 Gateway 方法所需的 scope
    // 此处做映射：action → scope → 检查 subject.roles 是否包含该 scope
    return { allowed: false, reason: "Insufficient scope" };
  }

  async batchAuthorize(requests: AuthzRequest[]): Promise<AuthzDecision[]> {
    return Promise.all(requests.map((r) => this.authorize(r)));
  }

  async loadPolicies(): Promise<void> {
    // Scope 策略是静态的，不支持动态加载
  }
}
```

### 4.5 可靠性模块 — 泛型 FSM 引擎（自研）

```typescript
// src/enterprise/reliability/fsm/state-machine.ts

/**
 * 泛型有限状态机引擎。
 *
 * 设计原则：
 * - 编译期类型安全：状态和事件都是泛型参数
 * - 严格拒绝非法转换（抛出 IllegalStateTransitionError）
 * - 支持 guard（条件守卫）和 action（异步副作用）
 * - 支持序列化/反序列化（用于持久化到 StorageBackend）
 * - 约 150 行实现，不引入外部依赖
 */

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly event: string,
    public readonly availableTransitions: string[],
  ) {
    super(
      `Illegal state transition: cannot handle event "${event}" in state "${from}". ` +
      `Available events: [${availableTransitions.join(", ")}]`,
    );
    this.name = "IllegalStateTransitionError";
  }
}

export interface StateMachineDefinition<S extends string, E extends string> {
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

export interface StateMachineSnapshot<S extends string> {
  currentState: S;
  history: Array<{ from: S; to: S; event: string; timestamp: string }>;
}

export class StateMachine<S extends string, E extends string> {
  private _currentState: S;
  private _history: Array<{ from: S; to: S; event: E; timestamp: Date }> = [];

  constructor(private definition: StateMachineDefinition<S, E>, snapshot?: StateMachineSnapshot<S>) {
    this._currentState = snapshot?.currentState ?? definition.initialState;
    if (snapshot?.history) {
      this._history = snapshot.history.map((h) => ({
        ...h,
        event: h.event as E,
        timestamp: new Date(h.timestamp),
      }));
    }
  }

  get currentState(): S {
    return this._currentState;
  }

  get history(): ReadonlyArray<{ from: S; to: S; event: E; timestamp: Date }> {
    return this._history;
  }

  async transition(event: E, context?: unknown): Promise<S> {
    const candidates = this.definition.transitions.filter((t) => {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      return fromStates.includes(this._currentState) && t.event === event;
    });

    if (candidates.length === 0) {
      const available = this.definition.transitions
        .filter((t) => {
          const fromStates = Array.isArray(t.from) ? t.from : [t.from];
          return fromStates.includes(this._currentState);
        })
        .map((t) => t.event);

      throw new IllegalStateTransitionError(this._currentState, event, [...new Set(available)]);
    }

    // 评估 guard
    const transition = candidates.find((t) => !t.guard || t.guard(context));
    if (!transition) {
      throw new IllegalStateTransitionError(
        this._currentState,
        event,
        candidates.map((t) => `${t.event}(guarded)`),
      );
    }

    const from = this._currentState;
    this._currentState = transition.to;
    this._history.push({ from, to: transition.to, event, timestamp: new Date() });

    // 执行副作用
    if (transition.action) {
      await transition.action(context);
    }

    return this._currentState;
  }

  canTransition(event: E): boolean {
    return this.definition.transitions.some((t) => {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      return fromStates.includes(this._currentState) && t.event === event;
    });
  }

  isTerminal(): boolean {
    return this.definition.terminalStates.includes(this._currentState);
  }

  serialize(): StateMachineSnapshot<S> {
    return {
      currentState: this._currentState,
      history: this._history.map((h) => ({
        from: h.from,
        to: h.to,
        event: h.event,
        timestamp: h.timestamp.toISOString(),
      })),
    };
  }

  static restore<S extends string, E extends string>(
    snapshot: StateMachineSnapshot<S>,
    definition: StateMachineDefinition<S, E>,
  ): StateMachine<S, E> {
    return new StateMachine(definition, snapshot);
  }
}
```

### 4.6 Task FSM 定义

```typescript
// src/enterprise/reliability/fsm/task-fsm.ts

import { StateMachine, type StateMachineDefinition } from "./state-machine.ts";

export type TaskState =
  | "pending" | "queued" | "running" | "paused"
  | "completed" | "failed" | "killed" | "timeout";

export type TaskEvent =
  | "enqueue" | "start" | "complete" | "fail" | "pause"
  | "resume" | "kill" | "timeout_trigger" | "retry";

export const TASK_FSM_DEFINITION: StateMachineDefinition<TaskState, TaskEvent> = {
  initialState: "pending",
  terminalStates: ["completed", "killed"],
  transitions: [
    { from: "pending",   event: "enqueue",          to: "queued" },
    { from: "pending",   event: "kill",             to: "killed" },
    { from: "queued",    event: "start",            to: "running" },
    { from: "queued",    event: "kill",             to: "killed" },
    { from: "running",   event: "complete",         to: "completed" },
    { from: "running",   event: "fail",             to: "failed" },
    { from: "running",   event: "pause",            to: "paused" },
    { from: "running",   event: "kill",             to: "killed" },
    { from: "running",   event: "timeout_trigger",  to: "timeout" },
    { from: "paused",    event: "resume",           to: "running" },
    { from: "paused",    event: "kill",             to: "killed" },
    { from: "failed",    event: "retry",            to: "queued" },
    { from: "timeout",   event: "retry",            to: "queued" },
  ],
};

export function createTaskFSM(snapshot?: StateMachineSnapshot<TaskState>): StateMachine<TaskState, TaskEvent> {
  return new StateMachine(TASK_FSM_DEFINITION, snapshot);
}
```

### 4.7 可靠性模块 — CircuitBreaker（基于 Cockatiel）

```typescript
// src/enterprise/reliability/retry/circuit-breaker.ts

import {
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  handleAll,
  wrap,
  retry,
  timeout,
  type Policy,
} from "cockatiel";

/**
 * 熔断器工厂。
 * 封装 Cockatiel，提供与 PRD CircuitBreaker 接口一致的 API。
 *
 * Cockatiel 自带 retry + circuit breaker + timeout 策略组合，
 * 正好匹配 PRD 的"重试 + 超时 + 熔断链"。
 */
export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const breaker = new ConsecutiveBreaker(options.failureThreshold);

  const circuitPolicy = new CircuitBreakerPolicy(
    handleAll,
    breaker,
    options.resetTimeoutMs,
    options.halfOpenMaxAttempts,
  );

  return {
    name: options.name ?? "default",
    get state() {
      return circuitPolicy.state as "closed" | "open" | "half-open";
    },
    execute: <T>(fn: () => Promise<T>) => circuitPolicy.execute(fn),
    reset: () => circuitPolicy.dispose(),
    trip: () => { /* Cockatiel 不直接支持手动 trip，需自行记录 */ },
    getMetrics: () => ({
      state: circuitPolicy.state as "closed" | "open" | "half-open",
      totalRequests: 0, // 需要自行统计
      successCount: 0,
      failureCount: 0,
    }),
  };
}

/**
 * 创建组合策略：retry → timeout → circuit breaker
 * PRD 要求的"重试 + 超时 + 熔断链"
 */
export function createResiliencePolicy(options: {
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  timeoutMs?: number;
  circuitBreaker?: CircuitBreakerOptions;
}): Policy {
  const policies: Policy[] = [];

  if (options.circuitBreaker) {
    policies.push(
      new CircuitBreakerPolicy(
        handleAll,
        new ConsecutiveBreaker(options.circuitBreaker.failureThreshold),
        options.circuitBreaker.resetTimeoutMs,
      ),
    );
  }

  if (options.timeoutMs) {
    policies.push(timeout(options.timeoutMs));
  }

  if (options.retryAttempts) {
    policies.push(
      retry(handleAll, {
        maxAttempts: options.retryAttempts,
        backoff: { type: "exponential", initial: options.retryBaseDelayMs ?? 500 },
      }),
    );
  }

  return wrap(...policies);
}
```

### 4.8 与现有 Gateway 的集成（Phase 1 桥接点）

```typescript
// 修改位置：src/gateway/server-http.ts
// 新增：在现有 HTTP 路由中挂载企业 REST API

// 伪代码（最小侵入修改）：
export function createGatewayHttpServer(state: GatewayRuntimeState) {
  const server = http.createServer(async (req, res) => {
    // 现有路由逻辑不变...

    // 新增：企业 REST API 路由（/api/v1/*）
    if (state.enterprise && req.url?.startsWith("/api/v1/")) {
      const enterpriseApp = state.enterprise.embedding?.restApi;
      if (enterpriseApp) {
        return enterpriseApp.fetch(
          new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: Object.fromEntries(
              Object.entries(req.headers).filter(([_, v]) => v != null) as [string, string][],
            ),
          }),
        ).then((response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          response.body?.pipeTo(new WritableStream({
            write(chunk) { res.write(chunk); },
            close() { res.end(); },
          }));
        });
      }
    }
  });

  return server;
}
```

---

## 五、Phase 2：企业参考实现

> **目标**：PG/Redis 后端 + OIDC + RBAC + Docker Runtime + REST API Builder + Metrics
> **时间**：8-10 周
> **新增依赖**：`kysely`、`pg`（Kysely PG 方言）、`bullmq`、`ioredis`、`openid-client`、`rate-limiter-flexible`、`prom-client`、`redlock-universal`、`dockerode`

### 5.1 PostgreSQL 存储后端

```typescript
// src/enterprise/kernel-impl/postgres/connection.ts

import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

/**
 * Kysely 连接管理。
 *
 * 设计：
 * - 单例连接池，由 PostgresStorageBackend.initialize() 创建
 * - 连接池参数从配置读取（min/max/idle timeout）
 * - 支持 RLS（Row-Level Security）：每次查询前执行 SET LOCAL openclaw.tenant_id
 */
export function createKyselyInstance(config: PostgresConnectionConfig): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: config.connectionString,
        min: config.pool?.min ?? 2,
        max: config.pool?.max ?? 10,
        idleTimeoutMillis: config.pool?.idleTimeoutMs ?? 30_000,
      }),
    }),
  });
}

/**
 * 数据库 Schema 类型定义。
 * Kysely 使用此类型提供编译期列名/表名检查。
 */
export interface DatabaseSchema {
  enterprise_kv: {
    tenant_id: string;
    collection: string;
    key: string;
    value: string; // JSONB 序列化后的字符串
    created_at: Date;
    updated_at: Date;
  };
  enterprise_queue: {
    id: string;
    tenant_id: string;
    queue: string;
    type: string;
    payload: string;
    priority: string;
    state: string;
    attempts: number;
    max_attempts: number;
    scheduled_at: Date | null;
    created_at: Date;
  };
  enterprise_audit: {
    id: string;
    tenant_id: string;
    timestamp: Date;
    actor_type: string;
    actor_id: string;
    action: string;
    category: string;
    outcome: string;
    resource_type: string;
    resource_id: string | null;
    details: string | null;
    duration: number | null;
  };
}
```

```typescript
// src/enterprise/kernel-impl/postgres/storage.ts

/**
 * PostgreSQL 存储后端。
 *
 * 租户隔离策略：
 * - 使用 PostgreSQL RLS（Row-Level Security）
 * - 每次操作前设置 session variable: SET LOCAL openclaw.tenant_id = $1
 * - RLS 策略自动过滤，应用层无法绕过
 *
 * 性能优化：
 * - 连接池（Kysely 内置）
 * - batchSet 使用 INSERT ... ON CONFLICT (batch upsert)
 * - list 查询使用 JSONB 索引
 */
export class PostgresStorageBackend implements StorageBackend {
  private db: Kysely<DatabaseSchema> | null = null;

  constructor(private config: PostgresStorageConfig) {}

  async initialize(): Promise<void> {
    this.db = createKyselyInstance(this.config);
    await runMigrations(this.db);
    await this.enableRLS();
  }

  async shutdown(): Promise<void> {
    await this.db?.destroy();
  }

  async get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null> {
    const row = await this.withTenant(ctx, (db) =>
      db.selectFrom("enterprise_kv")
        .where("tenant_id", "=", ctx.tenantId)
        .where("collection", "=", collection)
        .where("key", "=", key)
        .selectAll()
        .executeTakeFirst(),
    );
    return row ? JSON.parse(row.value) : null;
  }

  async set<T>(ctx: TenantContext, collection: string, key: string, value: T): Promise<void> {
    await this.withTenant(ctx, (db) =>
      db.insertInto("enterprise_kv")
        .values({
          tenant_id: ctx.tenantId,
          collection,
          key,
          value: JSON.stringify(value),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(["tenant_id", "collection", "key"]).doUpdateSet({
            value: JSON.stringify(value),
            updated_at: new Date(),
          }),
        )
        .execute(),
    );
  }

  async transaction<T>(ctx: TenantContext, fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    return this.db!.transaction().execute(async (trx) => {
      await this.setTenantId(trx, ctx.tenantId);
      return fn(new KyselyStorageTransaction(trx, ctx.tenantId));
    });
  }

  private async withTenant<T>(ctx: TenantContext, fn: (db: Kysely<DatabaseSchema>) => Promise<T>): Promise<T> {
    // 在连接级别设置 tenant_id（RLS 使用）
    await this.db!.raw(`SET LOCAL openclaw.tenant_id = '${ctx.tenantId}'`);
    return fn(this.db!);
  }

  private async enableRLS(): Promise<void> {
    await this.db!.raw(`
      ALTER TABLE enterprise_kv ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON enterprise_kv
        USING (tenant_id = current_setting('openclaw.tenant_id'));
    `);
  }

  // ... list, delete, atomicUpdate, batchGet, batchSet 实现
}
```

### 5.2 Redis 队列后端（基于 BullMQ）

```typescript
// src/enterprise/kernel-impl/redis/queue.ts

import { Queue, Worker, QueueEvents } from "bullmq";
import type IORedis from "ioredis";

/**
 * Redis 队列后端。
 *
 * 底层使用 BullMQ，映射 PRD 接口：
 * - QueueBackend.enqueue → Queue.add
 * - QueueBackend.subscribe → Worker
 * - QueueBackend.ack → job.moveToCompleted (Worker 自动处理)
 * - QueueBackend.nack → job.moveToFailed
 * - priority → BullMQ priority (1=high, 5=normal, 10=low)
 * - delay → BullMQ delay option
 * - DLQ → BullMQ 超出 maxAttempts 后的 failed jobs
 * - idempotencyKey → BullMQ jobId (相同 jobId 不重复入队)
 */
export class RedisQueueBackend implements QueueBackend {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private connection: IORedis;

  constructor(private config: RedisQueueConfig) {
    this.connection = createRedisConnection(config);
  }

  async initialize(): Promise<void> {
    // 连接验证
    await this.connection.ping();
  }

  async shutdown(): Promise<void> {
    for (const worker of this.workers.values()) await worker.close();
    for (const queue of this.queues.values()) await queue.close();
    this.connection.disconnect();
  }

  async enqueue(
    ctx: TenantContext,
    queue: string,
    message: QueueMessage,
    options?: EnqueueOptions,
  ): Promise<string> {
    const q = this.getOrCreateQueue(queue);

    const job = await q.add(
      message.type,
      { tenantId: ctx.tenantId, payload: message.payload, metadata: message.metadata },
      {
        jobId: options?.idempotencyKey ?? message.id,
        priority: this.mapPriority(options?.priority ?? "normal"),
        delay: options?.delay,
        attempts: options?.maxAttempts ?? 3,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: true,
        removeOnFail: false, // 保留在 failed 中作为 DLQ
      },
    );

    return job.id!;
  }

  subscribe(
    queue: string,
    handler: QueueHandler,
    options?: SubscribeOptions,
  ): QueueSubscription {
    const worker = new Worker(
      queue,
      async (job) => {
        const message: QueueMessage = {
          id: job.id!,
          tenantId: job.data.tenantId,
          type: job.name,
          payload: job.data.payload,
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 3,
          createdAt: new Date(job.timestamp),
          metadata: job.data.metadata,
        };
        await handler(message);
      },
      {
        connection: this.connection.duplicate(),
        concurrency: options?.concurrency ?? 5,
      },
    );

    this.workers.set(queue, worker);

    return {
      unsubscribe: async () => {
        await worker.close();
        this.workers.delete(queue);
      },
    };
  }

  async getDeadLetterMessages(
    queue: string,
    options?: PaginationOptions,
  ): Promise<PaginatedResult<QueueMessage>> {
    const q = this.getOrCreateQueue(queue);
    const failed = await q.getFailed(
      options?.offset ?? 0,
      (options?.offset ?? 0) + (options?.limit ?? 50) - 1,
    );

    return {
      items: failed.map((job) => ({
        id: job.id!,
        tenantId: job.data.tenantId,
        type: job.name,
        payload: job.data.payload,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 3,
        createdAt: new Date(job.timestamp),
      })),
      total: await q.getFailedCount(),
      hasMore: false,
    };
  }

  private getOrCreateQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, { connection: this.connection.duplicate() }));
    }
    return this.queues.get(name)!;
  }

  private mapPriority(p: "high" | "normal" | "low"): number {
    return p === "high" ? 1 : p === "low" ? 10 : 5;
  }
}
```

### 5.3 Redis 缓存/锁/事件总线后端

```typescript
// src/enterprise/kernel-impl/redis/connection.ts

import IORedis from "ioredis";

/**
 * 统一 Redis 连接工厂。
 * Cache、Queue、EventBus、Lock 共享同一个连接池配置。
 */
export function createRedisConnection(config: RedisConnectionConfig): IORedis {
  return new IORedis(config.url, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true, // 自动管线化提升批量操作性能
    lazyConnect: true,
  });
}
```

```typescript
// src/enterprise/kernel-impl/redis/lock.ts

import Redlock from "redlock-universal";

/**
 * Redis 分布式锁后端。
 * 使用 Redlock 算法实现。
 */
export class RedisLockBackend implements LockBackend {
  private redlock: Redlock;

  constructor(private connections: IORedis[]) {
    this.redlock = new Redlock(connections, {
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
    });
  }

  async acquire(key: string, options: LockOptions): Promise<LockHandle | null> {
    try {
      const lock = await this.redlock.acquire([`lock:${key}`], options.ttlMs);
      return {
        key,
        token: lock.value,
        expiresAt: new Date(Date.now() + options.ttlMs),
        _lock: lock, // 内部引用，用于 release/extend
      };
    } catch {
      return null;
    }
  }

  async release(handle: LockHandle): Promise<void> {
    await (handle as any)._lock.release();
  }

  async extend(handle: LockHandle, extensionMs: number): Promise<boolean> {
    try {
      await (handle as any)._lock.extend(extensionMs);
      return true;
    } catch {
      return false;
    }
  }

  electLeader(group: string, candidateId: string, options: LeaderElectionOptions): LeaderElection {
    // 基于 Redlock 的周期性续租实现领导选举
    // 获取锁 = 成为 leader，锁过期 = 让位
    // 详细实现省略...
  }
}
```

### 5.4 OIDC 身份提供者

```typescript
// src/enterprise/governance/identity/impl/oidc-provider.ts

import * as client from "openid-client";

/**
 * OIDC 身份提供者。
 *
 * 支持的认证流程：
 * - Authorization Code Flow（Web 应用）
 * - Client Credentials Flow（服务间调用）
 * - Token Introspection（验证外部签发的 token）
 */
export class OidcIdentityProvider implements IdentityProvider {
  readonly type = "oidc";
  private config!: client.Configuration;

  constructor(private oidcConfig: OidcConfig) {}

  async initialize(): Promise<void> {
    this.config = await client.discovery(
      new URL(this.oidcConfig.issuer),
      this.oidcConfig.clientId,
      this.oidcConfig.clientSecret,
    );
  }

  async authenticate(request: AuthRequest): Promise<AuthResult> {
    const token = request.headers["authorization"]?.replace("Bearer ", "");
    if (!token) return { authenticated: false, error: "No token provided" };

    try {
      const result = await client.tokenIntrospection(this.config, token);
      if (!result.active) return { authenticated: false, error: "Token inactive" };

      return {
        authenticated: true,
        identity: {
          userId: result.sub as string,
          tenantId: (result as any).tenant_id ?? "default",
          email: result.email as string | undefined,
          displayName: result.name as string | undefined,
          roles: ((result as any).roles as string[]) ?? [],
          groups: ((result as any).groups as string[]) ?? [],
        },
        expiresAt: result.exp ? new Date(result.exp * 1000) : undefined,
      };
    } catch (err) {
      return { authenticated: false, error: String(err) };
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    const tokens = await client.refreshTokenGrant(this.config, refreshToken);
    // ... 将 tokens 转换为 AuthResult
  }
}
```

### 5.5 RBAC 策略引擎（基于 CASL）

```typescript
// src/enterprise/governance/authorization/impl/rbac-policy.ts

import { PureAbility, AbilityBuilder } from "@casl/ability";

/**
 * RBAC 策略引擎。基于 CASL 实现。
 *
 * 映射关系：
 * - PRD PolicyRule → CASL Rule
 * - PRD action（如 "sessions.send"）→ CASL action
 * - PRD resource type → CASL subject
 * - PRD conditions → CASL conditions
 *
 * 扩展：
 * - AuthzObligation 由 CASL 不支持，在此引擎内自行实现
 * - 策略版本管理通过 StorageBackend 持久化
 */
export class RbacPolicyEngine implements PolicyEngine {
  private abilities = new Map<string, PureAbility>(); // tenantId:userId → ability
  private policies: PolicyDefinition[] = [];
  private storage: StorageBackend;

  constructor(deps: { storage: StorageBackend }) {
    this.storage = deps.storage;
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    // 从 StorageBackend 加载持久化的策略
    const ctx = createDefaultTenantContext();
    const stored = await this.storage.list<PolicyDefinition>(ctx, "policies", {});
    this.policies = stored.items;
  }

  async authorize(request: AuthzRequest): Promise<AuthzDecision> {
    const ability = this.getOrBuildAbility(request.subject);

    const allowed = ability.can(
      request.action,
      request.resource.type,
    );

    if (!allowed) {
      return { allowed: false, reason: "RBAC policy denied" };
    }

    // 检查 obligations（CASL 不直接支持，自行实现）
    const obligations = this.resolveObligations(request);

    return { allowed: true, obligations };
  }

  async loadPolicies(policies: PolicyDefinition[]): Promise<void> {
    this.policies = policies;
    this.abilities.clear(); // 清空缓存，强制重新构建

    // 持久化到 StorageBackend
    const ctx = createDefaultTenantContext();
    for (const policy of policies) {
      await this.storage.set(ctx, "policies", policy.id, policy);
    }
  }

  private getOrBuildAbility(subject: UserIdentity): PureAbility {
    const cacheKey = `${subject.tenantId}:${subject.userId}`;
    if (this.abilities.has(cacheKey)) return this.abilities.get(cacheKey)!;

    const builder = new AbilityBuilder(PureAbility);

    for (const policy of this.policies) {
      for (const rule of policy.rules) {
        const matchesSubject = rule.subjects.some((s) =>
          subject.roles.includes(s) || subject.groups.includes(s) || s === "*",
        );
        if (!matchesSubject) continue;

        if (rule.effect === "allow") {
          for (const action of rule.actions) {
            for (const resource of rule.resources) {
              builder.can(action, resource, rule.conditions);
            }
          }
        } else {
          for (const action of rule.actions) {
            for (const resource of rule.resources) {
              builder.cannot(action, resource, rule.conditions);
            }
          }
        }
      }
    }

    const ability = builder.build();
    this.abilities.set(cacheKey, ability);
    return ability;
  }
}
```

### 5.6 REST API Builder（基于 Hono）

```typescript
// src/enterprise/embedding/api/rest-api-builder.ts

import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";

/**
 * REST API 自动构建器。
 *
 * 从现有 Gateway 方法注册表（server-methods）自动生成 RESTful 端点。
 *
 * 映射规则：
 * - sessions.send → POST /api/v1/sessions/:key/send
 * - sessions.list → GET /api/v1/sessions
 * - config.get → GET /api/v1/config
 * - config.set → PUT /api/v1/config
 * - channels.status → GET /api/v1/channels/status
 *
 * 每个端点自动经过企业中间件链。
 */
export function buildRestApi(
  modules: EnterpriseModules,
  methodRegistry: GatewayMethodRegistry,
): Hono {
  const api = new Hono();
  const middlewareChain = createEnterpriseMiddlewareChain(modules);

  // 挂载中间件链
  api.route("/", middlewareChain);

  // 自动生成路由
  for (const [methodName, handler] of Object.entries(methodRegistry)) {
    const route = mapMethodToRoute(methodName);
    if (!route) continue;

    api.on(route.method, route.path, async (c) => {
      const ctx = c.get("tenantContext");
      const params = route.method === "GET"
        ? Object.fromEntries(new URL(c.req.url).searchParams)
        : await c.req.json();

      const result = await handler({
        ...params,
        tenantContext: ctx,
      });

      return c.json(result);
    });
  }

  // Swagger UI
  api.get("/docs", swaggerUI({ url: "/api/v1/openapi.json" }));
  api.get("/openapi.json", (c) => {
    return c.json(generateOpenApiSpec(methodRegistry));
  });

  return api;
}

function mapMethodToRoute(methodName: string): { method: string; path: string } | null {
  const mappings: Record<string, { method: string; path: string }> = {
    "sessions.send":    { method: "POST", path: "/api/v1/sessions/:key/send" },
    "sessions.list":    { method: "GET",  path: "/api/v1/sessions" },
    "sessions.history": { method: "GET",  path: "/api/v1/sessions/:key/history" },
    "config.get":       { method: "GET",  path: "/api/v1/config" },
    "config.set":       { method: "PUT",  path: "/api/v1/config" },
    "channels.status":  { method: "GET",  path: "/api/v1/channels/status" },
    "agents.list":      { method: "GET",  path: "/api/v1/agents" },
  };
  return mappings[methodName] ?? null;
}
```

### 5.7 Prometheus 指标

```typescript
// src/enterprise/reliability/health/impl/prometheus-metrics.ts

import promClient from "prom-client";

/**
 * Prometheus 指标提供者。
 *
 * 预定义指标：
 * - openclaw_api_requests_total（Counter）
 * - openclaw_api_request_duration_seconds（Histogram）
 * - openclaw_queue_depth（Gauge）
 * - openclaw_circuit_breaker_state（Gauge）
 * - openclaw_audit_events_total（Counter）
 */
export class PrometheusMetricsProvider implements MetricsProvider {
  private registry = new promClient.Registry();

  constructor() {
    promClient.collectDefaultMetrics({ register: this.registry });
  }

  counter(name: string, labels?: Record<string, string>): CounterMetric {
    const counter = new promClient.Counter({
      name: `openclaw_${name}`,
      help: name,
      labelNames: Object.keys(labels ?? {}),
      registers: [this.registry],
    });
    return {
      inc: (value = 1) => counter.inc(labels, value),
    };
  }

  histogram(name: string, buckets?: number[]): HistogramMetric {
    const hist = new promClient.Histogram({
      name: `openclaw_${name}`,
      help: name,
      buckets: buckets ?? [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
      registers: [this.registry],
    });
    return {
      observe: (value: number) => hist.observe(value),
    };
  }

  gauge(name: string): GaugeMetric {
    const gauge = new promClient.Gauge({
      name: `openclaw_${name}`,
      help: name,
      registers: [this.registry],
    });
    return {
      set: (value: number) => gauge.set(value),
      inc: (value = 1) => gauge.inc(value),
      dec: (value = 1) => gauge.dec(value),
    };
  }

  serialize(): string {
    return this.registry.metrics() as unknown as string;
  }
}
```

---

## 六、Phase 3：K8s 部署与高级功能

> **目标**：Kubernetes Runtime + Helm Chart + Workflow Engine + 企业文档
> **时间**：6-8 周
> **新增依赖**：`@kubernetes/client-node`、可选 `hashi-vault-js`

### 6.1 Kubernetes Runtime

```typescript
// src/enterprise/isolation/runtime/impl/k8s-runtime.ts

import * as k8s from "@kubernetes/client-node";

/**
 * Kubernetes Agent 运行时后端。
 *
 * 每个 Agent 运行为一个独立 Pod：
 * - 主容器：Agent Runtime
 * - Sidecar 容器：Tool Sandbox（可选）
 *
 * RuntimeSpec 自动映射为 K8s manifest：
 * - isolation.network → NetworkPolicy
 * - isolation.resources → ResourceQuota / container limits
 * - isolation.filesystem → PVC
 */
export class KubernetesRuntime implements AgentRuntimeBackend {
  readonly type = "kubernetes";
  private coreApi: k8s.CoreV1Api;
  private networkApi: k8s.NetworkingV1Api;

  async create(spec: RuntimeSpec): Promise<RuntimeInstance> {
    const podManifest = this.buildPodManifest(spec);
    const pod = await this.coreApi.createNamespacedPod(this.namespace, podManifest);

    if (spec.isolation.network.mode !== "none") {
      const netPolicy = this.buildNetworkPolicy(spec);
      await this.networkApi.createNamespacedNetworkPolicy(this.namespace, netPolicy);
    }

    return {
      instanceId: pod.body.metadata!.name!,
      spec,
      createdAt: new Date(),
    };
  }

  private buildPodManifest(spec: RuntimeSpec): k8s.V1Pod {
    return {
      metadata: {
        name: `agent-${spec.agentId}-${Date.now()}`,
        labels: {
          "app.kubernetes.io/name": "openclaw-agent",
          "openclaw.ai/tenant-id": spec.tenantId,
          "openclaw.ai/agent-id": spec.agentId,
        },
      },
      spec: {
        containers: [
          {
            name: "agent",
            image: spec.image ?? "openclaw/agent-runtime:latest",
            env: Object.entries(spec.env ?? {}).map(([name, value]) => ({ name, value })),
            resources: {
              limits: {
                cpu: `${spec.isolation.resources.cpuMillicores ?? 500}m`,
                memory: `${spec.isolation.resources.memoryMb ?? 512}Mi`,
              },
            },
          },
        ],
        restartPolicy: "Never",
        automountServiceAccountToken: false,
      },
    };
  }

  // start, stop, kill, getStatus, exec, healthCheck 省略...
}
```

### 6.2 Helm Chart 结构

```
deploy/helm/openclaw-enterprise/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── gateway-deployment.yaml       # API Gateway（无状态，HPA）
│   ├── gateway-service.yaml
│   ├── gateway-hpa.yaml
│   ├── worker-deployment.yaml        # Agent Worker（无状态，HPA）
│   ├── worker-hpa.yaml
│   ├── redis-statefulset.yaml        # Redis（可选，也可用外部 Redis）
│   ├── postgres-statefulset.yaml     # PG（可选，也可用外部 PG）
│   ├── configmap.yaml                # openclaw.json 配置
│   ├── secret.yaml                   # 敏感配置
│   ├── networkpolicy.yaml            # 网络策略
│   ├── serviceaccount.yaml
│   ├── rbac.yaml                     # K8s RBAC（给 Agent Pod 创建权限）
│   └── prometheus-servicemonitor.yaml # Prometheus 采集配置
└── values/
    ├── dev.yaml                      # 开发环境
    ├── staging.yaml                  # 预发环境
    └── production.yaml               # 生产环境
```

### 6.3 简单工作流引擎参考实现

```typescript
// src/enterprise/collaboration/workflow/impl/simple-workflow.ts

/**
 * 线性工作流引擎参考实现。
 *
 * 支持：
 * - 顺序执行步骤
 * - human_review 步骤暂停
 * - wait_signal 等待外部信号
 * - 错误处理和超时
 * - 基于 StorageBackend 持久化工作流实例
 *
 * 不支持（留给企业用户实现）：
 * - 并行步骤
 * - 条件分支（DAG）
 * - 复杂状态回退
 */
export class SimpleWorkflowEngine implements WorkflowEngine {
  private definitions = new Map<string, WorkflowDefinition>();
  private storage: StorageBackend;
  private eventBus: EventBus;

  async startWorkflow(
    ctx: TenantContext,
    workflowId: string,
    input: unknown,
  ): Promise<WorkflowInstance> {
    const definition = this.definitions.get(workflowId);
    if (!definition) throw new Error(`Workflow not found: ${workflowId}`);

    const instance: WorkflowInstance = {
      id: crypto.randomUUID(),
      workflowId,
      state: "running",
      currentStepIndex: 0,
      input,
      stepResults: [],
      createdAt: new Date(),
    };

    // 持久化
    await this.storage.set(ctx, "workflow_instances", instance.id, instance);

    // 开始执行第一个步骤
    this.executeStep(ctx, instance, definition).catch((err) => {
      console.error("Workflow execution error:", err);
    });

    return instance;
  }

  async signal(ctx: TenantContext, instanceId: string, signal: WorkflowSignal): Promise<void> {
    const instance = await this.storage.get<WorkflowInstance>(
      ctx, "workflow_instances", instanceId,
    );
    if (!instance) throw new Error(`Workflow instance not found: ${instanceId}`);

    // 发布信号事件，等待步骤的 once 捕获
    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: `workflow.signal.${instanceId}`,
      tenantId: ctx.tenantId,
      source: "workflow-engine",
      timestamp: new Date(),
      data: signal,
    });
  }

  private async executeStep(
    ctx: TenantContext,
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
  ): Promise<void> {
    const step = definition.steps[instance.currentStepIndex];
    if (!step) {
      instance.state = "completed";
      await this.storage.set(ctx, "workflow_instances", instance.id, instance);
      return;
    }

    switch (step.type) {
      case "agent_task":
        // 创建 Task，通过 TaskFSM 管理
        break;

      case "human_review":
        instance.state = "waiting_signal";
        await this.storage.set(ctx, "workflow_instances", instance.id, instance);
        // 等待 signal
        const signal = await this.eventBus.once(
          `workflow.signal.${instance.id}`,
          step.timeoutMs ?? 86_400_000, // 默认 24h 超时
        );
        instance.stepResults.push({ stepId: step.id, result: signal.data });
        break;

      case "wait_signal":
        // 类似 human_review
        break;
    }

    // 继续下一步
    instance.currentStepIndex += 1;
    await this.storage.set(ctx, "workflow_instances", instance.id, instance);
    await this.executeStep(ctx, instance, definition);
  }
}
```

---

## 七、测试策略

### 7.1 测试分层

| 层级 | 范围 | 框架 | 运行方式 |
|------|------|------|----------|
| **单元测试** | 每个内核接口的每个实现 | Vitest | `pnpm test -- src/enterprise/**/*.test.ts` |
| **合规测试** | 接口契约验证（所有实现必须通过同一套测试） | Vitest | 参数化测试，每个后端实现作为参数 |
| **集成测试** | 多模块协作（中间件链、审计管道、Task FSM + Queue） | Vitest | 使用 Memory 后端，不需要外部服务 |
| **E2E 测试** | PG/Redis 后端的真实环境测试 | Vitest + Docker Compose | `pnpm test:enterprise:e2e` |

### 7.2 合规测试模式（关键设计）

```typescript
// src/enterprise/kernel/storage.compliance-test.ts

/**
 * StorageBackend 合规测试套件。
 *
 * 所有 StorageBackend 实现（Memory、FileSystem、Postgres）
 * 必须通过此套件。企业用户自定义实现也可使用此套件验证。
 *
 * 使用方式：
 * import { runStorageComplianceTests } from "openclaw/enterprise/kernel/storage.compliance-test";
 * runStorageComplianceTests(() => new MyCustomStorageBackend());
 */
export function runStorageComplianceTests(
  factory: () => StorageBackend | Promise<StorageBackend>,
): void {
  let backend: StorageBackend;
  const ctx: TenantContext = {
    tenantId: "test-tenant",
    requestId: "test-request",
    source: "internal",
  };

  beforeEach(async () => {
    backend = await factory();
    await backend.initialize();
  });

  afterEach(async () => {
    await backend.shutdown();
  });

  describe("StorageBackend Compliance", () => {
    test("get returns null for non-existent key", async () => {
      const result = await backend.get(ctx, "test", "nonexistent");
      expect(result).toBeNull();
    });

    test("set then get returns same value", async () => {
      await backend.set(ctx, "test", "key1", { foo: "bar" });
      const result = await backend.get(ctx, "test", "key1");
      expect(result).toEqual({ foo: "bar" });
    });

    test("tenant isolation: tenant A cannot see tenant B data", async () => {
      const ctxA = { ...ctx, tenantId: "tenant-a" };
      const ctxB = { ...ctx, tenantId: "tenant-b" };

      await backend.set(ctxA, "test", "key1", { data: "A" });
      await backend.set(ctxB, "test", "key1", { data: "B" });

      expect(await backend.get(ctxA, "test", "key1")).toEqual({ data: "A" });
      expect(await backend.get(ctxB, "test", "key1")).toEqual({ data: "B" });
    });

    test("delete returns true for existing key", async () => {
      await backend.set(ctx, "test", "key1", { foo: "bar" });
      const deleted = await backend.delete(ctx, "test", "key1");
      expect(deleted).toBe(true);
      expect(await backend.get(ctx, "test", "key1")).toBeNull();
    });

    test("atomicUpdate creates if not exists", async () => {
      const result = await backend.atomicUpdate(ctx, "test", "counter", (current) => {
        return { count: ((current as any)?.count ?? 0) + 1 };
      });
      expect(result).toEqual({ count: 1 });
    });

    test("list with pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await backend.set(ctx, "test", `item-${i}`, { index: i });
      }
      const page1 = await backend.list(ctx, "test", { limit: 2, offset: 0 });
      expect(page1.items.length).toBe(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);
    });

    // ... 更多合规测试：batchGet, batchSet, transaction（如果支持）
  });
}
```

### 7.3 Phase 0 回归验证

```bash
# Phase 0 完成后的验证命令序列：

# 1. 全量现有测试（不得有新增失败）
pnpm test

# 2. 企业模块单元测试
pnpm test -- src/enterprise/kernel-impl/memory/
pnpm test -- src/enterprise/kernel-impl/filesystem/

# 3. 合规测试
pnpm test -- src/enterprise/kernel/*.compliance-test.ts

# 4. 性能基准（确保内存后端无性能退化）
pnpm test -- src/enterprise/kernel-impl/memory/*.bench.ts
```

---

## 八、部署方案

### 8.1 Docker Compose（开发/小团队）

```yaml
# deploy/docker-compose/docker-compose.yml

version: "3.9"

services:
  openclaw:
    image: openclaw/enterprise:latest
    ports:
      - "18789:18789"   # Gateway
      - "9090:9090"     # Prometheus metrics
    environment:
      - OPENCLAW_ENTERPRISE_ENABLED=true
      - DATABASE_URL=postgres://openclaw:openclaw@postgres:5432/openclaw
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./openclaw.json:/root/.openclaw/openclaw.json
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: openclaw
      POSTGRES_PASSWORD: openclaw
      POSTGRES_DB: openclaw
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

### 8.2 Dockerfile

```dockerfile
# deploy/Dockerfile.enterprise

FROM node:22-alpine AS base
WORKDIR /app

# 安装依赖
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

# 复制源码
COPY . .

# 构建
RUN pnpm build

# 运行
EXPOSE 18789 9090
CMD ["node", "dist/openclaw.mjs", "gateway", "run", "--bind", "0.0.0.0", "--port", "18789"]
```

### 8.3 单进程零依赖启动（个人版兼容）

```bash
# 不需要任何配置变更，行为与升级前完全一致
openclaw gateway run

# 等价于 enterprise.enabled = false（默认值）
# 使用 Memory/FileSystem 后端
# 无 PG/Redis 依赖
```

### 8.4 小团队部署（单机 + 外部存储）

```bash
# 只需设置企业配置段
openclaw config set enterprise.enabled true
openclaw config set enterprise.kernel.storage.backend postgres
openclaw config set enterprise.kernel.storage.postgres.connectionString "env:DATABASE_URL"
openclaw config set enterprise.kernel.queue.backend redis
openclaw config set enterprise.kernel.queue.redis.url "env:REDIS_URL"

# 启动
openclaw gateway run
```

---

## 九、风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **Phase 0 性能退化** | 现有用户体验下降 | 低 | Memory 后端的 Map 操作是 O(1)，不会比直接文件操作慢。Phase 0 增加性能基准测试，CI 门控。 |
| **FileSystem 桥接行为不一致** | 个人版升级后出现 bug | 中 | 合规测试强制覆盖所有 CRUD 路径。Phase 0 结束前全量回归。 |
| **BullMQ Redis 版本兼容性** | Redis 后端启动失败 | 低 | BullMQ 支持 Redis 6+/Valkey/ElastiCache，覆盖面广。文档中标注最低版本。 |
| **Hono 与现有 HTTP 层冲突** | 企业 REST API 路由和现有路由冲突 | 中 | 企业 API 统一使用 `/api/v1/` 前缀，与现有路由命名空间隔离。Hono 作为子路由挂载，不替换现有 HTTP server。 |
| **CASL 规则序列化不完整** | RBAC 策略热加载丢失条件 | 中 | CASL 的 conditions 使用 MongoDB 查询语法，JSON 可序列化。在合规测试中覆盖序列化/反序列化往返。 |
| **Cockatiel 维护者风险** | 长期无更新 | 低 | Cockatiel 零依赖，代码量小（~2000 行）。最坏情况可 fork 维护，或用 30 行代码自研熔断器。 |
| **多 Agent 并发修改企业配置** | 配置竞态 | 中 | 企业配置写入走 LockBackend.acquire，PG 后端走事务。Memory 后端单进程无竞态。 |
| **K8s Runtime Pod 泄漏** | 僵尸 Pod 占用集群资源 | 中 | Pod 设置 `activeDeadlineSeconds`；HealthAggregator 周期检查并清理超时 Pod；K8s Job TTL 控制器作为兜底。 |

---

## 附录 A：Phase 各阶段依赖清单

### Phase 0（无新增依赖）

```
新增文件：~40 个（接口定义 + Memory/FS 实现 + 合规测试）
修改现有文件：1 个（server.impl.ts，新增可选的 enterprise 初始化入口）
```

### Phase 1 新增依赖

```json
{
  "dependencies": {
    "@casl/ability": "^6.x",
    "cockatiel": "^3.x",
    "eventemitter3": "^5.x"
  }
}
```

> 注：`hono` 已在现有 dependencies 中，无需新增。

### Phase 2 新增依赖

```json
{
  "dependencies": {
    "kysely": "^0.27.x",
    "pg": "^8.x",
    "bullmq": "^5.x",
    "ioredis": "^5.x",
    "openid-client": "^6.x",
    "rate-limiter-flexible": "^5.x",
    "prom-client": "^15.x",
    "redlock-universal": "^1.x",
    "dockerode": "^4.x"
  },
  "devDependencies": {
    "@types/dockerode": "^3.x",
    "@types/pg": "^8.x"
  }
}
```

### Phase 3 新增依赖

```json
{
  "dependencies": {
    "@kubernetes/client-node": "^1.x"
  },
  "optionalDependencies": {
    "hashi-vault-js": "^0.5.x"
  }
}
```

---

## 附录 B：配置 Schema（TypeBox 定义）

```typescript
// src/enterprise/config.ts

import { Type, type Static } from "@sinclair/typebox";

export const EnterpriseConfigSchema = Type.Object({
  enabled: Type.Boolean({ default: false }),

  kernel: Type.Optional(Type.Object({
    storage: Type.Optional(Type.Object({
      backend: Type.Optional(Type.String({ default: "memory" })),
      postgres: Type.Optional(Type.Object({
        connectionString: Type.Union([Type.String(), SecretRefSchema]),
        pool: Type.Optional(Type.Object({
          min: Type.Optional(Type.Number({ default: 2 })),
          max: Type.Optional(Type.Number({ default: 10 })),
        })),
      })),
    })),
    queue: Type.Optional(Type.Object({
      backend: Type.Optional(Type.String({ default: "memory" })),
      redis: Type.Optional(Type.Object({
        url: Type.Union([Type.String(), SecretRefSchema]),
      })),
    })),
    cache: Type.Optional(Type.Object({
      backend: Type.Optional(Type.String({ default: "memory" })),
    })),
    secret: Type.Optional(Type.Object({
      backend: Type.Optional(Type.String({ default: "secret-ref" })),
    })),
    eventBus: Type.Optional(Type.Object({
      backend: Type.Optional(Type.String({ default: "inprocess" })),
    })),
    lock: Type.Optional(Type.Object({
      backend: Type.Optional(Type.String({ default: "inprocess" })),
    })),
  })),

  governance: Type.Optional(Type.Object({
    identity: Type.Optional(Type.Object({
      provider: Type.Optional(Type.String({ default: "token" })),
    })),
    authorization: Type.Optional(Type.Object({
      engine: Type.Optional(Type.String({ default: "scope" })),
    })),
  })),

  audit: Type.Optional(Type.Object({
    sinks: Type.Optional(Type.Array(Type.Object({
      type: Type.String(),
    }))),
  })),

  reliability: Type.Optional(Type.Object({
    retry: Type.Optional(Type.Object({
      defaultPolicy: Type.Optional(Type.Object({
        maxAttempts: Type.Optional(Type.Number({ default: 3 })),
        baseDelayMs: Type.Optional(Type.Number({ default: 500 })),
        maxDelayMs: Type.Optional(Type.Number({ default: 30000 })),
      })),
    })),
    circuitBreaker: Type.Optional(Type.Object({
      failureThreshold: Type.Optional(Type.Number({ default: 5 })),
      resetTimeoutMs: Type.Optional(Type.Number({ default: 30000 })),
    })),
    metrics: Type.Optional(Type.Object({
      provider: Type.Optional(Type.String({ default: "noop" })),
      port: Type.Optional(Type.Number({ default: 9090 })),
    })),
  })),
});

export type EnterpriseConfig = Static<typeof EnterpriseConfigSchema>;
```

---

## 附录 C：关键决策记录（ADR）

### ADR-001：为什么自研 FSM 而不用 XState

- **决策**：自研泛型 FSM 引擎（~150 行）
- **原因**：PRD 定义的 TaskFSM 只有 8 状态 / 13 转换，XState v5 引入 30KB + Statechart 概念过度
- **回退条件**：如果出现需要并行状态、层级嵌套状态的场景，迁移到 XState

### ADR-002：为什么 Hono 作为中间件层而不替换现有 HTTP server

- **决策**：Hono 作为 `/api/v1/*` 子路由挂载到现有 HTTP server
- **原因**：现有 Gateway 的 WebSocket RPC 路径不需要企业中间件链，替换整个 HTTP server 风险高
- **效果**：现有 WS 路径零影响，企业 REST API 获得完整中间件链

### ADR-003：为什么 Kysely 而不是 Drizzle

- **决策**：使用 Kysely 作为 PG 查询层
- **原因**：Kysely 是薄 SQL 构建器（1:1 SQL 编译），更适合"接口+参考实现"模式——企业用户能看到干净的 SQL。Drizzle 的 ORM 抽象层更厚，RLS 支持虽好但引入了更多 schema magic
- **回退条件**：如果需要声明式 Schema 迁移管理，可考虑切换

### ADR-004：为什么 Phase 0-1 不做前端

- **决策**：CLI + REST API + Swagger UI，无独立前端
- **原因**：独立开发者资源有限。先确保后端架构稳固，前端按社区需求在 Phase 2 后添加
- **回退条件**：如果早期企业用户强烈需要管理 UI，Phase 2 可引入 React + shadcn/ui
