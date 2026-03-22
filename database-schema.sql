-- ============================================================================
-- OpenClaw Enterprise — 企业级 Agent 平台数据库 Schema (PostgreSQL)
-- 符合第三范式 (3NF)
-- 版本: v1.0
-- 日期: 2026-03-21
-- 基于: PRD v1.0 + 技术实现方案（方案一）
-- ============================================================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID 生成
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- 加密函数（API Key 哈希等）

-- ============================================================================
-- 第一部分：内核层 (Kernel Layer) — 基础设施表
-- ============================================================================
-- 内核层是整个企业级架构的基石。这些表支撑 StorageBackend、QueueBackend、
-- LockBackend、EventBus 等抽象接口的 PostgreSQL 参考实现。

-- ----------------------------------------------------------------------------
-- 1.1 租户表 (tenants)
-- 设计意图：多租户架构的根实体。PRD 要求"租户上下文贯穿"所有操作，
-- 此表存储租户元数据，是几乎所有业务表的外键来源。
-- 关系：一对多 → 几乎所有业务表都通过 tenant_id 引用此表。
-- ----------------------------------------------------------------------------
CREATE TABLE tenants (
    id              VARCHAR(64)     PRIMARY KEY,
    name            VARCHAR(255)    NOT NULL,
    display_name    VARCHAR(255),
    status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'deleted')),
    settings        JSONB           NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenants IS '租户表。多租户架构的根实体，PRD 要求所有操作携带 TenantContext，此表是 tenantId 的权威来源。';
COMMENT ON COLUMN tenants.id IS '租户唯一标识。个人版默认 "default"。';
COMMENT ON COLUMN tenants.settings IS '租户级配置（JSONB），如默认配额、功能开关等。';

-- 为个人版兼容插入默认租户
INSERT INTO tenants (id, name, display_name) VALUES ('default', 'default', 'Default Tenant');

-- ----------------------------------------------------------------------------
-- 1.2 通用键值存储表 (enterprise_kv)
-- 设计意图：PRD StorageBackend 的 PostgreSQL 参考实现。
-- collection 映射到逻辑分组（sessions / config / credentials 等），
-- 不同 collection 共享此表，通过复合索引高效访问。
-- 关系：多对一 → tenants
-- ----------------------------------------------------------------------------
CREATE TABLE enterprise_kv (
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    collection      VARCHAR(128)    NOT NULL,
    key             VARCHAR(512)    NOT NULL,
    value           JSONB           NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, collection, key)
);

COMMENT ON TABLE enterprise_kv IS 'StorageBackend 的 PG 实现。泛型 KV 存储，collection 对应逻辑分组（sessions/config/credentials 等）。';
COMMENT ON COLUMN enterprise_kv.collection IS '逻辑集合名，映射 StorageBackend 接口中的 collection 参数。';
COMMENT ON COLUMN enterprise_kv.value IS 'JSONB 存储，支持丰富查询和索引。';

CREATE INDEX idx_kv_tenant_collection ON enterprise_kv (tenant_id, collection);
CREATE INDEX idx_kv_value_gin ON enterprise_kv USING GIN (value);

-- 启用行级安全 (RLS)，PRD 要求在存储层强制租户隔离
ALTER TABLE enterprise_kv ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_kv ON enterprise_kv
    USING (tenant_id = current_setting('openclaw.tenant_id', true));

-- ----------------------------------------------------------------------------
-- 1.3 分布式锁表 (distributed_locks)
-- 设计意图：LockBackend 的 PG 实现。用于 Cron 单实例执行、Session 写锁、
-- 领导选举等场景（PRD 4.6 节）。当不使用 Redis 时的替代方案。
-- 关系：独立表，无外键依赖。
-- ----------------------------------------------------------------------------
CREATE TABLE distributed_locks (
    lock_key        VARCHAR(512)    PRIMARY KEY,
    token           UUID            NOT NULL,
    holder_id       VARCHAR(255)    NOT NULL,
    expires_at      TIMESTAMPTZ     NOT NULL,
    acquired_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    metadata        JSONB
);

COMMENT ON TABLE distributed_locks IS 'LockBackend 的 PG 实现。提供分布式互斥能力，替代 Redis Redlock 的轻量方案。';
COMMENT ON COLUMN distributed_locks.token IS '防误释放令牌。释放锁时必须提供正确的 token。';
COMMENT ON COLUMN distributed_locks.holder_id IS '锁持有者标识（进程 ID / 实例 ID）。';

CREATE INDEX idx_locks_expires ON distributed_locks (expires_at);


-- ============================================================================
-- 第二部分：可治理模块 (Governance) — 身份、授权、数据保护、配额
-- ============================================================================
-- PRD 5.1 节。涵盖 IdentityProvider、PolicyEngine、ContentFilter、QuotaManager。

-- ----------------------------------------------------------------------------
-- 2.1 用户表 (users)
-- 设计意图：UserDirectory 接口的持久化载体。存储经过 IdentityProvider
-- 认证后的用户身份信息。
-- 关系：多对一 → tenants；一对多 → user_role_assignments, sessions, tasks 等。
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    email           VARCHAR(255),
    display_name    VARCHAR(255),
    identity_source VARCHAR(64)     NOT NULL DEFAULT 'local'
                        CHECK (identity_source IN ('local', 'oidc', 'saml', 'ldap', 'token')),
    external_id     VARCHAR(255),
    status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'locked')),
    metadata        JSONB           NOT NULL DEFAULT '{}',
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE users IS '用户目录表。存储 IdentityProvider 认证后的 UserIdentity 信息。';
COMMENT ON COLUMN users.identity_source IS '身份来源，对应不同的 IdentityProvider 实现（token/oidc/saml/ldap）。';
COMMENT ON COLUMN users.external_id IS '外部 IdP 中的用户 ID（如 OIDC sub claim），用于身份关联。';

