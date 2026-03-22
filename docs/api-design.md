# OpenClaw Enterprise — RESTful API 设计文档

> **版本**：v1.0
> **日期**：2026-03-21
> **基于**：PRD v1.0 + 技术实现方案（方案一）+ database-schema.sql + rls-policies.sql
> **状态**：Draft

---

## 总览

### 基础信息

| 项目 | 说明 |
|------|------|
| **基础路径** | `/api/v1` |
| **认证方式** | `Authorization: Bearer <token>`（支持 OIDC / Token / API Key） |
| **租户标识** | 通过认证中间件自动注入 `TenantContext`，无需显式传递 |
| **内容类型** | `Content-Type: application/json` |
| **通用响应头** | `X-Request-Id`, `X-RateLimit-Remaining`, `X-RateLimit-Limit`, `X-RateLimit-Reset` |

### 中间件链

每个请求依次经过以下中间件（PRD 第 6.2 节）：

```
Request → AuthN → TenantContext → AuthZ → RateLimit → [Handler] → ContentFilter → Audit → Response
```

### API 端点总览

本文档共覆盖 **25 个资源域、约 100 个端点**，按 PRD 六维架构模块组织：

| 模块 | 资源域 | 端点数 |
|------|--------|--------|
| 认证与身份 | Auth | 5 |
| 内核层 | Tenants, KV Store | 10 |
| 可治理 (Governance) | Users, Roles, Permissions, Groups, Policies, Content Filters, Quotas, AuthZ | 40 |
| 可审计 (Audit) | Audit Events, Audit Metrics | 3 |
| 可协作 (Collaboration) | Agents, Sessions, Tasks, Workflows, Handoffs, Knowledge | 30 |
| 可嵌入 (Embedding) | API Keys, Rate Limits, Messages | 10 |
| 可隔离 (Isolation) | Runtime Instances | 7 |
| 可靠性 (Reliability) | Queues, Checkpoints, Circuit Breakers, Health, Metrics, Events | 15 |

---

## 一、认证与身份 (Authentication)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| POST | `/api/v1/auth/login` | 用户登录（Token/Password 模式） | 公开 |
| POST | `/api/v1/auth/logout` | 用户登出，吊销当前令牌 | 已认证 |
| POST | `/api/v1/auth/refresh` | 刷新访问令牌 | 已认证 |
| GET | `/api/v1/auth/me` | 获取当前用户身份信息 | 已认证 |
| POST | `/api/v1/auth/oidc/callback` | OIDC 认证回调 | 公开 |

### POST `/api/v1/auth/login`

**功能**：用户登录，获取访问令牌。

**Request Body**：

```json
{
  "grant_type": "password",
  "username": "admin@company.com",
  "password": "********",
  "token": "oc_live_xxxxx"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `grant_type` | string | 是 | `"password"` / `"token"` / `"client_credentials"` |
| `username` | string | 条件 | `grant_type=password` 时必填 |
| `password` | string | 条件 | `grant_type=password` 时必填 |
| `token` | string | 条件 | `grant_type=token` 时必填 |

**Response Body (200)**：

```json
{
  "access_token": "eyJhbGci...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBpcyBh...",
  "identity": {
    "user_id": "u_01HXYZ",
    "tenant_id": "acme-corp",
    "email": "admin@company.com",
    "display_name": "Admin User",
    "roles": ["admin"],
    "groups": ["engineering"]
  }
}
```

### POST `/api/v1/auth/logout`

**功能**：登出并吊销当前令牌。

**Request Body**：无

**Response Body (204)**：无内容

### POST `/api/v1/auth/refresh`

**功能**：使用刷新令牌获取新的访问令牌。

**Request Body**：

```json
{
  "refresh_token": "dGhpcyBpcyBh..."
}
```

**Response Body (200)**：

```json
{
  "access_token": "eyJhbGci...(new)",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBpcyBh...(new)"
}
```

### GET `/api/v1/auth/me`

**功能**：获取当前已认证用户的身份信息。

**Response Body (200)**：

```json
{
  "user_id": "u_01HXYZ",
  "tenant_id": "acme-corp",
  "email": "admin@company.com",
  "display_name": "Admin User",
  "roles": ["admin"],
  "groups": ["engineering"],
  "metadata": {}
}
```

---

## 二、租户管理 (Tenants)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/tenants/current` | 获取当前租户信息 | 已认证 |
| PUT | `/api/v1/tenants/current` | 更新当前租户信息 | admin |
| POST | `/api/v1/tenants` | 创建新租户 | system |
| GET | `/api/v1/tenants/:tenantId` | 获取指定租户信息 | system |

### GET `/api/v1/tenants/current`

**功能**：获取当前认证用户所属租户的详情。

**Response Body (200)**：

```json
{
  "id": "acme-corp",
  "name": "acme-corp",
  "display_name": "ACME Corporation",
  "status": "active",
  "settings": {
    "default_model": "gpt-4",
    "features": { "audit": true, "rbac": true }
  },
  "created_at": "2026-03-01T00:00:00Z",
  "updated_at": "2026-03-20T12:00:00Z"
}
```

### PUT `/api/v1/tenants/current`

**功能**：更新当前租户的信息和配置。

**Request Body**：

