# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Bootstrap 全六维度集成** — `bootstrap.ts` 从三个模块返回 null 的状态升级为全部六个维度完整初始化
  - `resolveCollaboration()`: SimpleWorkflowEngine + StorageHandoffManager + StorageKnowledgeStore
  - `resolveEmbedding()`: MemoryRateLimiter + StorageApiKeyManager
  - `resolveIsolation()`: InProcessRuntime / DockerRuntime / KubernetesRuntime（配置驱动）
  - `resolveReliability()`: HealthCheckerImpl + StorageCheckpointManager + MetricsProvider（之前只有 HealthChecker）
  - `resolveGovernance()`: 新增 RegexClassifier 内容过滤 + TokenQuotaManager 配额管理 + OIDC/RBAC 配置分支
- **Shutdown 优雅停机** — 新增全模块反向关闭逻辑，按依赖顺序 `Promise.allSettled` 关闭所有组件
- **REST API 新增 9 个路由模块**（从 10 个扩展到 19 个）:
  - `workflows` — 工作流注册与启动
  - `workflow-instances` — 工作流实例查询与信号
  - `handoffs` — 人机交接全生命周期（创建/分配/解决/取消）
  - `knowledge` — 知识库 CRUD 与搜索（命名空间 + 标签 + 全文）
  - `runtime` — 运行时实例 CRUD 与指标
  - `content-filters` — 内容过滤测试端点
  - `quotas` — 配额使用查询、检查、消费
  - `queues` — 死信队列查看与重放
  - `checkpoints` — 任务检查点保存、列表、恢复
  - `policies` — 策略定义加载
  - `authz` — 授权检查（单个/批量）
- **AuditQuery 接口** — `src/audit/query/audit-query.ts`，支持按时间范围、分类、操作者、资源、outcome 等多维查询

### Fixed

- `TokenQuotaManager` (`token-quota.ts`) — `atomicUpdate` 泛型参数从 `StoredUsage | null` 修正为 `StoredUsage`，修复 TS18047 类型错误

### Changed

- `rest-api-builder.ts` — 路由按六维度分组挂载，import 从 10 个扩展到 19 个
- `README.md` — 全面更新为反映六维度完整集成状态

---

## [0.1.0] - 2026-03-22

### Added

- **Kernel 基础设施层** — 六大后端抽象接口（Storage、Queue、Cache、Secret、EventBus、Lock）
  - Memory 内存实现（零依赖，开发/测试用）
  - PostgreSQL 实现（Kysely，企业生产用）
  - Redis 实现（ioredis + BullMQ + Redlock，企业生产用）
- **Governance 可治理** — 身份认证与授权
  - TokenIdentityProvider（Token/Password 模式）
  - OidcIdentityProvider（OpenID Connect 企业 SSO）
  - ScopePolicyEngine（基于作用域的授权）
  - RbacPolicyEngine（基于 CASL 的 RBAC 授权）
  - RegexClassifier（正则内容过滤，redact/block/review/allow）
  - TokenQuotaManager（滑动窗口配额管理）
- **Audit 可审计** — 审计管道
  - MemoryAuditPipeline（缓冲 + 批量刷写）
  - LogAuditSink、StorageAuditSink
- **Collaboration 可协作** — 工作流与协作
  - SimpleWorkflowEngine（顺序执行、human_review、wait_signal）
  - StorageHandoffManager（事件驱动的人机交接）
  - StorageKnowledgeStore（命名空间 + 标签 + 全文搜索）
- **Embedding 可嵌入** — API 接入层
  - Hono REST API 框架，10 个基础路由模块
  - MemoryRateLimiter（滑动窗口限流）
  - StorageApiKeyManager（SHA-256 哈希存储，全生命周期管理）
- **Isolation 可隔离** — 运行时隔离
  - InProcessRuntime（进程内模拟）
  - DockerRuntime（容器级隔离 Stub）
  - KubernetesRuntime（Pod 级隔离 + NetworkPolicy）
  - AllowlistNetworkPolicy（出站白名单）
- **Reliability 可靠性** — 运行保障
  - HealthCheckerImpl（多探针健康聚合）
  - StorageCheckpointManager（状态持久化与恢复）
  - CascadeKillManager（signal → abort → kill 三阶段优雅降级）
  - DeadLetterManager（死信队列管理）
  - MetricsProvider 接口 + NoopMetricsProvider
- **Middleware 中间件链** — AuthN → TenantContext → AuthZ → RateLimit → Handler → ContentFilter → Audit
- **数据库** — PostgreSQL schema（3NF）+ RLS 行级安全策略
- **部署** — Dockerfile、docker-compose、Helm chart
- **文档** — PRD、技术设计文档、API 设计文档（~100 端点）

### Fixed

- 解决 15 个 TypeScript 类型错误和 4 个部署配置问题

[Unreleased]: https://github.com/haoyuxiao0223/openclaw-enterprise-plugin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/haoyuxiao0223/openclaw-enterprise-plugin/releases/tag/v0.1.0