CREATE UNIQUE INDEX idx_users_email ON users (tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_external ON users (tenant_id, identity_source, external_id);

-- ----------------------------------------------------------------------------
-- 2.2 角色表 (roles)
-- 设计意图：RBAC 模型的角色定义。PRD PolicyEngine 中 PolicyRule 的 subjects
-- 匹配角色名。角色属于租户，不同租户可定义同名但不同权限的角色。
-- 关系：多对一 → tenants；多对多 → permissions（通过 role_permissions）。
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    name            VARCHAR(128)    NOT NULL,
    description     TEXT,
    is_system       BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE roles IS 'RBAC 角色定义表。PRD AuthzRequest.subject.roles 中的角色在此定义。';
COMMENT ON COLUMN roles.is_system IS '系统内置角色标记。系统角色（如 admin/viewer）不可被租户删除。';

CREATE UNIQUE INDEX idx_roles_name ON roles (tenant_id, name);

-- ----------------------------------------------------------------------------
-- 2.3 权限表 (permissions)
-- 设计意图：PRD PolicyRule 中的 actions + resources 组合。将"对什么资源做什么操作"
-- 拆分为独立权限项，符合 3NF（消除 actions[] 数组的重复组）。
-- 关系：多对一 → tenants；多对多 → roles（通过 role_permissions）。
-- ----------------------------------------------------------------------------
CREATE TABLE permissions (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    action          VARCHAR(128)    NOT NULL,
    resource_type   VARCHAR(64)     NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE permissions IS '权限定义表。每条记录代表一个"action + resource_type"的原子权限。';
COMMENT ON COLUMN permissions.action IS '操作标识，如 sessions.send / config.set / tool.execute。';
COMMENT ON COLUMN permissions.resource_type IS '资源类型，如 agent / session / channel / config / tool。';

CREATE UNIQUE INDEX idx_permissions_action_resource ON permissions (tenant_id, action, resource_type);

-- ----------------------------------------------------------------------------
-- 2.4 角色-权限关联表 (role_permissions)
-- 设计意图：角色与权限的多对多关系。实现 RBAC 中"角色拥有哪些权限"的映射。
-- 3NF 说明：此为纯关联表，无传递依赖。
-- 关系：多对多联结表。role_id → roles, permission_id → permissions。
-- ----------------------------------------------------------------------------
CREATE TABLE role_permissions (
    tenant_id       VARCHAR(64)     NOT NULL,
    role_id         VARCHAR(128)    NOT NULL,
    permission_id   VARCHAR(128)    NOT NULL,
    granted_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, role_id, permission_id),
    FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, permission_id) REFERENCES permissions(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE role_permissions IS '角色-权限关联表。多对多关系：一个角色拥有多个权限，一个权限可被多个角色引用。';

-- ----------------------------------------------------------------------------
-- 2.5 用户-角色关联表 (user_role_assignments)
-- 设计意图：PRD UserIdentity.roles 的持久化。用户与角色的多对多关系。
-- 关系：多对多联结表。user_id → users, role_id → roles。
-- ----------------------------------------------------------------------------
CREATE TABLE user_role_assignments (
    tenant_id       VARCHAR(64)     NOT NULL,
    user_id         VARCHAR(128)    NOT NULL,
    role_id         VARCHAR(128)    NOT NULL,
    assigned_by     VARCHAR(128),
    assigned_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,

    PRIMARY KEY (tenant_id, user_id, role_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE user_role_assignments IS '用户-角色分配表。多对多关系，支持过期时间（临时角色授予）。';
COMMENT ON COLUMN user_role_assignments.expires_at IS '角色分配过期时间。NULL 表示永久有效，用于临时权限提升场景。';

-- ----------------------------------------------------------------------------
-- 2.6 用户组表 (user_groups)
-- 设计意图：PRD UserIdentity.groups 的支撑表。用户组是 RBAC 之上的组织单元，
-- PolicyRule.subjects 支持按组匹配。
-- 关系：多对一 → tenants；多对多 → users（通过 user_group_members）。
-- ----------------------------------------------------------------------------
CREATE TABLE user_groups (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255)    NOT NULL,
    description     TEXT,
    parent_group_id VARCHAR(128),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, parent_group_id) REFERENCES user_groups(tenant_id, id)
);

COMMENT ON TABLE user_groups IS '用户组表。支持层级结构（parent_group_id 自引用），PolicyRule 可按组授权。';

CREATE UNIQUE INDEX idx_groups_name ON user_groups (tenant_id, name);

-- ----------------------------------------------------------------------------
-- 2.7 用户组-成员关联表 (user_group_members)
-- 设计意图：用户与用户组的多对多关系。
-- 关系：多对多联结表。user_id → users, group_id → user_groups。
-- ----------------------------------------------------------------------------
CREATE TABLE user_group_members (
    tenant_id       VARCHAR(64)     NOT NULL,
    group_id        VARCHAR(128)    NOT NULL,
    user_id         VARCHAR(128)    NOT NULL,
    joined_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, group_id, user_id),
    FOREIGN KEY (tenant_id, group_id) REFERENCES user_groups(tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE user_group_members IS '用户组成员关联表。多对多：一个用户可属于多个组，一个组可包含多个用户。';

-- ----------------------------------------------------------------------------
-- 2.8 策略定义表 (policy_definitions)
-- 设计意图：PRD PolicyDefinition 的持久化。支持运行时热加载（loadPolicies）。
-- 关系：多对一 → tenants；一对多 → policy_rules。
-- ----------------------------------------------------------------------------
CREATE TABLE policy_definitions (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255)    NOT NULL,
    description     TEXT,
    version         INTEGER         NOT NULL DEFAULT 1,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE policy_definitions IS '授权策略定义表。对应 PRD PolicyDefinition，支持版本管理和热加载。';
COMMENT ON COLUMN policy_definitions.version IS '策略版本号。每次 loadPolicies 更新时递增。';

-- ----------------------------------------------------------------------------
-- 2.9 策略规则表 (policy_rules)
-- 设计意图：PRD PolicyRule 的持久化。每条规则定义 effect + subjects + actions + resources。
-- 3NF 说明：从 PolicyDefinition 中拆出 rules[]，消除数组类型的重复组。
-- 关系：多对一 → policy_definitions。
-- ----------------------------------------------------------------------------
CREATE TABLE policy_rules (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL,
    policy_id       VARCHAR(128)    NOT NULL,
    effect          VARCHAR(10)     NOT NULL CHECK (effect IN ('allow', 'deny')),
    subjects        TEXT[]          NOT NULL,
    actions         TEXT[]          NOT NULL,
    resources       TEXT[]          NOT NULL,
    conditions      JSONB,
    priority        INTEGER         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    FOREIGN KEY (tenant_id, policy_id) REFERENCES policy_definitions(tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE policy_rules IS '策略规则表。PRD PolicyRule 的持久化，支持 allow/deny + 模式匹配。';
COMMENT ON COLUMN policy_rules.subjects IS '主体模式数组，匹配角色或用户组名（如 ["admin", "editor"]）。';
COMMENT ON COLUMN policy_rules.actions IS '操作模式数组（如 ["sessions.*", "config.get"]）。';
COMMENT ON COLUMN policy_rules.resources IS '资源模式数组（如 ["agent", "session"]）。';
COMMENT ON COLUMN policy_rules.conditions IS 'ABAC 条件表达式（JSONB），用于上下文感知的细粒度控制。';

CREATE INDEX idx_policy_rules_policy ON policy_rules (tenant_id, policy_id);

-- ----------------------------------------------------------------------------
-- 2.10 内容过滤规则表 (content_filter_rules)
-- 设计意图：PRD ContentFilter 配置的持久化。定义输入/输出过滤链的规则。
-- 关系：多对一 → tenants。
-- ----------------------------------------------------------------------------
CREATE TABLE content_filter_rules (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255)    NOT NULL,
    direction       VARCHAR(10)     NOT NULL CHECK (direction IN ('inbound', 'outbound', 'both')),
    filter_type     VARCHAR(64)     NOT NULL,
    pattern         TEXT,
    severity        VARCHAR(20)     NOT NULL DEFAULT 'warning'
                        CHECK (severity IN ('info', 'warning', 'critical')),
    action_on_match VARCHAR(20)     NOT NULL DEFAULT 'redact'
                        CHECK (action_on_match IN ('allow', 'redact', 'block', 'review')),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    priority        INTEGER         NOT NULL DEFAULT 0,
    config          JSONB           NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE content_filter_rules IS '内容过滤规则表。对应 PRD ContentFilter 接口，按 direction 和 priority 组成过滤链。';
COMMENT ON COLUMN content_filter_rules.direction IS '过滤方向：inbound（Agent 收到消息时）/ outbound（Agent 发送回复前）/ both。';
COMMENT ON COLUMN content_filter_rules.action_on_match IS '匹配后的处置动作，对应 PRD FilterResult.action。';

CREATE INDEX idx_content_filters_tenant ON content_filter_rules (tenant_id, direction, is_active);

-- ----------------------------------------------------------------------------
-- 2.11 配额配置表 (quota_configs)
-- 设计意图：PRD QuotaManager 的配额定义。按租户、用户或角色粒度设置限额。
-- 关系：多对一 → tenants。
-- ----------------------------------------------------------------------------
CREATE TABLE quota_configs (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    scope_type      VARCHAR(20)     NOT NULL CHECK (scope_type IN ('tenant', 'user', 'role', 'agent')),
    scope_id        VARCHAR(128),
    resource_type   VARCHAR(64)     NOT NULL,
    max_value       BIGINT          NOT NULL,
    window_seconds  INTEGER         NOT NULL,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE quota_configs IS '配额配置表。定义不同粒度（租户/用户/角色/Agent）的资源限额。';
COMMENT ON COLUMN quota_configs.scope_type IS '配额作用范围类型。tenant=租户级, user=用户级, role=角色级, agent=Agent级。';
COMMENT ON COLUMN quota_configs.resource_type IS '资源类型标识（如 llm_tokens_per_day, api_calls_per_minute）。';
COMMENT ON COLUMN quota_configs.window_seconds IS '配额时间窗口（秒）。如 86400 = 日配额, 60 = 分钟配额。';

CREATE UNIQUE INDEX idx_quota_scope ON quota_configs (tenant_id, scope_type, scope_id, resource_type)
    WHERE scope_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2.12 配额使用记录表 (quota_usage)
-- 设计意图：记录实时配额消耗，支持 QuotaManager.check() 查询。
-- 3NF 说明：从 quota_configs 分离，消除配额定义与使用量的混合依赖。
-- 关系：多对一 → quota_configs。
-- ----------------------------------------------------------------------------
CREATE TABLE quota_usage (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    quota_config_id UUID            NOT NULL REFERENCES quota_configs(id),
    scope_id        VARCHAR(128)    NOT NULL,
    used_value      BIGINT          NOT NULL DEFAULT 0,
    window_start    TIMESTAMPTZ     NOT NULL,
    window_end      TIMESTAMPTZ     NOT NULL,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE quota_usage IS '配额使用量追踪表。每个时间窗口一条记录，支持原子自增。';

CREATE UNIQUE INDEX idx_quota_usage_window ON quota_usage (quota_config_id, scope_id, window_start);
CREATE INDEX idx_quota_usage_tenant ON quota_usage (tenant_id);


-- ============================================================================
-- 第三部分：可审计模块 (Audit)
-- ============================================================================
-- PRD 5.2 节。AuditEvent 的持久化存储，支持 AuditSink(queryable=true) 的查询。

-- ----------------------------------------------------------------------------
-- 3.1 审计事件表 (audit_events)
-- 设计意图：PRD AuditEvent 标准类型的完整持久化。审计管道不可绕过，
-- 所有经过 Gateway 的操作都会产生审计记录。
-- 关系：多对一 → tenants（逻辑关联，不设外键以保证写入性能）。
-- ----------------------------------------------------------------------------
CREATE TABLE audit_events (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL,
    timestamp       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    version         VARCHAR(10)     NOT NULL DEFAULT '1.0',

    -- 主体 (AuditActor)
    actor_type      VARCHAR(20)     NOT NULL CHECK (actor_type IN ('user', 'agent', 'system', 'api_key')),
    actor_id        VARCHAR(128)    NOT NULL,
    actor_name      VARCHAR(255),
    actor_ip        INET,
    actor_user_agent TEXT,

    -- 操作
    action          VARCHAR(255)    NOT NULL,
    category        VARCHAR(30)     NOT NULL
                        CHECK (category IN (
                            'authentication', 'authorization', 'data_access',
                            'data_mutation', 'agent_action', 'tool_execution',
                            'config_change', 'admin_action', 'system_event'
                        )),
    outcome         VARCHAR(10)     NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),

    -- 资源 (AuditResource)
    resource_type   VARCHAR(64)     NOT NULL,
    resource_id     VARCHAR(255),
    resource_name   VARCHAR(255),

    -- 来源 (AuditSource)
    source_service  VARCHAR(64)     NOT NULL,
    source_instance VARCHAR(255),
    request_id      VARCHAR(128)    NOT NULL,

    -- 详情
    details         JSONB,
    duration_ms     INTEGER,
    error_message   TEXT
);

COMMENT ON TABLE audit_events IS '审计事件表。PRD AuditEvent 的完整映射。审计管道不可绕过，此表是合规审计的核心。';
COMMENT ON COLUMN audit_events.category IS '审计类别枚举，对应 PRD AuditCategory 类型。';
COMMENT ON COLUMN audit_events.request_id IS '请求链路 ID，用于跨模块追踪同一次请求产生的所有审计事件。';
COMMENT ON COLUMN audit_events.details IS '额外详情（JSONB），不同 action 可携带不同结构的上下文数据。';

-- 审计表以时间为主要查询维度，使用 BRIN 索引提升范围查询性能
CREATE INDEX idx_audit_tenant_time ON audit_events (tenant_id, timestamp DESC);
CREATE INDEX idx_audit_category ON audit_events (tenant_id, category, timestamp DESC);
CREATE INDEX idx_audit_actor ON audit_events (tenant_id, actor_id, timestamp DESC);
CREATE INDEX idx_audit_action ON audit_events (tenant_id, action, timestamp DESC);
CREATE INDEX idx_audit_request ON audit_events (request_id);
CREATE INDEX idx_audit_timestamp_brin ON audit_events USING BRIN (timestamp);

-- 分区建议：生产环境建议按月对 audit_events 做范围分区
-- CREATE TABLE audit_events (...) PARTITION BY RANGE (timestamp);


-- ============================================================================
-- 第四部分：可协作模块 (Collaboration) — Agent、Task、Workflow、Handoff、Knowledge
-- ============================================================================
-- PRD 5.3 节。Task FSM + WorkflowEngine + HandoffManager + KnowledgeStore。

-- ----------------------------------------------------------------------------
-- 4.1 Agent 定义表 (agents)
-- 设计意图：Agent 的元数据存储。每个租户可拥有多个 Agent，
-- Agent 是 Task 和 Session 的归属实体。
-- 关系：多对一 → tenants；一对多 → tasks, runtime_instances。
-- ----------------------------------------------------------------------------
CREATE TABLE agents (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255)    NOT NULL,
    description     TEXT,
    model           VARCHAR(128),
    system_prompt   TEXT,
    tools           JSONB           NOT NULL DEFAULT '[]',
    config          JSONB           NOT NULL DEFAULT '{}',
    status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'archived')),
    created_by      VARCHAR(128),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE agents IS 'Agent 定义表。存储 Agent 元数据和配置，是 Task/Session 的归属实体。';
COMMENT ON COLUMN agents.tools IS 'Agent 可用工具列表（JSONB 数组）。';

CREATE INDEX idx_agents_status ON agents (tenant_id, status);

-- ----------------------------------------------------------------------------
-- 4.2 任务表 (tasks)
-- 设计意图：PRD Task 实体的完整映射。Task 的状态由 FSM 严格管理，
-- state 列只能通过合法状态转换更新。
-- 关系：多对一 → tenants, agents；自引用（parent_task_id → tasks）表示子任务。
-- ----------------------------------------------------------------------------
CREATE TABLE tasks (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    agent_id        VARCHAR(128)    NOT NULL,
    session_key     VARCHAR(255),
    parent_task_id  UUID            REFERENCES tasks(id),

    type            VARCHAR(30)     NOT NULL
                        CHECK (type IN ('llm_call', 'tool_execution', 'workflow_step', 'message_delivery', 'custom')),
    state           VARCHAR(20)     NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'queued', 'running', 'paused', 'completed', 'failed', 'killed', 'timeout')),

    input           JSONB,
    output          JSONB,
    error_code      VARCHAR(64),
    error_message   TEXT,

    priority        VARCHAR(10)     NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('high', 'normal', 'low')),
    timeout_ms      INTEGER         NOT NULL DEFAULT 60000,
    max_attempts    INTEGER         NOT NULL DEFAULT 3,
    attempt_count   INTEGER         NOT NULL DEFAULT 0,
    idempotency_key VARCHAR(255),

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, id)
);