```json
{
  "display_name": "ACME Corp International",
  "settings": {
    "default_model": "gpt-4o",
    "features": { "audit": true, "rbac": true, "isolation": true }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `display_name` | string | 否 | 租户显示名称 |
| `settings` | object | 否 | 租户级配置（JSONB） |

**Response Body (200)**：

```json
{
  "id": "acme-corp",
  "name": "acme-corp",
  "display_name": "ACME Corp International",
  "status": "active",
  "settings": { "..." : "..." },
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/tenants`

**功能**：创建新租户。仅 system 角色可操作。

**Request Body**：

```json
{
  "id": "new-tenant",
  "name": "new-tenant",
  "display_name": "New Tenant Inc.",
  "settings": {}
}
```

**Response Body (201)**：

```json
{
  "id": "new-tenant",
  "name": "new-tenant",
  "display_name": "New Tenant Inc.",
  "status": "active",
  "settings": {},
  "created_at": "2026-03-21T10:00:00Z"
}
```

---

## 三、用户管理 (Users)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/users` | 分页列出租户内用户 | 已认证 |
| POST | `/api/v1/users` | 创建用户 | admin |
| GET | `/api/v1/users/:userId` | 获取用户详情 | 已认证 |
| PUT | `/api/v1/users/:userId` | 更新用户信息 | 自己/admin |
| DELETE | `/api/v1/users/:userId` | 删除用户（软删除 → inactive） | admin |
| GET | `/api/v1/users/:userId/roles` | 获取用户的角色列表 | 已认证 |
| POST | `/api/v1/users/:userId/roles` | 为用户分配角色 | admin |
| DELETE | `/api/v1/users/:userId/roles/:roleId` | 撤销用户的角色 | admin |
| GET | `/api/v1/users/:userId/groups` | 获取用户所属的用户组 | 已认证 |

### GET `/api/v1/users`

**功能**：分页列出租户内的用户列表。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `offset` | integer | 0 | 跳过前 N 条 |
| `limit` | integer | 20 | 每页数量（最大 100） |
| `status` | string | — | 按状态过滤：`active` / `inactive` / `locked` |
| `identity_source` | string | — | 按身份来源过滤：`local` / `oidc` / `saml` / `ldap` / `token` |
| `q` | string | — | 模糊搜索（email / display_name） |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "u_01HXYZ",
      "tenant_id": "acme-corp",
      "email": "alice@company.com",
      "display_name": "Alice",
      "identity_source": "oidc",
      "external_id": "auth0|12345",
      "status": "active",
      "metadata": {},
      "last_login_at": "2026-03-21T08:00:00Z",
      "created_at": "2026-01-15T00:00:00Z",
      "updated_at": "2026-03-21T08:00:00Z"
    }
  ],
  "total": 42,
  "has_more": true
}
```

### POST `/api/v1/users`

**功能**：创建新用户。

**Request Body**：

```json
{
  "id": "u_new001",
  "email": "bob@company.com",
  "display_name": "Bob",
  "identity_source": "local",
  "metadata": { "department": "engineering" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 用户唯一标识 |
| `email` | string | 否 | 邮箱地址 |
| `display_name` | string | 否 | 显示名称 |
| `identity_source` | string | 否 | 身份来源，默认 `"local"` |
| `external_id` | string | 否 | 外部 IdP 中的用户 ID |
| `metadata` | object | 否 | 自定义元数据 |

**Response Body (201)**：

```json
{
  "id": "u_new001",
  "tenant_id": "acme-corp",
  "email": "bob@company.com",
  "display_name": "Bob",
  "identity_source": "local",
  "status": "active",
  "metadata": { "department": "engineering" },
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### PUT `/api/v1/users/:userId`

**功能**：更新用户信息。用户可修改自己的 display_name/metadata，admin 可修改所有字段。

**Request Body**：

```json
{
  "display_name": "Bob Zhang",
  "metadata": { "department": "engineering", "title": "Senior Engineer" }
}
```

**Response Body (200)**：

```json
{
  "id": "u_new001",
  "tenant_id": "acme-corp",
  "email": "bob@company.com",
  "display_name": "Bob Zhang",
  "status": "active",
  "metadata": { "department": "engineering", "title": "Senior Engineer" },
  "updated_at": "2026-03-21T10:30:00Z"
}
```

### POST `/api/v1/users/:userId/roles`

**功能**：为用户分配角色。支持设置过期时间（临时角色提升）。

**Request Body**：

```json
{
  "role_id": "editor",
  "expires_at": "2026-06-01T00:00:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `role_id` | string | 是 | 角色 ID |
| `expires_at` | string (ISO 8601) | 否 | 角色过期时间，NULL 表示永久 |

**Response Body (201)**：

```json
{
  "user_id": "u_01HXYZ",
  "role_id": "editor",
  "assigned_by": "u_admin01",
  "assigned_at": "2026-03-21T10:00:00Z",
  "expires_at": "2026-06-01T00:00:00Z"
}
```

---

## 四、角色与权限 (RBAC)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/roles` | 列出租户内所有角色 | 已认证 |
| POST | `/api/v1/roles` | 创建角色 | admin |
| GET | `/api/v1/roles/:roleId` | 获取角色详情 | 已认证 |
| PUT | `/api/v1/roles/:roleId` | 更新角色（系统角色不可修改） | admin |
| DELETE | `/api/v1/roles/:roleId` | 删除角色（系统角色不可删除） | admin |
| GET | `/api/v1/roles/:roleId/permissions` | 获取角色的权限列表 | 已认证 |
| POST | `/api/v1/roles/:roleId/permissions` | 为角色添加权限 | admin |
| DELETE | `/api/v1/roles/:roleId/permissions/:permissionId` | 移除角色的权限 | admin |
| GET | `/api/v1/permissions` | 列出所有权限定义 | 已认证 |
| POST | `/api/v1/permissions` | 创建权限定义 | admin |

### POST `/api/v1/roles`

**功能**：创建自定义角色。

**Request Body**：

```json
{
  "id": "agent-operator",
  "name": "Agent Operator",
  "description": "Can create and manage agents, but not system config"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 角色唯一标识 |
| `name` | string | 是 | 角色显示名称 |
| `description` | string | 否 | 角色描述 |

**Response Body (201)**：

```json
{
  "id": "agent-operator",
  "tenant_id": "acme-corp",
  "name": "Agent Operator",
  "description": "Can create and manage agents, but not system config",
  "is_system": false,
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### GET `/api/v1/permissions`

**功能**：列出租户内所有权限定义。

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "perm_sessions_send",
      "tenant_id": "acme-corp",
      "action": "sessions.send",
      "resource_type": "session",
      "description": "Send messages to agent sessions",
      "created_at": "2026-03-01T00:00:00Z"
    },
    {
      "id": "perm_config_set",
      "tenant_id": "acme-corp",
      "action": "config.set",
      "resource_type": "config",
      "description": "Modify system configuration",
      "created_at": "2026-03-01T00:00:00Z"
    }
  ],
  "total": 15,
  "has_more": false
}
```

### POST `/api/v1/roles/:roleId/permissions`

**功能**：为角色添加权限。

**Request Body**：

```json
{
  "permission_id": "perm_sessions_send"
}
```

**Response Body (201)**：

```json
{
  "role_id": "agent-operator",
  "permission_id": "perm_sessions_send",
  "granted_at": "2026-03-21T10:00:00Z"
}
```

---

## 五、用户组 (User Groups)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/groups` | 列出租户内用户组 | 已认证 |
| POST | `/api/v1/groups` | 创建用户组 | admin |
| GET | `/api/v1/groups/:groupId` | 获取用户组详情 | 已认证 |
| PUT | `/api/v1/groups/:groupId` | 更新用户组 | admin |
| DELETE | `/api/v1/groups/:groupId` | 删除用户组 | admin |
| GET | `/api/v1/groups/:groupId/members` | 列出用户组成员 | 已认证 |
| POST | `/api/v1/groups/:groupId/members` | 添加成员到用户组 | admin |
| DELETE | `/api/v1/groups/:groupId/members/:userId` | 从用户组移除成员 | admin |

### POST `/api/v1/groups`

**功能**：创建用户组。支持层级结构（parent_group_id 自引用）。

**Request Body**：

```json
{
  "id": "grp_eng",
  "name": "Engineering",
  "description": "Engineering team",
  "parent_group_id": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 用户组唯一标识 |
| `name` | string | 是 | 用户组名称 |
| `description` | string | 否 | 用户组描述 |
| `parent_group_id` | string | 否 | 父用户组 ID，NULL 表示顶级组 |

**Response Body (201)**：

```json
{
  "id": "grp_eng",
  "tenant_id": "acme-corp",
  "name": "Engineering",
  "description": "Engineering team",
  "parent_group_id": null,
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/groups/:groupId/members`

**功能**：向用户组添加成员。

**Request Body**：

```json
{
  "user_id": "u_01HXYZ"
}
```

**Response Body (201)**：

```json
{
  "group_id": "grp_eng",
  "user_id": "u_01HXYZ",
  "joined_at": "2026-03-21T10:00:00Z"
}
```

---

## 六、策略管理 (Policies)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/policies` | 列出所有策略定义 | 已认证 |
| POST | `/api/v1/policies` | 创建策略定义（含规则） | admin |
| GET | `/api/v1/policies/:policyId` | 获取策略详情（含规则列表） | 已认证 |
| PUT | `/api/v1/policies/:policyId` | 更新策略定义 | admin |
| DELETE | `/api/v1/policies/:policyId` | 删除策略定义（级联删除规则） | admin |
| POST | `/api/v1/policies/:policyId/rules` | 为策略添加规则 | admin |
| PUT | `/api/v1/policies/:policyId/rules/:ruleId` | 更新策略规则 | admin |
| DELETE | `/api/v1/policies/:policyId/rules/:ruleId` | 删除策略规则 | admin |
| POST | `/api/v1/policies/reload` | 热加载所有活跃策略到引擎 | admin |
| POST | `/api/v1/authz/check` | 检查授权决策（单条） | 已认证 |
| POST | `/api/v1/authz/batch-check` | 批量检查授权决策 | 已认证 |

### POST `/api/v1/policies`

**功能**：创建策略定义，可同时包含规则。对应 PRD `PolicyDefinition` + `PolicyRule`。

**Request Body**：

```json
{
  "id": "policy_agent_ops",
  "name": "Agent Operations Policy",
  "description": "Defines permissions for agent operators",
  "rules": [
    {
      "effect": "allow",
      "subjects": ["agent-operator", "admin"],
      "actions": ["agents.*", "sessions.send", "sessions.list"],
      "resources": ["agent", "session"],
      "conditions": null,
      "priority": 0
    },
    {
      "effect": "deny",
      "subjects": ["agent-operator"],
      "actions": ["config.set"],
      "resources": ["config"],
      "conditions": null,
      "priority": 10
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 策略唯一标识 |
| `name` | string | 是 | 策略名称 |
| `description` | string | 否 | 策略描述 |
| `rules` | array | 否 | 策略规则列表，可在创建后单独添加 |
| `rules[].effect` | string | 是 | `"allow"` / `"deny"` |
| `rules[].subjects` | string[] | 是 | 匹配的角色/用户组名 |
| `rules[].actions` | string[] | 是 | 匹配的操作（支持 `*` 通配） |
| `rules[].resources` | string[] | 是 | 匹配的资源类型 |
| `rules[].conditions` | object | 否 | ABAC 条件表达式（JSONB） |
| `rules[].priority` | integer | 否 | 规则优先级，默认 0 |

**Response Body (201)**：

```json
{
  "id": "policy_agent_ops",
  "tenant_id": "acme-corp",
  "name": "Agent Operations Policy",
  "description": "Defines permissions for agent operators",
  "version": 1,
  "is_active": true,
  "rules": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "effect": "allow",
      "subjects": ["agent-operator", "admin"],
      "actions": ["agents.*", "sessions.send", "sessions.list"],
      "resources": ["agent", "session"],
      "conditions": null,
      "priority": 0,
      "created_at": "2026-03-21T10:00:00Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "effect": "deny",
      "subjects": ["agent-operator"],
      "actions": ["config.set"],
      "resources": ["config"],
      "conditions": null,
      "priority": 10,
      "created_at": "2026-03-21T10:00:00Z"
    }
  ],
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/authz/check`

**功能**：对当前用户执行单条授权检查。对应 PRD `PolicyEngine.authorize()`。

**Request Body**：

```json
{
  "action": "sessions.send",
  "resource": {
    "type": "session",
    "id": "sess_abc123"
  },
  "context": {
    "ip": "10.0.0.1",
    "time": "2026-03-21T10:00:00Z"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 操作标识（如 `"sessions.send"`） |
| `resource.type` | string | 是 | 资源类型 |
| `resource.id` | string | 否 | 资源 ID |
| `context` | object | 否 | 环境上下文（IP、时间、设备等） |

**Response Body (200)**：

```json
{
  "allowed": true,
  "reason": null,
  "obligations": [
    { "type": "audit", "params": {} }
  ]
}
```

### POST `/api/v1/authz/batch-check`

**功能**：批量授权检查（UI 用，判断哪些操作可用）。

**Request Body**：

```json
{
  "checks": [
    { "action": "sessions.send", "resource": { "type": "session" } },
    { "action": "config.set", "resource": { "type": "config" } },
    { "action": "agents.delete", "resource": { "type": "agent" } }
  ]
}
```

**Response Body (200)**：

```json
{
  "results": [
    { "action": "sessions.send", "allowed": true },
    { "action": "config.set", "allowed": false, "reason": "Insufficient scope" },
    { "action": "agents.delete", "allowed": false, "reason": "Requires admin role" }
  ]
}
```

---

## 七、内容过滤规则 (Content Filters)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/content-filters` | 列出内容过滤规则 | 已认证 |
| POST | `/api/v1/content-filters` | 创建内容过滤规则 | admin |
| GET | `/api/v1/content-filters/:filterId` | 获取过滤规则详情 | 已认证 |
| PUT | `/api/v1/content-filters/:filterId` | 更新过滤规则 | admin |
| DELETE | `/api/v1/content-filters/:filterId` | 删除过滤规则 | admin |
| POST | `/api/v1/content-filters/test` | 测试内容过滤规则（不持久化） | admin |

### POST `/api/v1/content-filters`

**功能**：创建内容过滤规则。对应 PRD `ContentFilter` 接口。

**Request Body**：

```json
{
  "name": "PII Detector",
  "direction": "both",
  "filter_type": "regex-classifier",
  "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
  "severity": "critical",
  "action_on_match": "redact",
  "is_active": true,
  "priority": 10,
  "config": { "replacement": "[SSN REDACTED]" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 规则名称 |
| `direction` | string | 是 | `"inbound"` / `"outbound"` / `"both"` |
| `filter_type` | string | 是 | 过滤器类型标识 |
| `pattern` | string | 否 | 匹配模式（正则等） |
| `severity` | string | 否 | `"info"` / `"warning"` / `"critical"`，默认 `"warning"` |
| `action_on_match` | string | 否 | `"allow"` / `"redact"` / `"block"` / `"review"`，默认 `"redact"` |
| `is_active` | boolean | 否 | 是否启用，默认 `true` |
| `priority` | integer | 否 | 优先级（越大越优先），默认 0 |
| `config` | object | 否 | 过滤器附加配置 |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "tenant_id": "acme-corp",
  "name": "PII Detector",
  "direction": "both",
  "filter_type": "regex-classifier",
  "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
  "severity": "critical",
  "action_on_match": "redact",
  "is_active": true,
  "priority": 10,
  "config": { "replacement": "[SSN REDACTED]" },
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/content-filters/test`

**功能**：对给定内容测试过滤规则效果，不写入持久化。

**Request Body**：

```json
{
  "text": "My SSN is 123-45-6789 and my email is test@example.com",
  "filter_ids": ["550e8400-e29b-41d4-a716-446655440001"]
}
```

**Response Body (200)**：

```json
{
  "passed": false,
  "content": {
    "text": "My SSN is [SSN REDACTED] and my email is test@example.com"
  },
  "violations": [
    {
      "rule": "PII Detector",
      "severity": "critical",
      "description": "SSN pattern detected",
      "matched_content": "123-45-6789"
    }
  ],
  "action": "redact"
}
```

---

## 八、配额管理 (Quota)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/quotas` | 列出配额配置 | 已认证 |
| POST | `/api/v1/quotas` | 创建配额配置 | admin |
| PUT | `/api/v1/quotas/:quotaId` | 更新配额配置 | admin |
| DELETE | `/api/v1/quotas/:quotaId` | 删除配额配置 | admin |
| GET | `/api/v1/quotas/usage` | 查询当前用户/租户的配额使用量 | 已认证 |
| GET | `/api/v1/quotas/usage/:userId` | 查询指定用户的配额使用量 | admin |

### POST `/api/v1/quotas`

**功能**：创建配额配置。对应 PRD `QuotaManager` 接口。

**Request Body**：

```json
{
  "scope_type": "user",
  "scope_id": null,
  "resource_type": "llm_tokens_per_day",
  "max_value": 100000,
  "window_seconds": 86400,
  "is_active": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scope_type` | string | 是 | `"tenant"` / `"user"` / `"role"` / `"agent"` |
| `scope_id` | string | 否 | 具体作用对象 ID（NULL 表示该类型下所有对象） |
| `resource_type` | string | 是 | 资源类型标识（如 `"llm_tokens_per_day"`） |
| `max_value` | integer | 是 | 配额上限值 |
| `window_seconds` | integer | 是 | 时间窗口（秒）。86400 = 日配额 |
| `is_active` | boolean | 否 | 是否启用，默认 `true` |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "tenant_id": "acme-corp",
  "scope_type": "user",
  "scope_id": null,
  "resource_type": "llm_tokens_per_day",
  "max_value": 100000,
  "window_seconds": 86400,
  "is_active": true,
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### GET `/api/v1/quotas/usage`

**功能**：查询当前用户的各项配额使用情况。

**Response Body (200)**：

```json
{
  "items": [
    {
      "resource_type": "llm_tokens_per_day",
      "used_value": 45230,
      "max_value": 100000,
      "remaining": 54770,
      "window_start": "2026-03-21T00:00:00Z",
      "window_end": "2026-03-22T00:00:00Z",
      "percent_used": 45.23
    },
    {
      "resource_type": "api_calls_per_minute",
      "used_value": 12,
      "max_value": 60,
      "remaining": 48,
      "window_start": "2026-03-21T10:05:00Z",
      "window_end": "2026-03-21T10:06:00Z",
      "percent_used": 20.0
    }
  ]
}
```

---

## 九、Agent 管理 (Agents)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/agents` | 分页列出租户内 Agent | 已认证 |
| POST | `/api/v1/agents` | 创建 Agent | admin/editor |
| GET | `/api/v1/agents/:agentId` | 获取 Agent 详情 | 已认证 |
| PUT | `/api/v1/agents/:agentId` | 更新 Agent 配置 | 创建者/admin |
| DELETE | `/api/v1/agents/:agentId` | 归档 Agent（软删除 → archived） | admin |
| GET | `/api/v1/agents/:agentId/status` | 获取 Agent 运行状态 | 已认证 |

### GET `/api/v1/agents`

**功能**：分页列出租户内的 Agent。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `offset` | integer | 0 | 跳过前 N 条 |
| `limit` | integer | 20 | 每页数量 |
| `status` | string | — | 按状态过滤：`active` / `inactive` / `archived` |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "support-bot",
      "tenant_id": "acme-corp",
      "name": "Customer Support Bot",
      "description": "Handles L1 customer support inquiries",
      "model": "gpt-4o",
      "status": "active",
      "created_by": "u_01HXYZ",
      "created_at": "2026-03-01T00:00:00Z",
      "updated_at": "2026-03-20T12:00:00Z"
    }
  ],
  "total": 5,
  "has_more": false
}
```

### POST `/api/v1/agents`

**功能**：创建 Agent。

**Request Body**：

```json
{
  "id": "support-bot",
  "name": "Customer Support Bot",
  "description": "Handles L1 customer support inquiries",
  "model": "gpt-4o",
  "system_prompt": "You are a helpful customer support assistant...",
  "tools": [
    { "name": "search-kb", "config": { "index": "support-docs" } },
    { "name": "create-ticket", "config": {} }
  ],
  "config": {
    "temperature": 0.3,
    "max_tokens": 4096
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | Agent 唯一标识 |
| `name` | string | 是 | Agent 名称 |
| `description` | string | 否 | Agent 描述 |
| `model` | string | 否 | 使用的 LLM 模型标识 |
| `system_prompt` | string | 否 | 系统提示词 |
| `tools` | array | 否 | Agent 可用工具列表 |
| `config` | object | 否 | Agent 运行时配置 |

**Response Body (201)**：

```json
{
  "id": "support-bot",
  "tenant_id": "acme-corp",
  "name": "Customer Support Bot",
  "description": "Handles L1 customer support inquiries",
  "model": "gpt-4o",
  "system_prompt": "You are a helpful customer support assistant...",
  "tools": [
    { "name": "search-kb", "config": { "index": "support-docs" } },
    { "name": "create-ticket", "config": {} }
  ],
  "config": { "temperature": 0.3, "max_tokens": 4096 },
  "status": "active",
  "created_by": "u_01HXYZ",
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### GET `/api/v1/agents/:agentId/status`

**功能**：获取 Agent 的运行时状态。

**Response Body (200)**：

```json
{
  "agent_id": "support-bot",
  "running_instances": 2,
  "active_sessions": 15,
  "pending_tasks": 3,
  "health": "healthy",
  "last_activity_at": "2026-03-21T10:04:55Z"
}
```

---

## 十、会话管理 (Sessions)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/sessions` | 分页列出当前用户的会话 | 已认证 |
| POST | `/api/v1/sessions` | 创建新会话 | admin/editor |
| GET | `/api/v1/sessions/:sessionKey` | 获取会话详情 | 自己/admin |
| PUT | `/api/v1/sessions/:sessionKey` | 更新会话元数据 | 自己/admin |
| DELETE | `/api/v1/sessions/:sessionKey` | 归档会话（软删除） | admin |
| POST | `/api/v1/sessions/:sessionKey/send` | 向会话发送消息（调用 Agent） | 自己/admin |
| GET | `/api/v1/sessions/:sessionKey/history` | 获取会话消息历史 | 自己/admin |
| POST | `/api/v1/sessions/:sessionKey/abort` | 中止当前正在进行的请求 | 自己/admin |

### POST `/api/v1/sessions`

**功能**：创建新的 Agent 会话。

**Request Body**：

```json
{
  "session_key": "support-alice-20260321",
  "agent_id": "support-bot",
  "title": "Order #12345 inquiry",
  "metadata": { "customer_id": "cust_001", "channel": "web" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_key` | string | 是 | 会话唯一键（租户内唯一） |
| `agent_id` | string | 是 | 关联的 Agent ID |
| `title` | string | 否 | 会话标题 |
| `metadata` | object | 否 | 自定义元数据 |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "tenant_id": "acme-corp",
  "session_key": "support-alice-20260321",
  "agent_id": "support-bot",
  "user_id": "u_01HXYZ",
  "title": "Order #12345 inquiry",
  "status": "active",
  "message_count": 0,
  "token_count": 0,
  "metadata": { "customer_id": "cust_001", "channel": "web" },
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/sessions/:sessionKey/send`

**功能**：向会话发送用户消息，触发 Agent 处理并返回回复。

**Request Body**：

```json
{
  "message": {
    "role": "user",
    "content": "What is the status of my order #12345?"
  },
  "options": {
    "stream": false,
    "thinking": "low",
    "max_tokens": 2048
  },
  "idempotency_key": "msg_20260321_001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message.role` | string | 是 | 消息角色，通常为 `"user"` |
| `message.content` | string | 是 | 消息内容 |
| `options.stream` | boolean | 否 | 是否流式响应，默认 `false` |
| `options.thinking` | string | 否 | 思维模式：`"none"` / `"low"` / `"high"` |
| `options.max_tokens` | integer | 否 | 最大输出 token 数 |
| `idempotency_key` | string | 否 | 幂等键，防止重复发送 |

**Response Body (200) — 非流式**：

```json
{
  "message": {
    "id": "550e8400-e29b-41d4-a716-446655440011",
    "role": "assistant",
    "content": "Your order #12345 is currently being shipped and is expected to arrive by March 25th.",
    "tool_calls": null,
    "token_count": 156,
    "created_at": "2026-03-21T10:01:00Z"
  },
  "task_id": "550e8400-e29b-41d4-a716-446655440012",
  "usage": {
    "prompt_tokens": 320,
    "completion_tokens": 156,
    "total_tokens": 476
  }
}
```

> 当 `stream=true` 时，返回 `Content-Type: text/event-stream`，采用 SSE 流式协议。

### GET `/api/v1/sessions/:sessionKey/history`

**功能**：分页获取会话的消息历史。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `offset` | integer | 0 | 跳过前 N 条 |
| `limit` | integer | 50 | 每页数量 |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440011",
      "role": "user",
      "content": "What is the status of my order #12345?",
      "tool_calls": null,
      "tool_results": null,
      "token_count": 12,
      "metadata": null,
      "created_at": "2026-03-21T10:00:30Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440012",
      "role": "assistant",
      "content": "Your order #12345 is currently being shipped...",
      "tool_calls": null,
      "tool_results": null,
      "token_count": 156,
      "metadata": null,
      "created_at": "2026-03-21T10:01:00Z"
    }
  ],
  "total": 2,
  "has_more": false
}
```

---

## 十一、任务管理 (Tasks)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/tasks` | 分页列出任务 | 自己Agent/admin |
| POST | `/api/v1/tasks` | 创建任务 | admin/editor |
| GET | `/api/v1/tasks/:taskId` | 获取任务详情 | 自己Agent/admin |
| POST | `/api/v1/tasks/:taskId/transition` | 触发 FSM 状态转换 | admin/system |
| GET | `/api/v1/tasks/:taskId/transitions` | 获取状态转换历史 | 已认证 |
| POST | `/api/v1/tasks/:taskId/kill` | 强制终止任务 | admin |
| POST | `/api/v1/tasks/:taskId/retry` | 重试失败/超时的任务 | admin |

### GET `/api/v1/tasks`

**功能**：分页列出任务。普通用户仅可见自己创建的 Agent 下的任务。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `offset` | integer | 0 | 跳过前 N 条 |
| `limit` | integer | 20 | 每页数量 |
| `state` | string | — | 按状态过滤（支持逗号分隔多状态） |
| `agent_id` | string | — | 按 Agent ID 过滤 |
| `type` | string | — | 按任务类型过滤 |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440020",
      "tenant_id": "acme-corp",
      "agent_id": "support-bot",
      "session_key": "support-alice-20260321",
      "parent_task_id": null,
      "type": "llm_call",
      "state": "completed",
      "priority": "normal",
      "timeout_ms": 120000,
      "max_attempts": 3,
      "attempt_count": 1,
      "created_at": "2026-03-21T10:00:00Z",
      "started_at": "2026-03-21T10:00:02Z",
      "completed_at": "2026-03-21T10:00:15Z"
    }
  ],
  "total": 156,
  "has_more": true
}
```

### POST `/api/v1/tasks`

**功能**：创建任务。对应 PRD `Task` 实体。

**Request Body**：

```json
{
  "agent_id": "support-bot",
  "session_key": "support-alice-20260321",
  "type": "llm_call",
  "input": {
    "messages": [{ "role": "user", "content": "Hello" }]
  },
  "priority": "normal",
  "timeout_ms": 120000,
  "max_attempts": 3,
  "idempotency_key": "task_20260321_001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | 关联的 Agent ID |
| `session_key` | string | 否 | 关联的会话 Key |
| `parent_task_id` | string | 否 | 父任务 ID（子任务场景） |
| `type` | string | 是 | `"llm_call"` / `"tool_execution"` / `"workflow_step"` / `"message_delivery"` / `"custom"` |
| `input` | object | 否 | 任务输入数据 |
| `priority` | string | 否 | `"high"` / `"normal"` / `"low"`，默认 `"normal"` |
| `timeout_ms` | integer | 否 | 超时毫秒数，默认 60000 |
| `max_attempts` | integer | 否 | 最大重试次数，默认 3 |
| `idempotency_key` | string | 否 | 幂等键 |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "tenant_id": "acme-corp",
  "agent_id": "support-bot",
  "session_key": "support-alice-20260321",
  "type": "llm_call",
  "state": "pending",
  "priority": "normal",
  "timeout_ms": 120000,
  "max_attempts": 3,
  "attempt_count": 0,
  "idempotency_key": "task_20260321_001",
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/tasks/:taskId/transition`

**功能**：触发任务的 FSM 状态转换。非法转换返回 409 错误。

合法状态转换表（PRD 第 5.3.1 节）：

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

**Request Body**：

```json
{
  "event": "enqueue",
  "reason": "Submitted to processing queue"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event` | string | 是 | FSM 事件：`"enqueue"` / `"start"` / `"complete"` / `"fail"` / `"pause"` / `"resume"` / `"kill"` / `"timeout_trigger"` / `"retry"` |
| `reason` | string | 否 | 状态转换原因说明 |

**Response Body (200)**：

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440020",
  "previous_state": "pending",
  "current_state": "queued",
  "event": "enqueue",
  "timestamp": "2026-03-21T10:00:01Z"
}
```

**Response Body (409 — 非法状态转换)**：

```json
{
  "error": "IllegalStateTransitionError",
  "message": "Cannot handle event \"complete\" in state \"pending\". Available events: [enqueue, kill]",
  "from_state": "pending",
  "event": "complete",
  "available_events": ["enqueue", "kill"]
}
```

### GET `/api/v1/tasks/:taskId/transitions`

**功能**：获取任务的完整状态转换历史。不可变追加记录。

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": 1,
      "from_state": "pending",
      "to_state": "queued",
      "event": "enqueue",
      "reason": "Submitted to processing queue",
      "actor": "system",
      "timestamp": "2026-03-21T10:00:01Z"
    },
    {
      "id": 2,
      "from_state": "queued",
      "to_state": "running",
      "event": "start",
      "reason": "Worker picked up task",
      "actor": "system",
      "timestamp": "2026-03-21T10:00:02Z"
    },
    {
      "id": 3,
      "from_state": "running",
      "to_state": "completed",
      "event": "complete",
      "reason": "LLM call succeeded",
      "actor": "system",
      "timestamp": "2026-03-21T10:00:15Z"
    }
  ]
}
```

---

## 十二、工作流 (Workflows)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/workflows` | 列出工作流定义 | 已认证 |
| POST | `/api/v1/workflows` | 创建工作流定义 | admin/editor |
| GET | `/api/v1/workflows/:workflowId` | 获取工作流定义详情 | 已认证 |
| PUT | `/api/v1/workflows/:workflowId` | 更新工作流定义（新版本） | admin/editor |
| DELETE | `/api/v1/workflows/:workflowId` | 删除工作流定义 | admin |
| POST | `/api/v1/workflows/:workflowId/start` | 启动工作流实例 | admin/editor |
| GET | `/api/v1/workflow-instances` | 列出工作流实例 | 已认证 |
| GET | `/api/v1/workflow-instances/:instanceId` | 获取工作流实例详情 | 已认证 |
| POST | `/api/v1/workflow-instances/:instanceId/signal` | 向工作流注入信号 | 启动者/admin |
| POST | `/api/v1/workflow-instances/:instanceId/kill` | 终止工作流实例 | admin |