COMMENT ON TABLE tasks IS '任务表。PRD Task 实体的完整映射，state 由 TaskFSM 严格管理，只允许合法转换。';
COMMENT ON COLUMN tasks.state IS 'FSM 状态。合法转换见 PRD "合法状态转换表"。应用层通过 StateMachine.transition() 更新。';
COMMENT ON COLUMN tasks.parent_task_id IS '父任务 ID。支持任务嵌套（如工作流步骤创建子任务）。自引用一对多。';
COMMENT ON COLUMN tasks.idempotency_key IS '幂等键。用于队列层面去重，防止重复创建同一任务。';

CREATE INDEX idx_tasks_tenant_state ON tasks (tenant_id, state);
CREATE INDEX idx_tasks_agent ON tasks (tenant_id, agent_id, state);
CREATE INDEX idx_tasks_parent ON tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX idx_tasks_idempotency ON tasks (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4.3 任务状态转换历史表 (task_state_transitions)
-- 设计意图：PRD TaskStateTransition 的持久化。记录 Task 的完整状态变迁轨迹，
-- 支持审计追踪和问题诊断。
-- 3NF 说明：从 tasks 表中分离 stateHistory[]，消除重复组。
-- 关系：多对一 → tasks。
-- ----------------------------------------------------------------------------
CREATE TABLE task_state_transitions (
    id              BIGSERIAL       PRIMARY KEY,
    task_id         UUID            NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    from_state      VARCHAR(20)     NOT NULL,
    to_state        VARCHAR(20)     NOT NULL,
    event           VARCHAR(30)     NOT NULL,
    reason          TEXT,
    actor           VARCHAR(128)    NOT NULL,
    timestamp       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE task_state_transitions IS '任务状态转换历史表。记录 Task 每次 FSM 状态转换，不可变追加。';
COMMENT ON COLUMN task_state_transitions.event IS '触发转换的事件名（如 enqueue/start/complete/fail/kill）。';
COMMENT ON COLUMN task_state_transitions.actor IS '触发者标识："system" 或具体 userId。';

CREATE INDEX idx_task_transitions_task ON task_state_transitions (task_id, timestamp);

-- ----------------------------------------------------------------------------
-- 4.4 工作流定义表 (workflow_definitions)
-- 设计意图：PRD WorkflowDefinition 的持久化。工作流定义是模板，可被实例化多次。
-- 关系：多对一 → tenants；一对多 → workflow_steps, workflow_transitions, workflow_instances。
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_definitions (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    name            VARCHAR(255)    NOT NULL,
    description     TEXT,
    version         INTEGER         NOT NULL DEFAULT 1,
    timeout_ms      INTEGER,
    error_handler_step_id VARCHAR(128),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, id, version)
);

COMMENT ON TABLE workflow_definitions IS '工作流定义表。PRD WorkflowDefinition 的持久化，支持多版本管理。';
COMMENT ON COLUMN workflow_definitions.version IS '定义版本号。同一工作流可有多个版本，实例创建时绑定特定版本。';

-- ----------------------------------------------------------------------------
-- 4.5 工作流步骤表 (workflow_steps)
-- 设计意图：PRD WorkflowStep 的持久化。从 WorkflowDefinition.steps[] 拆出，
-- 符合 3NF（消除数组重复组）。
-- 关系：多对一 → workflow_definitions。
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_steps (
    id              VARCHAR(128)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL,
    workflow_id     VARCHAR(128)    NOT NULL,
    workflow_version INTEGER        NOT NULL,
    step_order      INTEGER         NOT NULL,
    type            VARCHAR(30)     NOT NULL
                        CHECK (type IN ('agent_task', 'human_review', 'condition', 'parallel', 'wait_signal')),
    config          JSONB           NOT NULL DEFAULT '{}',
    timeout_ms      INTEGER,

    PRIMARY KEY (tenant_id, workflow_id, workflow_version, id),
    FOREIGN KEY (tenant_id, workflow_id, workflow_version)
        REFERENCES workflow_definitions(tenant_id, id, version) ON DELETE CASCADE
);

COMMENT ON TABLE workflow_steps IS '工作流步骤表。从 WorkflowDefinition.steps[] 规范化拆出。';
COMMENT ON COLUMN workflow_steps.type IS '步骤类型。human_review 会暂停工作流等待外部 signal 注入。';
COMMENT ON COLUMN workflow_steps.step_order IS '步骤在工作流中的执行顺序。';

-- ----------------------------------------------------------------------------
-- 4.6 工作流转换表 (workflow_transitions)
-- 设计意图：PRD WorkflowTransition 的持久化。定义步骤之间的跳转关系。
-- 关系：多对一 → workflow_definitions。
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_transitions (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL,
    workflow_id     VARCHAR(128)    NOT NULL,
    workflow_version INTEGER        NOT NULL,
    from_step_id    VARCHAR(128)    NOT NULL,
    to_step_id      VARCHAR(128)    NOT NULL,
    condition_expr  TEXT,

    FOREIGN KEY (tenant_id, workflow_id, workflow_version)
        REFERENCES workflow_definitions(tenant_id, id, version) ON DELETE CASCADE
);

COMMENT ON TABLE workflow_transitions IS '工作流转换表。定义步骤间的跳转和条件分支。';
COMMENT ON COLUMN workflow_transitions.condition_expr IS '条件表达式。满足条件时执行此转换，NULL 表示无条件转换。';

-- ----------------------------------------------------------------------------
-- 4.7 工作流实例表 (workflow_instances)
-- 设计意图：PRD WorkflowInstance 的持久化。每次 startWorkflow() 创建一个实例，
-- 断点恢复依赖此表和 checkpoints 表。
-- 关系：多对一 → workflow_definitions, tenants。
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_instances (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL,
    workflow_id     VARCHAR(128)    NOT NULL,
    workflow_version INTEGER        NOT NULL,
    state           VARCHAR(20)     NOT NULL DEFAULT 'running'
                        CHECK (state IN ('running', 'waiting_signal', 'completed', 'failed', 'killed')),
    current_step_id VARCHAR(128),
    input           JSONB,
    output          JSONB,
    error_message   TEXT,
    started_by      VARCHAR(128),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, workflow_id, workflow_version)
        REFERENCES workflow_definitions(tenant_id, id, version)
);

COMMENT ON TABLE workflow_instances IS '工作流实例表。每次 startWorkflow() 创建，支持断点恢复。';
COMMENT ON COLUMN workflow_instances.state IS '实例状态。waiting_signal 表示等待外部信号（如 human_review 步骤）。';

CREATE INDEX idx_wf_instances_tenant ON workflow_instances (tenant_id, state);

-- ----------------------------------------------------------------------------
-- 4.8 工作流步骤执行结果表 (workflow_step_results)
-- 设计意图：记录工作流实例中每个步骤的执行结果。
-- 3NF 说明：从 workflow_instances.stepResults[] 拆出。
-- 关系：多对一 → workflow_instances。
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_step_results (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id     UUID            NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    step_id         VARCHAR(128)    NOT NULL,
    status          VARCHAR(20)     NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
    result          JSONB,
    error_message   TEXT,
    started_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

COMMENT ON TABLE workflow_step_results IS '工作流步骤执行结果表。记录每个步骤的输出，支持断点恢复时跳过已完成步骤。';

CREATE INDEX idx_wf_step_results_instance ON workflow_step_results (instance_id);

-- ----------------------------------------------------------------------------
-- 4.9 人机转交表 (handoff_requests)
-- 设计意图：PRD HandoffManager 接口的持久化。当 Agent 需要人类介入时，
-- 创建一条 handoff 请求，等待人类接管或返回结果。
-- 关系：多对一 → tenants, tasks。
-- ----------------------------------------------------------------------------
CREATE TABLE handoff_requests (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    task_id         UUID            REFERENCES tasks(id),
    session_key     VARCHAR(255),
    agent_id        VARCHAR(128)    NOT NULL,
    reason          TEXT            NOT NULL,
    priority        VARCHAR(10)     NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('high', 'normal', 'low')),
    status          VARCHAR(20)     NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'assigned', 'resolved', 'expired', 'cancelled')),
    assigned_to     VARCHAR(128),
    resolution      JSONB,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ
);