### POST `/api/v1/workflows`

**功能**：创建工作流定义（含步骤和转换）。对应 PRD `WorkflowDefinition`。

**Request Body**：

```json
{
  "id": "support-escalation",
  "name": "Support Escalation Workflow",
  "description": "Auto-triage then escalate to human if needed",
  "steps": [
    {
      "id": "triage",
      "type": "agent_task",
      "config": { "agent_id": "support-bot", "prompt": "Classify this ticket..." },
      "timeout_ms": 30000
    },
    {
      "id": "human_review",
      "type": "human_review",
      "config": { "assignee_group": "l2-support" },
      "timeout_ms": 86400000
    },
    {
      "id": "resolve",
      "type": "agent_task",
      "config": { "agent_id": "support-bot", "prompt": "Generate resolution..." }
    }
  ],
  "transitions": [
    { "from": "triage", "to": "human_review", "condition": "result.severity == 'high'" },
    { "from": "triage", "to": "resolve", "condition": "result.severity != 'high'" },
    { "from": "human_review", "to": "resolve" }
  ],
  "timeout_ms": 172800000
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 工作流唯一标识 |
| `name` | string | 是 | 工作流名称 |
| `description` | string | 否 | 工作流描述 |
| `steps` | array | 是 | 步骤定义列表 |
| `steps[].id` | string | 是 | 步骤 ID |
| `steps[].type` | string | 是 | `"agent_task"` / `"human_review"` / `"condition"` / `"parallel"` / `"wait_signal"` |
| `steps[].config` | object | 是 | 步骤配置 |
| `steps[].timeout_ms` | integer | 否 | 步骤超时时间 |
| `transitions` | array | 是 | 步骤间转换关系 |
| `transitions[].from` | string | 是 | 源步骤 ID |
| `transitions[].to` | string | 是 | 目标步骤 ID |
| `transitions[].condition` | string | 否 | 条件表达式，NULL 表示无条件转换 |
| `timeout_ms` | integer | 否 | 工作流整体超时时间 |

**Response Body (201)**：

```json
{
  "id": "support-escalation",
  "tenant_id": "acme-corp",
  "name": "Support Escalation Workflow",
  "version": 1,
  "is_active": true,
  "steps": [ "..." ],
  "transitions": [ "..." ],
  "timeout_ms": 172800000,
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/workflows/:workflowId/start`

**功能**：启动工作流实例。

**Request Body**：

```json
{
  "input": {
    "ticket_id": "TK-12345",
    "customer_message": "I need help with billing"
  }
}
```

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440030",
  "workflow_id": "support-escalation",
  "workflow_version": 1,
  "state": "running",
  "current_step_id": "triage",
  "input": { "ticket_id": "TK-12345", "customer_message": "I need help with billing" },
  "started_by": "u_01HXYZ",
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### GET `/api/v1/workflow-instances/:instanceId`

**功能**：获取工作流实例详情，包含各步骤执行结果。

**Response Body (200)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440030",
  "workflow_id": "support-escalation",
  "workflow_version": 1,
  "state": "waiting_signal",
  "current_step_id": "human_review",
  "input": { "ticket_id": "TK-12345", "customer_message": "I need help with billing" },
  "step_results": [
    {
      "step_id": "triage",
      "status": "completed",
      "result": { "severity": "high", "category": "billing" },
      "started_at": "2026-03-21T10:00:00Z",
      "completed_at": "2026-03-21T10:00:12Z"
    }
  ],
  "started_by": "u_01HXYZ",
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:12Z"
}
```

### POST `/api/v1/workflow-instances/:instanceId/signal`

**功能**：向工作流实例注入信号（用于人工审批等 human_review / wait_signal 步骤）。

**Request Body**：

```json
{
  "type": "human_approval",
  "data": {
    "approved": true,
    "notes": "Approved for refund processing",
    "resolution_type": "refund"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 信号类型标识 |
| `data` | object | 是 | 信号数据 |

**Response Body (200)**：

```json
{
  "instance_id": "550e8400-e29b-41d4-a716-446655440030",
  "state": "running",
  "current_step_id": "resolve",
  "signal_received": true
}
```

---

## 十三、人机转交 (Handoff)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/handoffs` | 列出转交请求 | 已认证 |
| POST | `/api/v1/handoffs` | 创建转交请求 | admin/editor/system |
| GET | `/api/v1/handoffs/:handoffId` | 获取转交请求详情 | 已认证 |
| PUT | `/api/v1/handoffs/:handoffId/assign` | 分配给操作员 | admin |
| PUT | `/api/v1/handoffs/:handoffId/resolve` | 提交处理结果 | 被分配者/admin |
| PUT | `/api/v1/handoffs/:handoffId/cancel` | 取消转交请求 | admin |

### POST `/api/v1/handoffs`

**功能**：创建人机转交请求。对应 PRD `HandoffManager` 接口。

**Request Body**：

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440020",
  "session_key": "support-alice-20260321",
  "agent_id": "support-bot",
  "reason": "Customer requesting refund exceeding automated threshold ($500)",
  "priority": "high",
  "expires_at": "2026-03-22T10:00:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 否 | 关联的任务 ID |
| `session_key` | string | 否 | 关联的会话 Key |
| `agent_id` | string | 是 | 发起转交的 Agent ID |
| `reason` | string | 是 | 转交原因 |
| `priority` | string | 否 | `"high"` / `"normal"` / `"low"`，默认 `"normal"` |
| `expires_at` | string | 否 | 请求过期时间 |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440040",
  "tenant_id": "acme-corp",
  "task_id": "550e8400-e29b-41d4-a716-446655440020",
  "session_key": "support-alice-20260321",
  "agent_id": "support-bot",
  "reason": "Customer requesting refund exceeding automated threshold ($500)",
  "priority": "high",
  "status": "pending",
  "assigned_to": null,
  "created_at": "2026-03-21T10:00:00Z",
  "expires_at": "2026-03-22T10:00:00Z"
}
```

### PUT `/api/v1/handoffs/:handoffId/assign`

**功能**：将转交请求分配给指定操作员。

**Request Body**：

```json
{
  "assigned_to": "u_operator01"
}
```

**Response Body (200)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440040",
  "status": "assigned",
  "assigned_to": "u_operator01",
  "updated_at": "2026-03-21T10:15:00Z"
}
```

### PUT `/api/v1/handoffs/:handoffId/resolve`

**功能**：提交转交处理结果。

**Request Body**：

```json
{
  "resolution": {
    "action_taken": "Approved refund of $450",
    "notes": "Customer loyalty account, approved per policy",
    "result_data": { "refund_amount": 450, "refund_id": "REF-789" }
  }
}
```

**Response Body (200)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440040",
  "status": "resolved",
  "assigned_to": "u_operator01",
  "resolution": {
    "action_taken": "Approved refund of $450",
    "notes": "Customer loyalty account, approved per policy",
    "result_data": { "refund_amount": 450, "refund_id": "REF-789" }
  },
  "resolved_at": "2026-03-21T11:30:00Z",
  "updated_at": "2026-03-21T11:30:00Z"
}
```

---

## 十四、共享知识库 (Knowledge)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/knowledge` | 搜索/列出知识条目 | 已认证 |
| POST | `/api/v1/knowledge` | 创建知识条目 | admin/editor |
| GET | `/api/v1/knowledge/:entryId` | 获取知识条目详情 | 已认证 |
| PUT | `/api/v1/knowledge/:entryId` | 更新知识条目 | 创建者/admin |
| DELETE | `/api/v1/knowledge/:entryId` | 删除知识条目 | 创建者/admin |

### GET `/api/v1/knowledge`

**功能**：搜索/分页列出知识库条目。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `namespace` | string | — | 按命名空间过滤 |
| `tags` | string | — | 按标签过滤（逗号分隔） |
| `q` | string | — | 全文搜索关键词 |
| `offset` | integer | 0 | 跳过前 N 条 |
| `limit` | integer | 20 | 每页数量 |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440050",
      "tenant_id": "acme-corp",
      "namespace": "faq",
      "key": "refund-policy",
      "content": "Our refund policy allows returns within 30 days...",
      "content_type": "text/plain",
      "tags": ["billing", "refund", "policy"],
      "metadata": { "last_reviewed": "2026-03-01" },
      "created_by": "u_01HXYZ",
      "created_at": "2026-02-15T00:00:00Z",
      "updated_at": "2026-03-01T00:00:00Z"
    }
  ],
  "total": 1,
  "has_more": false
}
```

### POST `/api/v1/knowledge`

**功能**：创建知识库条目。

**Request Body**：

```json
{
  "namespace": "faq",
  "key": "refund-policy",
  "content": "Our refund policy allows returns within 30 days...",
  "content_type": "text/plain",
  "tags": ["billing", "refund", "policy"],
  "metadata": { "last_reviewed": "2026-03-01" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `namespace` | string | 否 | 命名空间，默认 `"default"` |
| `key` | string | 是 | 条目唯一键（namespace 内唯一） |
| `content` | string | 是 | 知识内容 |
| `content_type` | string | 否 | 内容类型，默认 `"text/plain"` |
| `tags` | string[] | 否 | 标签列表 |
| `metadata` | object | 否 | 自定义元数据 |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440050",
  "tenant_id": "acme-corp",
  "namespace": "faq",
  "key": "refund-policy",
  "content": "Our refund policy allows returns within 30 days...",
  "content_type": "text/plain",
  "tags": ["billing", "refund", "policy"],
  "metadata": { "last_reviewed": "2026-03-01" },
  "created_by": "u_01HXYZ",
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

---

## 十五、API Key 管理 (API Keys)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/api-keys` | 列出 API Key（用户看自己的，admin 看全部） | 已认证 |
| POST | `/api/v1/api-keys` | 创建 API Key（明文仅返回一次） | 已认证 |
| GET | `/api/v1/api-keys/:keyId` | 获取 API Key 详情（不含明文） | 自己/admin |
| PUT | `/api/v1/api-keys/:keyId/revoke` | 吊销 API Key | 自己/admin |

### POST `/api/v1/api-keys`

**功能**：创建 API Key。明文 key 仅在创建时返回一次，后续无法再获取。

**Request Body**：

```json
{
  "name": "CI/CD Pipeline Key",
  "scopes": ["sessions.send", "sessions.list", "agents.list"],
  "expires_at": "2027-03-21T00:00:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Key 名称 |
| `scopes` | string[] | 否 | 允许的操作范围，默认空（继承用户权限） |
| `expires_at` | string | 否 | 过期时间，NULL 表示永不过期 |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440060",
  "tenant_id": "acme-corp",
  "user_id": "u_01HXYZ",
  "name": "CI/CD Pipeline Key",
  "key": "oc_live_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "key_prefix": "oc_live_sk_a1b2",
  "scopes": ["sessions.send", "sessions.list", "agents.list"],
  "status": "active",
  "expires_at": "2027-03-21T00:00:00Z",
  "created_at": "2026-03-21T10:00:00Z"
}
```

> **安全说明**：`key` 字段仅在创建响应中返回。后续 GET 请求仅返回 `key_prefix`。数据库存储 `key_hash`（SHA-256 哈希），无法逆向恢复明文。

### PUT `/api/v1/api-keys/:keyId/revoke`

**功能**：吊销 API Key。不支持物理删除。

**Request Body**：无

**Response Body (200)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440060",
  "name": "CI/CD Pipeline Key",
  "key_prefix": "oc_live_sk_a1b2",
  "status": "revoked",
  "revoked_at": "2026-03-21T12:00:00Z"
}
```

---

## 十六、限流配置 (Rate Limits)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/rate-limits` | 列出限流配置 | 已认证 |
| POST | `/api/v1/rate-limits` | 创建限流配置 | admin |
| PUT | `/api/v1/rate-limits/:configId` | 更新限流配置 | admin |
| DELETE | `/api/v1/rate-limits/:configId` | 删除限流配置 | admin |

### POST `/api/v1/rate-limits`

**功能**：创建限流配置。对应 PRD `RateLimiter` 的 `RateLimitKey` 维度设计。

**Request Body**：

```json
{
  "scope_type": "user",
  "scope_id": null,
  "resource": "api",
  "action": null,
  "max_requests": 120,
  "window_seconds": 60,
  "burst_limit": 30
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scope_type` | string | 是 | `"tenant"` / `"user"` / `"api_key"` / `"ip"` |
| `scope_id` | string | 否 | 具体作用对象 ID |
| `resource` | string | 否 | 资源标识，默认 `"api"` |
| `action` | string | 否 | 限制的具体操作 |
| `max_requests` | integer | 是 | 窗口内最大请求数 |
| `window_seconds` | integer | 是 | 时间窗口（秒） |
| `burst_limit` | integer | 否 | 突发限额 |

**Response Body (201)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440070",
  "tenant_id": "acme-corp",
  "scope_type": "user",
  "scope_id": null,
  "resource": "api",
  "action": null,
  "max_requests": 120,
  "window_seconds": 60,
  "burst_limit": 30,
  "is_active": true,
  "created_at": "2026-03-21T10:00:00Z",
  "updated_at": "2026-03-21T10:00:00Z"
}
```

---

## 十七、消息信封 (Messages)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| POST | `/api/v1/messages` | 发送统一消息信封（通道无关） | admin/editor |
| GET | `/api/v1/messages` | 查询消息历史 | 发送者/admin |
| GET | `/api/v1/messages/:messageId` | 获取单条消息详情 | 发送者/admin |

### POST `/api/v1/messages`

**功能**：发送统一消息信封。对应 PRD `MessageEnvelope`，通道无关的统一消息格式。

**Request Body**：

```json
{
  "source": {
    "type": "webhook",
    "id": "ext_system_001",
    "channel": "api"
  },
  "target": {
    "agent_id": "support-bot",
    "session_key": "support-alice-20260321"
  },
  "content": {
    "type": "text",
    "text": "New order placed: #12346"
  },
  "metadata": { "priority": "high" },
  "idempotency_key": "msg_ext_20260321_001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source.type` | string | 是 | `"user"` / `"agent"` / `"system"` / `"webhook"` |
| `source.id` | string | 是 | 来源标识 |
| `source.channel` | string | 否 | 消息来源通道 |
| `target.agent_id` | string | 是 | 目标 Agent ID |
| `target.session_key` | string | 否 | 目标会话 Key |
| `content.type` | string | 是 | `"text"` / `"rich"` / `"command"` / `"event"` |
| `content.text` | string | 条件 | `type=text` 时的文本内容 |
| `content.rich_elements` | array | 条件 | `type=rich` 时的结构化元素 |
| `content.command` | object | 条件 | `type=command` 时的命令定义 |
| `content.attachments` | array | 否 | 附件列表 |
| `metadata` | object | 否 | 自定义元数据 |
| `idempotency_key` | string | 否 | 幂等键 |
| `reply_to` | string | 否 | 回复的消息 ID |

**Response Body (202)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440080",
  "tenant_id": "acme-corp",
  "version": "1.0",
  "timestamp": "2026-03-21T10:00:00Z",
  "source": { "type": "webhook", "id": "ext_system_001", "channel": "api" },
  "target": { "agent_id": "support-bot", "session_key": "support-alice-20260321" },
  "content": { "type": "text", "text": "New order placed: #12346" },
  "status": "accepted"
}
```

---

## 十八、审计日志 (Audit)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/audit/events` | 查询审计事件日志 | admin |
| GET | `/api/v1/audit/events/:eventId` | 获取单条审计事件详情 | admin |
| GET | `/api/v1/audit/metrics` | 获取审计管道指标 | admin |