COMMENT ON TABLE handoff_requests IS '人机转交请求表。Agent 需要人类介入时创建，对应 PRD HandoffManager。';
COMMENT ON COLUMN handoff_requests.assigned_to IS '被分配处理的人类操作员 user_id。';

CREATE INDEX idx_handoff_tenant_status ON handoff_requests (tenant_id, status);

-- ----------------------------------------------------------------------------
-- 4.10 共享知识库表 (knowledge_entries)
-- 设计意图：PRD KnowledgeStore 接口的持久化。租户内多个 Agent 可共享知识条目。
-- 关系：多对一 → tenants。
-- ----------------------------------------------------------------------------
CREATE TABLE knowledge_entries (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    namespace       VARCHAR(128)    NOT NULL DEFAULT 'default',
    key             VARCHAR(512)    NOT NULL,
    content         TEXT            NOT NULL,
    content_type    VARCHAR(64)     NOT NULL DEFAULT 'text/plain',
    tags            TEXT[]          NOT NULL DEFAULT '{}',
    metadata        JSONB           NOT NULL DEFAULT '{}',
    created_by      VARCHAR(128),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE knowledge_entries IS '共享知识库表。对应 PRD KnowledgeStore，支持租户内跨 Agent 知识共享。';

CREATE UNIQUE INDEX idx_knowledge_key ON knowledge_entries (tenant_id, namespace, key);
CREATE INDEX idx_knowledge_tags ON knowledge_entries USING GIN (tags);


-- ============================================================================
-- 第五部分：消息队列持久化 (Queue Backend)
-- ============================================================================
-- PRD 4.2 节 QueueBackend 的 PostgreSQL 实现（当不使用 Redis/BullMQ 时）。

-- ----------------------------------------------------------------------------
-- 5.1 队列消息表 (queue_messages)
-- 设计意图：QueueBackend 的 PG 实现（PostgresQueueBackend）。
-- 使用 SELECT ... FOR UPDATE SKIP LOCKED 模式实现并发安全的消息消费。
-- 关系：多对一 → tenants（逻辑关联）。
-- ----------------------------------------------------------------------------
CREATE TABLE queue_messages (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL,
    queue           VARCHAR(128)    NOT NULL,
    type            VARCHAR(128)    NOT NULL,
    payload         JSONB           NOT NULL,
    priority        VARCHAR(10)     NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('high', 'normal', 'low')),
    state           VARCHAR(20)     NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
    attempts        INTEGER         NOT NULL DEFAULT 0,
    max_attempts    INTEGER         NOT NULL DEFAULT 3,
    idempotency_key VARCHAR(255),
    scheduled_at    TIMESTAMPTZ,
    visible_after   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    processing_deadline TIMESTAMPTZ,
    metadata        JSONB,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE queue_messages IS 'QueueBackend 的 PG 实现。使用 SKIP LOCKED 模式实现并发安全的消息消费。';
COMMENT ON COLUMN queue_messages.state IS '消息状态。pending→processing→completed 或 pending→processing→failed→dead_letter。';
COMMENT ON COLUMN queue_messages.visible_after IS '消息可见时间。用于实现延迟队列（scheduledAt）和 visibility timeout。';
COMMENT ON COLUMN queue_messages.processing_deadline IS '处理超时截止时间。超过此时间自动 nack（由定时任务回收）。';
COMMENT ON COLUMN queue_messages.idempotency_key IS '幂等键。在 TTL 内相同 key 的消息不重复入队。';

CREATE INDEX idx_queue_dequeue ON queue_messages (queue, state, priority, visible_after, created_at)
    WHERE state = 'pending';
CREATE INDEX idx_queue_tenant ON queue_messages (tenant_id, queue, state);
CREATE INDEX idx_queue_idempotency ON queue_messages (queue, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND state NOT IN ('completed', 'dead_letter');
CREATE INDEX idx_queue_processing_timeout ON queue_messages (processing_deadline)
    WHERE state = 'processing';

-- 消息消费的典型查询模式（注释说明，不执行）：
-- SELECT * FROM queue_messages
-- WHERE queue = $1 AND state = 'pending' AND visible_after <= NOW()
-- ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END, created_at
-- LIMIT 1
-- FOR UPDATE SKIP LOCKED;


-- ============================================================================
-- 第六部分：可嵌入模块 (Embedding) — API Key、限流、消息信封
-- ============================================================================
-- PRD 5.4 节。REST API 嵌入、API Key 管理、限流。

-- ----------------------------------------------------------------------------
-- 6.1 API Key 表 (api_keys)
-- 设计意图：PRD ApiKeyManager 接口的持久化。支持 API Key 的生命周期管理。
-- 关系：多对一 → tenants, users。
-- ----------------------------------------------------------------------------
CREATE TABLE api_keys (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    user_id         VARCHAR(128),
    name            VARCHAR(255)    NOT NULL,
    key_prefix      VARCHAR(16)     NOT NULL,
    key_hash        VARCHAR(128)    NOT NULL,
    scopes          TEXT[]          NOT NULL DEFAULT '{}',
    status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked', 'expired')),
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id)
);

COMMENT ON TABLE api_keys IS 'API Key 管理表。key_hash 存储哈希值，明文只在创建时返回一次。';
COMMENT ON COLUMN api_keys.key_prefix IS 'Key 的前缀（如 "oc_live_"），用于快速识别 Key 类型，不存储完整明文。';
COMMENT ON COLUMN api_keys.key_hash IS 'Key 的 SHA-256 哈希值。验证时对比哈希，不可逆。';
COMMENT ON COLUMN api_keys.scopes IS '此 Key 允许的操作范围（如 ["sessions.send", "config.get"]）。';

CREATE UNIQUE INDEX idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id, status);
CREATE INDEX idx_api_keys_prefix ON api_keys (key_prefix);