> **安全说明**：审计记录不可修改、不可删除（RLS 策略禁止 UPDATE/DELETE）。仅 admin 角色可查询。

### GET `/api/v1/audit/events`

**功能**：分页查询审计事件。对应 PRD `AuditPipeline.query()` 和数据库 `audit_events` 表。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `from` | string (ISO 8601) | — | 起始时间 |
| `to` | string (ISO 8601) | — | 结束时间 |
| `category` | string | — | 审计类别过滤 |
| `action` | string | — | 操作过滤（支持通配符） |
| `actor_id` | string | — | 操作者 ID |
| `outcome` | string | — | `"success"` / `"failure"` / `"denied"` |
| `resource_type` | string | — | 资源类型 |
| `request_id` | string | — | 请求链路 ID |
| `offset` | integer | 0 | 偏移 |
| `limit` | integer | 50 | 每页数量 |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440090",
      "tenant_id": "acme-corp",
      "timestamp": "2026-03-21T09:30:00Z",
      "version": "1.0",
      "actor": {
        "type": "user",
        "id": "unknown",
        "name": null,
        "ip": "203.0.113.42",
        "user_agent": "Mozilla/5.0..."
      },
      "action": "auth.login",
      "category": "authentication",
      "outcome": "failure",
      "resource": {
        "type": "auth",
        "id": null,
        "name": null,
        "tenant_id": "acme-corp"
      },
      "source": {
        "service": "gateway",
        "instance": "gw-pod-abc123",
        "request_id": "req_xyz789"
      },
      "details": { "reason": "invalid_token" },
      "duration_ms": 12,
      "error_message": "Token validation failed"
    }
  ],
  "total": 3,
  "has_more": false
}
```

### GET `/api/v1/audit/metrics`

**功能**：获取审计管道的运行指标。

**Response Body (200)**：

```json
{
  "buffered_events": 42,
  "total_emitted": 15230,
  "sink_count": 2,
  "sinks": [
    {
      "name": "log-sink",
      "status": "healthy",
      "events_written": 15230,
      "capabilities": { "queryable": false, "realtime": true, "tamper_proof": false }
    },
    {
      "name": "webhook-sink",
      "status": "healthy",
      "events_written": 15200,
      "last_error": null,
      "capabilities": { "queryable": false, "realtime": true, "tamper_proof": false }
    }
  ]
}
```

---

## 十九、运行时实例 (Runtime Instances)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/runtime-instances` | 列出运行时实例 | 已认证 |
| POST | `/api/v1/runtime-instances` | 创建运行时实例 | admin/system |
| GET | `/api/v1/runtime-instances/:instanceId` | 获取实例详情和资源使用 | 已认证 |
| POST | `/api/v1/runtime-instances/:instanceId/start` | 启动实例 | admin/system |
| POST | `/api/v1/runtime-instances/:instanceId/stop` | 优雅停止实例 | admin/system |
| POST | `/api/v1/runtime-instances/:instanceId/kill` | 强制终止实例 | admin/system |
| DELETE | `/api/v1/runtime-instances/:instanceId` | 清理已终止实例记录 | system |

### POST `/api/v1/runtime-instances`

**功能**：创建 Agent 运行时实例。对应 PRD `AgentRuntimeBackend.create()`。

**Request Body**：

```json
{
  "agent_id": "support-bot",
  "session_key": "support-alice-20260321",
  "runtime_type": "docker",
  "isolation": {
    "network": {
      "mode": "allowlist",
      "allowed_hosts": ["api.openai.com", "api.anthropic.com"],
      "allowed_ports": [443]
    },
    "filesystem": {
      "workspace_access": "readonly",
      "persistent_volume": false,
      "max_disk_bytes": 1073741824
    },
    "resources": {
      "cpu_millicores": 500,
      "memory_mb": 512,
      "pids_limit": 100
    }
  },
  "image": "openclaw/agent-runtime:latest",
  "env": { "LOG_LEVEL": "info" },
  "labels": { "team": "support" },
  "timeout_ms": 300000,
  "idle_timeout_ms": 60000
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | Agent ID |
| `session_key` | string | 否 | 会话 Key |
| `runtime_type` | string | 否 | `"inprocess"` / `"docker"` / `"kubernetes"`，默认由配置决定 |
| `isolation.network.mode` | string | 否 | `"none"` / `"allowlist"` / `"full"` |
| `isolation.network.allowed_hosts` | string[] | 否 | 出站白名单主机 |
| `isolation.filesystem.workspace_access` | string | 否 | `"none"` / `"readonly"` / `"readwrite"` |
| `isolation.resources.cpu_millicores` | integer | 否 | CPU 限制（毫核） |
| `isolation.resources.memory_mb` | integer | 否 | 内存限制（MB） |
| `image` | string | 否 | 容器镜像 |
| `env` | object | 否 | 环境变量 |
| `timeout_ms` | integer | 否 | 实例总超时 |
| `idle_timeout_ms` | integer | 否 | 空闲超时 |

**Response Body (201)**：

```json
{
  "id": "rt_agent-support-bot-1711015200",
  "tenant_id": "acme-corp",
  "agent_id": "support-bot",
  "session_key": "support-alice-20260321",
  "runtime_type": "docker",
  "state": "creating",
  "network_mode": "allowlist",
  "allowed_hosts": ["api.openai.com", "api.anthropic.com"],
  "fs_access": "readonly",
  "cpu_millicores": 500,
  "memory_mb": 512,
  "image": "openclaw/agent-runtime:latest",
  "created_at": "2026-03-21T10:00:00Z"
}
```

### GET `/api/v1/runtime-instances/:instanceId`

**功能**：获取运行时实例的详情和实时资源使用。

**Response Body (200)**：

```json
{
  "id": "rt_agent-support-bot-1711015200",
  "tenant_id": "acme-corp",
  "agent_id": "support-bot",
  "runtime_type": "docker",
  "state": "running",
  "container_id": "abc123def456",
  "pod_name": null,
  "network_mode": "allowlist",
  "cpu_millicores": 500,
  "memory_mb": 512,
  "resource_usage": {
    "cpu_percent": 23.5,
    "memory_usage_mb": 312.4,
    "network_rx_bytes": 1048576,
    "network_tx_bytes": 524288
  },
  "started_at": "2026-03-21T10:00:02Z",
  "stopped_at": null
}
```

---

## 二十、队列管理 (Queue)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/queues` | 列出所有队列及深度 | admin/system |
| GET | `/api/v1/queues/:queueName/depth` | 获取队列深度 | admin/system |
| GET | `/api/v1/queues/:queueName/dlq` | 查看死信队列消息 | admin |
| POST | `/api/v1/queues/:queueName/dlq/:messageId/replay` | 重放死信消息 | admin |
| POST | `/api/v1/queues/:queueName/purge` | 清空队列 | admin |

### GET `/api/v1/queues`

**功能**：列出所有活跃队列的概要信息。

**Response Body (200)**：

```json
{
  "items": [
    {
      "name": "agent-tasks",
      "depth": 12,
      "dlq_count": 2,
      "consumers": 4
    },
    {
      "name": "message-delivery",
      "depth": 0,
      "dlq_count": 0,
      "consumers": 2
    },
    {
      "name": "audit-events",
      "depth": 42,
      "dlq_count": 0,
      "consumers": 1
    }
  ]
}
```

### GET `/api/v1/queues/:queueName/dlq`

**功能**：分页查看死信队列中的消息。对应 PRD `QueueBackend.getDeadLetterMessages()`。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `offset` | integer | 0 | 偏移 |
| `limit` | integer | 20 | 每页数量 |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440100",
      "tenant_id": "acme-corp",
      "type": "llm_call",
      "payload": { "agent_id": "support-bot", "session_key": "..." },
      "priority": "normal",
      "attempts": 3,
      "max_attempts": 3,
      "created_at": "2026-03-21T08:00:00Z",
      "metadata": { "error": "OpenAI API timeout after 120s" }
    }
  ],
  "total": 2,
  "has_more": false
}
```

### POST `/api/v1/queues/:queueName/dlq/:messageId/replay`

**功能**：将死信消息重新放入原队列。对应 PRD `QueueBackend.replayDeadLetter()`。

**Request Body**：无

**Response Body (200)**：

```json
{
  "message_id": "550e8400-e29b-41d4-a716-446655440100",
  "queue": "agent-tasks",
  "replayed": true,
  "new_state": "pending"
}
```

---

## 二十一、检查点 (Checkpoints)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/tasks/:taskId/checkpoints` | 获取任务的检查点列表 | 已认证 |
| GET | `/api/v1/tasks/:taskId/checkpoints/latest` | 获取最新检查点 | 已认证 |
| POST | `/api/v1/tasks/:taskId/checkpoints` | 创建检查点 | admin/system |
| POST | `/api/v1/tasks/:taskId/checkpoints/:checkpointId/restore` | 从检查点恢复任务 | admin |
| DELETE | `/api/v1/checkpoints/expired` | 清理过期检查点 | system |

### GET `/api/v1/tasks/:taskId/checkpoints/latest`

**功能**：获取任务的最新检查点。对应 PRD `CheckpointManager.getLatest()`。

**Response Body (200)**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440110",
  "task_id": "550e8400-e29b-41d4-a716-446655440020",
  "step_index": 3,
  "state": {
    "conversation_history": ["..."],
    "intermediate_results": { "step_1": "...", "step_2": "...", "step_3": "..." }
  },
  "completed_steps": ["step_1", "step_2", "step_3"],
  "pending_steps": ["step_4", "step_5"],
  "metadata": { "reason": "periodic_save" },
  "created_at": "2026-03-21T10:05:00Z"
}
```

### POST `/api/v1/tasks/:taskId/checkpoints/:checkpointId/restore`

**功能**：从指定检查点恢复任务执行。

**Request Body**：无

**Response Body (200)**：

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440020",
  "checkpoint_id": "550e8400-e29b-41d4-a716-446655440110",
  "restored": true,
  "task_state": "queued",
  "resume_from_step": 4
}
```

---

## 二十二、熔断器 (Circuit Breakers)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/circuit-breakers` | 列出所有熔断器状态 | 已认证 |
| GET | `/api/v1/circuit-breakers/:breakerId` | 获取熔断器详情和指标 | 已认证 |
| POST | `/api/v1/circuit-breakers/:breakerId/reset` | 手动重置熔断器 | admin |
| POST | `/api/v1/circuit-breakers/:breakerId/trip` | 手动触发熔断 | admin |

### GET `/api/v1/circuit-breakers`

**功能**：列出租户内所有熔断器的当前状态和指标。

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "cb_openai_gpt4",
      "tenant_id": "acme-corp",
      "target": "llm-provider:openai:gpt-4",
      "state": "closed",
      "failure_count": 1,
      "success_count": 1523,
      "total_requests": 1524,
      "failure_threshold": 5,
      "reset_timeout_ms": 30000,
      "last_success_at": "2026-03-21T10:04:55Z",
      "last_failure_at": "2026-03-21T09:12:00Z",
      "opened_at": null,
      "updated_at": "2026-03-21T10:04:55Z"
    },
    {
      "id": "cb_tool_websearch",
      "tenant_id": "acme-corp",
      "target": "tool:web-search",
      "state": "open",
      "failure_count": 6,
      "success_count": 890,
      "total_requests": 896,
      "failure_threshold": 5,
      "reset_timeout_ms": 30000,
      "last_success_at": "2026-03-21T09:55:00Z",
      "last_failure_at": "2026-03-21T09:57:55Z",
      "opened_at": "2026-03-21T09:58:00Z",
      "updated_at": "2026-03-21T09:58:00Z"
    }
  ]
}
```

### POST `/api/v1/circuit-breakers/:breakerId/reset`

**功能**：手动将熔断器重置为 closed 状态。

**Request Body**：无

**Response Body (200)**：

```json
{
  "id": "cb_tool_websearch",
  "state": "closed",
  "failure_count": 0,
  "reset_at": "2026-03-21T10:10:00Z"
}
```

---

## 二十三、健康检查与指标 (Health & Metrics)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/health` | 系统健康检查（聚合） | 公开 |
| GET | `/api/v1/health/detailed` | 详细健康检查（各后端分项） | admin |
| GET | `/api/v1/metrics` | Prometheus 格式指标端点 | 公开 |

### GET `/api/v1/health`

**功能**：聚合系统健康检查。用于负载均衡器探针。

**Response Body (200)**：

```json
{
  "status": "healthy",
  "version": "2026.3.21",
  "uptime_seconds": 86400,
  "timestamp": "2026-03-21T10:00:00Z"
}
```

**Response Body (503 — 不健康)**：

```json
{
  "status": "unhealthy",
  "version": "2026.3.21",
  "uptime_seconds": 86400,
  "timestamp": "2026-03-21T10:00:00Z",
  "details": {
    "storage": "unhealthy",
    "queue": "healthy"
  }
}
```

### GET `/api/v1/health/detailed`

**功能**：各内核后端和企业模块的详细健康状态。

**Response Body (200)**：

```json
{
  "status": "healthy",
  "components": {
    "storage": {
      "healthy": true,
      "latency_ms": 3,
      "backend": "postgres",
      "details": { "pool_size": 10, "active_connections": 3 }
    },
    "queue": {
      "healthy": true,
      "latency_ms": 1,
      "backend": "redis",
      "details": { "connected_clients": 5, "used_memory_mb": 128 }
    },
    "cache": {
      "healthy": true,
      "latency_ms": 0,
      "backend": "redis"
    },
    "secret": {
      "healthy": true,
      "latency_ms": 5,
      "backend": "vault"
    },
    "event_bus": {
      "healthy": true,
      "latency_ms": 1,
      "backend": "redis"
    },
    "lock": {
      "healthy": true,
      "latency_ms": 1,
      "backend": "redis"
    }
  },
  "enterprise": {
    "governance": {
      "identity_provider": "oidc",
      "policy_engine": "rbac",
      "content_filters_active": 3
    },
    "audit": {
      "sinks": ["log", "webhook"],
      "pipeline_healthy": true,
      "buffered_events": 12
    },
    "isolation": {
      "runtime_backend": "docker",
      "running_instances": 5
    },
    "reliability": {
      "circuit_breakers_open": 1,
      "active_checkpoints": 3
    }
  }
}
```

### GET `/api/v1/metrics`

**功能**：Prometheus 格式的指标导出端点。对应 PRD `MetricsProvider.serialize()`。

**Response Body (200, Content-Type: text/plain)**：

```
# HELP openclaw_api_requests_total Total API requests
# TYPE openclaw_api_requests_total counter
openclaw_api_requests_total{method="GET",path="/api/v1/sessions",status="200"} 1523
openclaw_api_requests_total{method="POST",path="/api/v1/sessions/send",status="200"} 892

# HELP openclaw_api_request_duration_seconds API request duration
# TYPE openclaw_api_request_duration_seconds histogram
openclaw_api_request_duration_seconds_bucket{le="0.01"} 1200
openclaw_api_request_duration_seconds_bucket{le="0.05"} 1400
openclaw_api_request_duration_seconds_bucket{le="0.1"} 1500
openclaw_api_request_duration_seconds_bucket{le="0.5"} 1510
openclaw_api_request_duration_seconds_bucket{le="1"} 1520
openclaw_api_request_duration_seconds_bucket{le="+Inf"} 1523

# HELP openclaw_queue_depth Current queue depth
# TYPE openclaw_queue_depth gauge
openclaw_queue_depth{queue="agent-tasks"} 12
openclaw_queue_depth{queue="message-delivery"} 0

# HELP openclaw_circuit_breaker_state Circuit breaker state (1=active)
# TYPE openclaw_circuit_breaker_state gauge
openclaw_circuit_breaker_state{target="llm-provider:openai",state="closed"} 1
openclaw_circuit_breaker_state{target="tool:web-search",state="open"} 1

# HELP openclaw_audit_events_total Total audit events emitted
# TYPE openclaw_audit_events_total counter
openclaw_audit_events_total{category="data_access"} 15230
openclaw_audit_events_total{category="authentication"} 4521
openclaw_audit_events_total{category="agent_action"} 8920
```

---

## 二十四、平台事件 (Platform Events)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/events` | 查询平台事件 | admin |
| GET | `/api/v1/events/:eventId` | 获取单条平台事件 | admin |
| GET | `/api/v1/events/stream` | SSE 流式订阅平台事件 | admin |

### GET `/api/v1/events`

**功能**：分页查询平台事件。对应 PRD `EventBus` 的持久化查询。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `type` | string | — | 事件类型过滤（支持 `*` 通配） |
| `source` | string | — | 来源模块过滤 |
| `from` | string | — | 起始时间 |
| `to` | string | — | 结束时间 |
| `processed` | boolean | — | 是否已处理 |
| `offset` | integer | 0 | 偏移 |
| `limit` | integer | 20 | 每页数量 |

**Response Body (200)**：

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440120",
      "type": "task.state.changed",
      "tenant_id": "acme-corp",
      "source": "task-fsm-engine",
      "timestamp": "2026-03-21T10:00:01Z",
      "data": {
        "task_id": "550e8400-e29b-41d4-a716-446655440020",
        "from_state": "pending",
        "to_state": "queued",
        "event": "enqueue"
      },
      "metadata": null,
      "processed": true,
      "processed_at": "2026-03-21T10:00:01Z"
    }
  ],
  "total": 156,
  "has_more": true
}
```

### GET `/api/v1/events/stream`

**功能**：SSE 实时流式订阅平台事件。

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `type` | string | 事件类型过滤模式（如 `task.state.*`） |

**Response (Content-Type: text/event-stream)**：

```
event: task.state.changed
data: {"id":"...","type":"task.state.changed","data":{"task_id":"...","from_state":"running","to_state":"completed"}}