-- ----------------------------------------------------------------------------
-- 6.2 限流配置表 (rate_limit_configs)
-- 设计意图：PRD RateLimiter 接口的配置持久化。按租户/用户/资源维度定义限流规则。
-- 关系：多对一 → tenants。
-- ----------------------------------------------------------------------------
CREATE TABLE rate_limit_configs (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    scope_type      VARCHAR(20)     NOT NULL CHECK (scope_type IN ('tenant', 'user', 'api_key', 'ip')),
    scope_id        VARCHAR(255),
    resource        VARCHAR(64)     NOT NULL DEFAULT 'api',
    action          VARCHAR(128),
    max_requests    INTEGER         NOT NULL,
    window_seconds  INTEGER         NOT NULL,
    burst_limit     INTEGER,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE rate_limit_configs IS '限流配置表。对应 PRD RateLimiter 的 RateLimitKey 维度设计。';
COMMENT ON COLUMN rate_limit_configs.scope_type IS '限流粒度：tenant=租户级, user=用户级, api_key=按Key, ip=按IP。';
COMMENT ON COLUMN rate_limit_configs.burst_limit IS '突发限额。允许瞬时超过 max_requests 的峰值请求数（令牌桶算法）。';

CREATE INDEX idx_rate_limit_tenant ON rate_limit_configs (tenant_id, scope_type, resource, is_active);

-- ----------------------------------------------------------------------------
-- 6.3 消息信封表 (message_envelopes)
-- 设计意图：PRD MessageEnvelope 的持久化。记录所有进出 Agent 的消息，
-- 支持消息追溯和重放。
-- 关系：多对一 → tenants, agents。
-- ----------------------------------------------------------------------------
CREATE TABLE message_envelopes (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL,
    version         VARCHAR(10)     NOT NULL DEFAULT '1.0',
    timestamp       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- 来源
    source_type     VARCHAR(20)     NOT NULL CHECK (source_type IN ('user', 'agent', 'system', 'webhook')),
    source_id       VARCHAR(128)    NOT NULL,
    source_channel  VARCHAR(64),

    -- 目标
    target_agent_id VARCHAR(128)    NOT NULL,
    target_session_key VARCHAR(255),

    -- 内容
    content_type    VARCHAR(20)     NOT NULL CHECK (content_type IN ('text', 'rich', 'command', 'event')),
    content_text    TEXT,
    content_rich    JSONB,
    content_command JSONB,
    attachments     JSONB,

    -- 元数据
    metadata        JSONB,
    idempotency_key VARCHAR(255),
    reply_to        UUID            REFERENCES message_envelopes(id)
);

COMMENT ON TABLE message_envelopes IS '统一消息信封表。PRD MessageEnvelope 的持久化，通道无关的统一消息格式。';
COMMENT ON COLUMN message_envelopes.source_channel IS '消息来源通道（如 telegram/slack/web）。Channel Adapter 负责转换。';
COMMENT ON COLUMN message_envelopes.reply_to IS '回复引用。自引用外键，支持消息回复链。';

CREATE INDEX idx_envelopes_tenant ON message_envelopes (tenant_id, timestamp DESC);
CREATE INDEX idx_envelopes_session ON message_envelopes (tenant_id, target_agent_id, target_session_key, timestamp);
CREATE INDEX idx_envelopes_idempotency ON message_envelopes (idempotency_key) WHERE idempotency_key IS NOT NULL;


-- ============================================================================
-- 第七部分：可隔离模块 (Isolation) — Agent 运行时实例
-- ============================================================================
-- PRD 5.5 节。AgentRuntimeBackend 管理的运行时实例记录。

-- ----------------------------------------------------------------------------
-- 7.1 运行时实例表 (runtime_instances)
-- 设计意图：PRD RuntimeInstance / RuntimeStatus 的持久化。记录每个 Agent
-- 运行时实例的生命周期和资源使用情况。
-- 关系：多对一 → tenants, agents。
-- ----------------------------------------------------------------------------
CREATE TABLE runtime_instances (
    id              VARCHAR(255)    PRIMARY KEY,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    agent_id        VARCHAR(128)    NOT NULL,
    session_key     VARCHAR(255),
    runtime_type    VARCHAR(30)     NOT NULL
                        CHECK (runtime_type IN ('inprocess', 'docker', 'kubernetes')),
    state           VARCHAR(20)     NOT NULL DEFAULT 'creating'
                        CHECK (state IN ('creating', 'running', 'stopping', 'stopped', 'failed')),

    -- 隔离规格 (RuntimeSpec.isolation)
    network_mode    VARCHAR(20)     NOT NULL DEFAULT 'none'
                        CHECK (network_mode IN ('none', 'allowlist', 'full')),
    allowed_hosts   TEXT[],
    fs_access       VARCHAR(20)     NOT NULL DEFAULT 'none'
                        CHECK (fs_access IN ('none', 'readonly', 'readwrite')),
    cpu_millicores  INTEGER,
    memory_mb       INTEGER,
    max_disk_bytes  BIGINT,

    -- 运行时元数据
    image           VARCHAR(512),
    container_id    VARCHAR(255),
    pod_name        VARCHAR(255),
    env_vars        JSONB,
    labels          JSONB,

    -- 资源使用快照
    cpu_percent     REAL,
    memory_usage_mb REAL,
    network_rx_bytes BIGINT         DEFAULT 0,
    network_tx_bytes BIGINT         DEFAULT 0,

    -- 生命周期
    timeout_ms      INTEGER,
    idle_timeout_ms INTEGER,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    stopped_at      TIMESTAMPTZ,

    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, id)
);