event: agent.health
data: {"id":"...","type":"agent.health","data":{"agent_id":"support-bot","status":"healthy"}}
```

---

## 二十五、通用键值存储 (Enterprise KV)

### 端点列表

| HTTP 方法 | URL 路径 | 功能描述 | 权限要求 |
|-----------|---------|---------|---------|
| GET | `/api/v1/kv/:collection` | 列出集合中的键值对 | 租户隔离 |
| GET | `/api/v1/kv/:collection/:key` | 获取指定键的值 | 租户隔离 |
| PUT | `/api/v1/kv/:collection/:key` | 设置/更新键值 | 租户隔离 |
| DELETE | `/api/v1/kv/:collection/:key` | 删除键值 | 租户隔离 |
| POST | `/api/v1/kv/:collection/batch-get` | 批量获取 | 租户隔离 |
| POST | `/api/v1/kv/:collection/batch-set` | 批量设置 | 租户隔离 |

### GET `/api/v1/kv/:collection`

**功能**：分页列出集合中的键值对。对应 PRD `StorageBackend.list()`。

**查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `prefix` | string | — | 键前缀过滤 |
| `offset` | integer | 0 | 偏移 |
| `limit` | integer | 20 | 每页数量 |
| `order_by` | string | `created_at` | 排序字段 |
| `order` | string | `desc` | 排序方向 |

**Response Body (200)**：

```json
{
  "items": [
    {
      "key": "support-bot",
      "value": { "model": "gpt-4o", "temperature": 0.7 },
      "created_at": "2026-03-20T00:00:00Z",
      "updated_at": "2026-03-21T10:00:00Z"
    }
  ],
  "total": 1,
  "has_more": false
}
```

### PUT `/api/v1/kv/:collection/:key`

**功能**：设置或更新键值对。对应 PRD `StorageBackend.set()`。

**Request Body**：

```json
{
  "value": {
    "model": "gpt-4o",
    "temperature": 0.7,
    "max_tokens": 4096
  }
}
```

**Response Body (200)**：

```json
{
  "collection": "agent-configs",
  "key": "support-bot",
  "value": {
    "model": "gpt-4o",
    "temperature": 0.7,
    "max_tokens": 4096
  },
  "updated_at": "2026-03-21T10:00:00Z"
}
```

### POST `/api/v1/kv/:collection/batch-get`

**功能**：批量获取键值。对应 PRD `StorageBackend.batchGet()`。

**Request Body**：

```json
{
  "keys": ["support-bot", "sales-bot", "ops-bot"]
}
```

**Response Body (200)**：

```json
{
  "items": {
    "support-bot": { "model": "gpt-4o", "temperature": 0.7 },
    "sales-bot": { "model": "gpt-4o-mini", "temperature": 0.5 }
  },
  "found": 2,
  "missing": ["ops-bot"]
}
```

### POST `/api/v1/kv/:collection/batch-set`

**功能**：批量设置键值对。对应 PRD `StorageBackend.batchSet()`。

**Request Body**：

```json
{
  "entries": [
    { "key": "support-bot", "value": { "model": "gpt-4o" } },
    { "key": "sales-bot", "value": { "model": "gpt-4o-mini" } }
  ]
}
```

**Response Body (200)**：

```json
{
  "written": 2
}
```

---

## 附录 A：通用规约

### A.1 分页参数

所有返回列表的 GET 端点统一支持以下分页参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `offset` | integer | 0 | 跳过前 N 条记录 |
| `limit` | integer | 20 | 每页返回数量（最大 100） |
| `order_by` | string | `created_at` | 排序字段 |
| `order` | string | `desc` | 排序方向：`asc` / `desc` |

### A.2 分页响应格式

```json
{
  "items": [ "..." ],
  "total": 42,
  "has_more": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `items` | array | 当前页数据 |
| `total` | integer | 满足条件的总记录数 |
| `has_more` | boolean | 是否有更多数据 |

### A.3 通用错误响应

所有端点在异常情况下返回统一格式的错误响应：

**400 Bad Request — 请求验证失败**：

```json
{
  "error": "ValidationError",
  "message": "Invalid request body",
  "details": [
    { "field": "email", "message": "must be a valid email address" },
    { "field": "name", "message": "is required" }
  ],
  "request_id": "req_xyz789"
}
```

**401 Unauthorized — 未认证**：

```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token",
  "request_id": "req_xyz789"
}
```

**403 Forbidden — 权限不足**：

```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions: requires role 'admin'",
  "request_id": "req_xyz789"
}
```

**404 Not Found — 资源不存在**：

```json
{
  "error": "NotFound",
  "message": "Resource not found: agent 'support-bot'",
  "request_id": "req_xyz789"
}
```

**409 Conflict — 状态冲突**：

```json
{
  "error": "IllegalStateTransitionError",
  "message": "Cannot handle event \"complete\" in state \"pending\". Available events: [enqueue, kill]",
  "from_state": "pending",
  "event": "complete",
  "available_events": ["enqueue", "kill"],
  "request_id": "req_xyz789"
}
```

**429 Too Many Requests — 限流**：

```json
{
  "error": "RateLimitExceeded",
  "message": "Rate limit exceeded",
  "retry_after": 30,
  "limit": 120,
  "remaining": 0,
  "reset_at": "2026-03-21T10:06:00Z",
  "request_id": "req_xyz789"
}
```

**500 Internal Server Error — 服务器内部错误**：

```json
{
  "error": "InternalError",
  "message": "An unexpected error occurred",
  "request_id": "req_xyz789"
}
```

### A.4 HTTP 状态码使用约定

| 状态码 | 使用场景 |
|--------|---------|
| 200 OK | GET 成功 / PUT/POST 操作成功（非创建） |
| 201 Created | POST 创建资源成功 |
| 202 Accepted | 异步操作已接受（如消息信封发送） |
| 204 No Content | DELETE 成功 / 无返回体的操作 |
| 400 Bad Request | 请求体验证失败 |
| 401 Unauthorized | 未认证或令牌过期 |
| 403 Forbidden | 认证成功但权限不足 |
| 404 Not Found | 请求的资源不存在 |
| 409 Conflict | 状态冲突（如 FSM 非法转换、唯一约束冲突） |
| 429 Too Many Requests | 限流触发 |
| 500 Internal Server Error | 服务器内部异常 |
| 503 Service Unavailable | 服务不健康（健康检查失败） |

### A.5 权限角色说明

API 端点的权限控制与 RLS 策略保持一致：

| 角色 | 说明 |
|------|------|
| **公开** | 无需认证（仅限 auth/login、health 等） |
| **已认证** | 已通过 AuthN 中间件的任何用户 |
| **自己** | 只能操作自己创建/拥有的资源 |
| **创建者** | 只能操作自己创建的资源（如 Agent 创建者） |
| **被分配者** | 只能操作分配给自己的资源（如 Handoff 被分配者） |
| **editor** | 具有 editor 角色的用户 |
| **admin** | 具有 admin 角色的用户（含 system） |
| **system** | 系统内部调用角色（不暴露给终端用户） |

---

## 附录 B：与 PRD 模块的映射关系

| PRD 模块 | PRD 接口 | API 资源域 |
|---------|---------|-----------|
| 内核抽象层 4.1 | StorageBackend | KV Store (`/api/v1/kv/`) |
| 内核抽象层 4.2 | QueueBackend | Queues (`/api/v1/queues/`) |
| 内核抽象层 4.5 | EventBus | Events (`/api/v1/events/`) |
| 可治理 5.1.1 | IdentityProvider | Auth (`/api/v1/auth/`) |
| 可治理 5.1.2 | PolicyEngine | Policies, AuthZ (`/api/v1/policies/`, `/api/v1/authz/`) |
| 可治理 5.1.3 | ContentFilter | Content Filters (`/api/v1/content-filters/`) |
| 可治理 — | QuotaManager | Quotas (`/api/v1/quotas/`) |
| 可治理 — | UserDirectory | Users, Roles, Groups (`/api/v1/users/`, ...) |
| 可审计 5.2 | AuditPipeline, AuditSink | Audit (`/api/v1/audit/`) |
| 可协作 5.3.1 | Task, TaskFSM | Tasks (`/api/v1/tasks/`) |
| 可协作 5.3.2 | WorkflowEngine | Workflows (`/api/v1/workflows/`) |
| 可协作 — | HandoffManager | Handoffs (`/api/v1/handoffs/`) |
| 可协作 — | KnowledgeStore | Knowledge (`/api/v1/knowledge/`) |
| 可嵌入 5.4 | RestApiBuilder | 本文档整体 |
| 可嵌入 5.4.1 | RateLimiter | Rate Limits (`/api/v1/rate-limits/`) |
| 可嵌入 5.4.3 | MessageEnvelope | Messages (`/api/v1/messages/`) |
| 可嵌入 — | ApiKeyManager | API Keys (`/api/v1/api-keys/`) |
| 可隔离 5.5.1 | AgentRuntimeBackend | Runtime Instances (`/api/v1/runtime-instances/`) |
| 可靠性 5.6.2 | CircuitBreaker | Circuit Breakers (`/api/v1/circuit-breakers/`) |
| 可靠性 5.6.3 | CheckpointManager | Checkpoints (`/api/v1/tasks/:id/checkpoints/`) |
| 可靠性 5.6.5 | MetricsProvider | Metrics (`/api/v1/metrics`) |
| 可靠性 — | HealthAggregator | Health (`/api/v1/health/`) |

---

## 附录 C：与数据库表的映射关系

| API 资源 | 数据库表 | 备注 |
|---------|---------|------|
| Tenants | `tenants` | |
| Users | `users` | |
| Roles | `roles` | |
| Permissions | `permissions` | |
| Role-Permission 关联 | `role_permissions` | |
| User-Role 分配 | `user_role_assignments` | |
| User Groups | `user_groups` | |
| Group Members | `user_group_members` | |
| Policies | `policy_definitions` + `policy_rules` | 策略创建时同步创建规则 |
| Content Filters | `content_filter_rules` | |
| Quotas | `quota_configs` + `quota_usage` | |
| Agents | `agents` | |
| Sessions | `sessions` | RLS 隔离 |
| Session Messages | `session_messages` | RLS 隔离，不可修改/删除 |
| Tasks | `tasks` | FSM 严格管理 state 列 |
| Task Transitions | `task_state_transitions` | 不可变追加 |
| Workflows | `workflow_definitions` + `workflow_steps` + `workflow_transitions` | |
| Workflow Instances | `workflow_instances` + `workflow_step_results` | 列级安全限制 |
| Handoffs | `handoff_requests` | |
| Knowledge | `knowledge_entries` | |
| API Keys | `api_keys` | 不可物理删除 |
| Rate Limits | `rate_limit_configs` | |
| Messages | `message_envelopes` | 不可修改/删除 |
| Audit Events | `audit_events` | 不可修改/删除 |
| Runtime Instances | `runtime_instances` | |
| Queue Messages | `queue_messages` | SKIP LOCKED 消费模式 |
| Checkpoints | `checkpoints` | 不可修改，system 可清理 |
| Circuit Breakers | `circuit_breaker_states` | |
| Platform Events | `platform_events` | 不可删除 |
| KV Store | `enterprise_kv` | RLS 隔离 |