COMMENT ON TABLE runtime_instances IS 'Agent 运行时实例表。对应 PRD AgentRuntimeBackend 管理的实例生命周期。';
COMMENT ON COLUMN runtime_instances.runtime_type IS '运行时类型：inprocess（进程内）/ docker（容器）/ kubernetes（Pod）。';
COMMENT ON COLUMN runtime_instances.network_mode IS '网络隔离模式。allowlist 时需配合 allowed_hosts 使用。';

CREATE INDEX idx_runtime_tenant_state ON runtime_instances (tenant_id, state);
CREATE INDEX idx_runtime_agent ON runtime_instances (tenant_id, agent_id, state);


-- ============================================================================
-- 第八部分：可靠性模块 (Reliability) — 检查点、熔断器、平台事件
-- ============================================================================
-- PRD 5.6 节。CheckpointManager、CircuitBreaker 状态、平台事件持久化。

-- ----------------------------------------------------------------------------
-- 8.1 检查点表 (checkpoints)
-- 设计意图：PRD TaskCheckpoint 的持久化。支持长任务的断点恢复。
-- 关系：多对一 → tenants, tasks。
-- ----------------------------------------------------------------------------
CREATE TABLE checkpoints (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    task_id         UUID            NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_index      INTEGER         NOT NULL,
    state           JSONB           NOT NULL,
    completed_steps TEXT[]          NOT NULL DEFAULT '{}',
    pending_steps   TEXT[]          NOT NULL DEFAULT '{}',
    metadata        JSONB,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE checkpoints IS '任务检查点表。对应 PRD TaskCheckpoint，支持长任务断点恢复。';
COMMENT ON COLUMN checkpoints.state IS '序列化的运行时状态（JSONB）。恢复时反序列化为内存对象。';
COMMENT ON COLUMN checkpoints.completed_steps IS '已完成步骤 ID 列表。恢复时跳过这些步骤。';

CREATE INDEX idx_checkpoints_task ON checkpoints (task_id, created_at DESC);
CREATE INDEX idx_checkpoints_tenant ON checkpoints (tenant_id);

-- ----------------------------------------------------------------------------
-- 8.2 熔断器状态表 (circuit_breaker_states)
-- 设计意图：持久化 CircuitBreaker 的状态，多实例场景下共享熔断状态。
-- 关系：多对一 → tenants。
-- ----------------------------------------------------------------------------
CREATE TABLE circuit_breaker_states (
    id              VARCHAR(255)    PRIMARY KEY,
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    target          VARCHAR(255)    NOT NULL,
    state           VARCHAR(15)     NOT NULL DEFAULT 'closed'
                        CHECK (state IN ('closed', 'open', 'half-open')),
    failure_count   INTEGER         NOT NULL DEFAULT 0,
    success_count   INTEGER         NOT NULL DEFAULT 0,
    total_requests  BIGINT          NOT NULL DEFAULT 0,
    failure_threshold INTEGER       NOT NULL DEFAULT 5,
    reset_timeout_ms INTEGER        NOT NULL DEFAULT 30000,
    last_failure_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    opened_at       TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE circuit_breaker_states IS '熔断器状态表。多实例部署时共享熔断状态，避免各实例独立计数。';
COMMENT ON COLUMN circuit_breaker_states.target IS '被保护的目标标识（如 "llm-provider:openai", "tool:web-search"）。';

CREATE INDEX idx_cb_tenant ON circuit_breaker_states (tenant_id, target);

-- ----------------------------------------------------------------------------
-- 8.3 平台事件表 (platform_events)
-- 设计意图：PRD PlatformEvent 的持久化。EventBus 的 PG 实现可将事件
-- 持久化到此表，支持事件回放和审计。
-- 关系：多对一 → tenants（逻辑关联）。
-- ----------------------------------------------------------------------------
CREATE TABLE platform_events (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    type            VARCHAR(255)    NOT NULL,
    tenant_id       VARCHAR(64)     NOT NULL,
    source          VARCHAR(128)    NOT NULL,
    timestamp       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    data            JSONB           NOT NULL,
    metadata        JSONB,
    processed       BOOLEAN         NOT NULL DEFAULT FALSE,
    processed_at    TIMESTAMPTZ
);

COMMENT ON TABLE platform_events IS '平台事件持久化表。EventBus 的 PG 存储，支持事件回放和消费追踪。';
COMMENT ON COLUMN platform_events.type IS '事件类型标识，如 "audit.operation"、"task.state.changed"、"agent.health"。';
COMMENT ON COLUMN platform_events.source IS '产生事件的模块标识。';
COMMENT ON COLUMN platform_events.processed IS '事件是否已被所有订阅者处理。用于"至少一次"投递保证。';

CREATE INDEX idx_events_type ON platform_events (type, timestamp DESC);
CREATE INDEX idx_events_tenant ON platform_events (tenant_id, type, timestamp DESC);
CREATE INDEX idx_events_unprocessed ON platform_events (processed, timestamp) WHERE processed = FALSE;
CREATE INDEX idx_events_timestamp_brin ON platform_events USING BRIN (timestamp);


-- ============================================================================
-- 第九部分：会话管理 (Sessions)
-- ============================================================================
-- 会话是 Agent 与用户交互的核心载体，在企业版中需要持久化和多租户隔离。

-- ----------------------------------------------------------------------------
-- 9.1 会话表 (sessions)
-- 设计意图：将现有内存/文件 Session 存储迁移到结构化表，
-- 支持多租户隔离、分页查询和审计关联。
-- 关系：多对一 → tenants, agents, users。
-- ----------------------------------------------------------------------------
CREATE TABLE sessions (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       VARCHAR(64)     NOT NULL REFERENCES tenants(id),
    session_key     VARCHAR(255)    NOT NULL,
    agent_id        VARCHAR(128)    NOT NULL,
    user_id         VARCHAR(128),
    title           VARCHAR(512),
    status          VARCHAR(20)     NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived', 'deleted')),
    message_count   INTEGER         NOT NULL DEFAULT 0,
    token_count     BIGINT          NOT NULL DEFAULT 0,
    metadata        JSONB           NOT NULL DEFAULT '{}',
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, id)
);

COMMENT ON TABLE sessions IS '会话表。Agent 与用户交互的核心载体，支持多租户隔离。';

CREATE UNIQUE INDEX idx_sessions_key ON sessions (tenant_id, session_key);
CREATE INDEX idx_sessions_agent ON sessions (tenant_id, agent_id, status);
CREATE INDEX idx_sessions_user ON sessions (tenant_id, user_id, status) WHERE user_id IS NOT NULL;

-- RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sessions ON sessions
    USING (tenant_id = current_setting('openclaw.tenant_id', true));

-- ----------------------------------------------------------------------------
-- 9.2 会话消息表 (session_messages)
-- 设计意图：会话内的消息历史。从 session 的 messages[] 数组拆出，
-- 符合 3NF（消除重复组），支持高效分页查询。
-- 关系：多对一 → sessions。
-- ----------------------------------------------------------------------------
CREATE TABLE session_messages (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID            NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tenant_id       VARCHAR(64)     NOT NULL,
    role            VARCHAR(20)     NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         TEXT,
    tool_calls      JSONB,
    tool_results    JSONB,
    token_count     INTEGER,
    metadata        JSONB,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE session_messages IS '会话消息表。从 session 的 messages[] 规范化拆出，支持高效分页和 token 统计。';
COMMENT ON COLUMN session_messages.role IS '消息角色：user（用户输入）/ assistant（Agent 回复）/ system / tool（工具结果）。';

CREATE INDEX idx_session_msgs_session ON session_messages (session_id, created_at);
CREATE INDEX idx_session_msgs_tenant ON session_messages (tenant_id, created_at DESC);

-- RLS
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_session_msgs ON session_messages
    USING (tenant_id = current_setting('openclaw.tenant_id', true));


-- ============================================================================
-- 第十部分：数据库迁移管理
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 10.1 迁移版本追踪表 (schema_migrations)
-- 设计意图：记录已执行的数据库迁移，防止重复执行。
-- 对应技术方案中 kernel-impl/postgres/migrations/ 的版本管理。
-- ----------------------------------------------------------------------------
CREATE TABLE schema_migrations (
    version         VARCHAR(128)    PRIMARY KEY,
    name            VARCHAR(255)    NOT NULL,
    executed_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    checksum        VARCHAR(64),
    execution_ms    INTEGER
);

COMMENT ON TABLE schema_migrations IS '数据库迁移版本追踪表。记录已执行的 DDL 迁移，确保幂等。';


-- ============================================================================
-- 附录：RLS 策略、通用触发器、辅助函数
-- ============================================================================

-- 自动更新 updated_at 的触发器函数
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有需要 updated_at 自动更新的表创建触发器
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'tenants', 'enterprise_kv', 'users', 'roles',
            'policy_definitions', 'content_filter_rules', 'quota_configs',
            'agents', 'tasks', 'workflow_definitions', 'workflow_instances',
            'handoff_requests', 'knowledge_entries', 'api_keys',
            'rate_limit_configs', 'runtime_instances', 'circuit_breaker_states',
            'sessions'
        ])
    LOOP
        EXECUTE format(
            'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
            tbl
        );
    END LOOP;
END;
$$;

-- 清理过期分布式锁的函数（由定时任务调用）
CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM distributed_locks WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_locks IS '清理过期的分布式锁。建议通过 pg_cron 或外部定时器每 5 秒调用一次。';

-- 回收超时处理中的队列消息（visibility timeout 过期）
CREATE OR REPLACE FUNCTION reclaim_timed_out_queue_messages()
RETURNS INTEGER AS $$
DECLARE
    reclaimed_count INTEGER;
BEGIN
    UPDATE queue_messages
    SET state = 'pending',
        visible_after = NOW(),
        processing_deadline = NULL,
        attempts = attempts + 1,
        updated_at = NOW()
    WHERE state = 'processing'
      AND processing_deadline < NOW()
      AND attempts < max_attempts;

    GET DIAGNOSTICS reclaimed_count = ROW_COUNT;

    -- 将超过最大重试次数的消息移入死信
    UPDATE queue_messages
    SET state = 'dead_letter', updated_at = NOW()
    WHERE state = 'processing'
      AND processing_deadline < NOW()
      AND attempts >= max_attempts;

    RETURN reclaimed_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reclaim_timed_out_queue_messages IS '回收处理超时的队列消息。超过 max_attempts 的进入死信队列。建议每 10 秒调用。';


-- ============================================================================
-- 表关系总结 (ER Summary)
-- ============================================================================
--
-- 一对多关系：
--   tenants          1 ──→ N  users, agents, roles, permissions, policy_definitions,
--                              content_filter_rules, quota_configs, api_keys, rate_limit_configs,
--                              sessions, audit_events, tasks, workflow_definitions, ...
--   agents           1 ──→ N  tasks, runtime_instances, sessions
--   tasks            1 ──→ N  task_state_transitions, checkpoints
--   tasks            1 ──→ N  tasks (self-ref: parent_task_id，子任务)
--   sessions         1 ──→ N  session_messages
--   policy_definitions 1 ──→ N  policy_rules
--   workflow_definitions 1 ──→ N  workflow_steps, workflow_transitions, workflow_instances
--   workflow_instances 1 ──→ N  workflow_step_results
--   quota_configs    1 ──→ N  quota_usage
--   message_envelopes 1 ──→ N  message_envelopes (self-ref: reply_to，回复链)
--
-- 多对多关系（通过联结表）：
--   roles     N ←──→ N  permissions   （通过 role_permissions）
--   users     N ←──→ N  roles         （通过 user_role_assignments）
--   users     N ←──→ N  user_groups   （通过 user_group_members）
--
-- 自引用关系：
--   tasks.parent_task_id          → tasks.id        （子任务层级）
--   user_groups.parent_group_id   → user_groups.id  （组层级）
--   message_envelopes.reply_to    → message_envelopes.id （消息回复链）
--
