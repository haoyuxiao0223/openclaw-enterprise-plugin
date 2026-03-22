-- ============================================================================
-- OpenClaw Enterprise — 行级安全策略 (Row-Level Security Policies)
-- 版本: v1.1 (安全加固)
-- 日期: 2026-03-21
-- 基于: PRD v1.0 + 技术实现方案（方案一）+ database-schema.sql
-- ============================================================================
--
-- 设计原则：
-- 1. 租户隔离是架构级约束：所有含 tenant_id 的表必须启用 RLS，
--    确保租户 A 的数据对租户 B 完全不可见。
-- 2. 最小权限原则：每条策略仅授予完成操作所需的最小权限范围。
-- 3. 角色分层：使用 PostgreSQL 会话变量区分 admin / 普通用户 / 系统服务。
-- 4. 审计数据只追加不删改：审计相关表禁止 UPDATE/DELETE。
--
-- 会话变量约定（由应用层在每次请求前通过 SET LOCAL 设置）：
--   openclaw.tenant_id   -- 当前租户 ID（必须）
--   openclaw.user_id     -- 当前用户 ID（可选，系统调用时为空）
--   openclaw.user_role   -- 当前用户角色：'admin' | 'editor' | 'viewer' | 'system'
--
-- PostgreSQL 角色约定：
--   openclaw_app     -- 应用层连接角色（受 RLS 约束）
--   openclaw_admin   -- 管理员角色（仅用于迁移和紧急运维，BYPASSRLS）
-- ============================================================================

-- 创建应用角色（如尚不存在）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openclaw_app') THEN
        CREATE ROLE openclaw_app LOGIN;
    END IF;
END
$$;

-- ============================================================================
-- 辅助函数：安全获取会话变量
-- ============================================================================

CREATE OR REPLACE FUNCTION openclaw_tenant_id() RETURNS VARCHAR(64) AS $$
    SELECT current_setting('openclaw.tenant_id', true);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION openclaw_user_id() RETURNS VARCHAR(128) AS $$
    SELECT current_setting('openclaw.user_id', true);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION openclaw_user_role() RETURNS VARCHAR(20) AS $$
    SELECT current_setting('openclaw.user_role', true);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_openclaw_admin() RETURNS BOOLEAN AS $$
    SELECT current_setting('openclaw.user_role', true) IN ('admin', 'system');
$$ LANGUAGE sql STABLE;


-- ============================================================================
-- 第一部分：内核层 (Kernel Layer)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 tenants — 租户表
-- 策略：
--   SELECT: 用户只能看到自己所属的租户
--   INSERT: 仅 system 角色可创建新租户
--   UPDATE: 仅 admin 可修改自己租户的信息
--   DELETE: 禁止删除（通过 status='deleted' 软删除）
-- ----------------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_select ON tenants
    FOR SELECT
    TO openclaw_app
    USING (id = openclaw_tenant_id());

CREATE POLICY tenants_insert ON tenants
    FOR INSERT
    TO openclaw_app
    WITH CHECK (openclaw_user_role() = 'system');

CREATE POLICY tenants_update ON tenants
    FOR UPDATE
    TO openclaw_app
    USING (id = openclaw_tenant_id() AND is_openclaw_admin())
    WITH CHECK (id = openclaw_tenant_id());

-- 不创建 DELETE 策略 = 禁止删除


-- ----------------------------------------------------------------------------
-- 1.2 enterprise_kv — 通用键值存储
-- 策略：
--   全操作: 只能访问本租户的数据
-- 注意：schema 中已有 tenant_isolation_kv 策略，此处替换为更精细的策略
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation_kv ON enterprise_kv;

ALTER TABLE enterprise_kv FORCE ROW LEVEL SECURITY;

CREATE POLICY kv_select ON enterprise_kv
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY kv_insert ON enterprise_kv
    FOR INSERT
    TO openclaw_app
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY kv_update ON enterprise_kv
    FOR UPDATE
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id())
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY kv_delete ON enterprise_kv
    FOR DELETE
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());


-- ----------------------------------------------------------------------------
-- 1.3 distributed_locks — 分布式锁
-- 策略：
--   锁是跨租户的基础设施资源，但需限制可见性
--   SELECT/INSERT/UPDATE/DELETE: 只有 system/admin 可操作
--   普通用户不应直接接触锁表（通过 LockBackend 接口间接使用）
-- ----------------------------------------------------------------------------
ALTER TABLE distributed_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE distributed_locks FORCE ROW LEVEL SECURITY;

CREATE POLICY locks_all ON distributed_locks
    FOR ALL
    TO openclaw_app
    USING (is_openclaw_admin())
    WITH CHECK (is_openclaw_admin());


-- ============================================================================
-- 第二部分：可治理模块 (Governance)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 users — 用户表
-- 策略：
--   SELECT: 租户内所有用户可见（协作需要看到同事）
--   INSERT: 仅 admin/system 可创建用户
--   UPDATE: 用户可修改自己的信息（display_name/metadata），admin 可修改所有
--   DELETE: 仅 admin 可删除（实际应软删除 status='inactive'）
-- ----------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select ON users
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY users_insert ON users
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY users_update ON users
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            id = openclaw_user_id()        -- 用户修改自己
            OR is_openclaw_admin()          -- admin 修改任何人
        )
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            id = openclaw_user_id()        -- 防止用户篡改 id 伪装他人
            OR is_openclaw_admin()
        )
    );

CREATE POLICY users_delete ON users
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.2 roles — 角色表
-- 策略：
--   SELECT: 租户内所有用户可查看角色列表（用于 UI 展示）
--   INSERT/UPDATE/DELETE: 仅 admin 可管理角色
--   额外约束：系统角色 (is_system=true) 不可被租户删除或修改
-- ----------------------------------------------------------------------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

CREATE POLICY roles_select ON roles
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY roles_insert ON roles
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY roles_update ON roles
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
        AND is_system = FALSE              -- 系统角色不可修改
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
        AND is_system = FALSE              -- 防止通过 UPDATE 将普通角色提升为系统角色
    );

CREATE POLICY roles_delete ON roles
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
        AND is_system = FALSE              -- 系统角色不可删除
    );


-- ----------------------------------------------------------------------------
-- 2.3 permissions — 权限表
-- 策略：
--   SELECT: 租户内所有用户可查看权限定义
--   INSERT/UPDATE/DELETE: 仅 admin 可管理权限
-- ----------------------------------------------------------------------------
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY permissions_select ON permissions
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY permissions_insert ON permissions
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY permissions_update ON permissions
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY permissions_delete ON permissions
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.4 role_permissions — 角色-权限关联表
-- 策略：
--   SELECT: 租户内用户可查看角色权限关联（用于授权检查）
--   INSERT/DELETE: 仅 admin 可管理角色权限映射
-- ----------------------------------------------------------------------------
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY role_perms_select ON role_permissions
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY role_perms_insert ON role_permissions
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY role_perms_delete ON role_permissions
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.5 user_role_assignments — 用户-角色分配表
-- 策略：
--   SELECT: 租户内用户可查看角色分配（授权系统需要）
--   INSERT/DELETE: 仅 admin 可分配/撤销角色
--   额外：用户不能给自己分配/撤销 admin 角色（防止权限提升）
-- ----------------------------------------------------------------------------
ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY user_roles_select ON user_role_assignments
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY user_roles_insert ON user_role_assignments
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
        -- admin 不能自行分配（需要另一个 admin 操作）
        AND NOT (
            user_id = openclaw_user_id()
            AND openclaw_user_role() != 'system'
        )
    );

CREATE POLICY user_roles_delete ON user_role_assignments
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.6 user_groups — 用户组表
-- 策略：
--   SELECT: 租户内所有用户可查看用户组
--   INSERT/UPDATE/DELETE: 仅 admin 可管理用户组
-- ----------------------------------------------------------------------------
ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_groups FORCE ROW LEVEL SECURITY;

CREATE POLICY groups_select ON user_groups
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY groups_insert ON user_groups
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY groups_update ON user_groups
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY groups_delete ON user_groups
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.7 user_group_members — 用户组成员关联表
-- 策略：
--   SELECT: 租户内用户可查看组成员关系
--   INSERT/DELETE: 仅 admin 可管理组成员
-- ----------------------------------------------------------------------------
ALTER TABLE user_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_group_members FORCE ROW LEVEL SECURITY;

CREATE POLICY group_members_select ON user_group_members
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY group_members_insert ON user_group_members
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY group_members_delete ON user_group_members
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.8 policy_definitions — 策略定义表
-- 策略：
--   SELECT: 租户内用户可查看策略（需要用于权限检查缓存）
--   INSERT/UPDATE/DELETE: 仅 admin 可管理策略定义
-- ----------------------------------------------------------------------------
ALTER TABLE policy_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY policy_defs_select ON policy_definitions
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY policy_defs_insert ON policy_definitions
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY policy_defs_update ON policy_definitions
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY policy_defs_delete ON policy_definitions
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.9 policy_rules — 策略规则表
-- 策略：
--   SELECT: 租户内用户可查看（授权引擎需要）
--   INSERT/UPDATE/DELETE: 仅 admin 可管理（随 policy_definitions 级联）
-- ----------------------------------------------------------------------------
ALTER TABLE policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY policy_rules_select ON policy_rules
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY policy_rules_insert ON policy_rules
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY policy_rules_update ON policy_rules
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY policy_rules_delete ON policy_rules
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.10 content_filter_rules — 内容过滤规则表
-- 策略：
--   SELECT: 租户内用户可查看过滤规则（便于了解哪些内容被过滤）
--   INSERT/UPDATE/DELETE: 仅 admin 可管理过滤规则
-- ----------------------------------------------------------------------------
ALTER TABLE content_filter_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_filter_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY filter_rules_select ON content_filter_rules
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY filter_rules_insert ON content_filter_rules
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY filter_rules_update ON content_filter_rules
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY filter_rules_delete ON content_filter_rules
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.11 quota_configs — 配额配置表
-- 策略：
--   SELECT: 租户内用户可查看配额限制（用于 UI 展示剩余额度）
--   INSERT/UPDATE/DELETE: 仅 admin 可管理配额配置
-- ----------------------------------------------------------------------------
ALTER TABLE quota_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quota_configs FORCE ROW LEVEL SECURITY;

CREATE POLICY quota_configs_select ON quota_configs
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY quota_configs_insert ON quota_configs
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY quota_configs_update ON quota_configs
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY quota_configs_delete ON quota_configs
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 2.12 quota_usage — 配额使用记录表
-- 策略：
--   SELECT: 用户可查看自己的用量；admin 可查看租户内所有用量
--   INSERT/UPDATE: admin/system 可写入（配额计数由系统内部维护）
--   DELETE: 仅 system 可清理过期记录
-- ----------------------------------------------------------------------------
ALTER TABLE quota_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE quota_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY quota_usage_select ON quota_usage
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            scope_id = openclaw_user_id()  -- 用户查看自己的用量
            OR is_openclaw_admin()          -- admin 查看全部
        )
    );

CREATE POLICY quota_usage_insert ON quota_usage
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY quota_usage_update ON quota_usage
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY quota_usage_delete ON quota_usage
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() = 'system'
    );


-- ============================================================================
-- 第三部分：可审计模块 (Audit)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.1 audit_events — 审计事件表
-- 策略：
--   SELECT: 仅 admin 可查询审计日志（普通用户无权查看审计记录）
--   INSERT: 租户隔离即可（审计管道不可绕过——任何角色的操作都应能写入审计）
--   UPDATE: 禁止（审计记录不可篡改，这是合规要求）
--   DELETE: 禁止（审计记录不可删除，保留完整审计轨迹）
-- ----------------------------------------------------------------------------
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_select ON audit_events
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY audit_insert ON audit_events
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
    );

-- 无 UPDATE 策略 = 禁止修改审计记录
-- 无 DELETE 策略 = 禁止删除审计记录


-- ============================================================================
-- 第四部分：可协作模块 (Collaboration)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4.1 agents — Agent 定义表
-- 策略：
--   SELECT: 租户内所有用户可查看 Agent 列表
--   INSERT: admin/editor 可创建 Agent
--   UPDATE: admin 可修改任何 Agent；Agent 的创建者也可修改
--   DELETE: 仅 admin 可删除（实际应通过 status='archived' 软删除）
-- ----------------------------------------------------------------------------
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;

CREATE POLICY agents_select ON agents
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY agents_insert ON agents
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY agents_update ON agents
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            created_by = openclaw_user_id()    -- 创建者可修改
            OR is_openclaw_admin()              -- admin 可修改任何
        )
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            created_by = openclaw_user_id()    -- 防止通过 UPDATE created_by 转移所有权
            OR is_openclaw_admin()
        )
    );

CREATE POLICY agents_delete ON agents
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 4.2 tasks — 任务表
-- 策略：
--   SELECT: 用户只能看到自己 Agent 下的任务；admin 可查看租户内全部
--   INSERT: admin/editor/system 可创建任务
--   UPDATE: 仅 system/admin 可更新任务状态（FSM 严格管理状态转换）
--   DELETE: 仅 admin 可删除
-- ----------------------------------------------------------------------------
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tasks_select ON tasks
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            is_openclaw_admin()
            OR EXISTS (
                SELECT 1 FROM agents a
                WHERE a.id = tasks.agent_id
                  AND a.tenant_id = tasks.tenant_id
                  AND a.created_by = openclaw_user_id()
            )
        )
    );

CREATE POLICY tasks_insert ON tasks
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY tasks_update ON tasks
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()  -- 状态转换由 FSM 引擎（system 角色）驱动
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY tasks_delete ON tasks
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 4.3 task_state_transitions — 任务状态转换历史表
-- 策略：
--   SELECT: 租户内用户可查看（通过 task_id 间接关联 tenant）
--   INSERT: 仅 system/admin 可写入（FSM 引擎追加状态转换记录）
--   UPDATE/DELETE: 禁止（状态转换历史不可篡改）
-- 注意：此表无 tenant_id 列，通过 JOIN tasks 隐式关联租户
-- ----------------------------------------------------------------------------
ALTER TABLE task_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_state_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY task_transitions_select ON task_state_transitions
    FOR SELECT
    TO openclaw_app
    USING (
        EXISTS (
            SELECT 1 FROM tasks
            WHERE tasks.id = task_state_transitions.task_id
              AND tasks.tenant_id = openclaw_tenant_id()
        )
    );

CREATE POLICY task_transitions_insert ON task_state_transitions
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        is_openclaw_admin()
        AND EXISTS (
            SELECT 1 FROM tasks
            WHERE tasks.id = task_state_transitions.task_id
              AND tasks.tenant_id = openclaw_tenant_id()
        )
    );

-- 无 UPDATE/DELETE 策略 = 禁止修改/删除状态转换历史


-- ----------------------------------------------------------------------------
-- 4.4 workflow_definitions — 工作流定义表
-- 策略：
--   SELECT: 租户内用户可查看工作流定义
--   INSERT/UPDATE: admin/editor 可管理工作流定义
--   DELETE: 仅 admin 可删除
-- ----------------------------------------------------------------------------
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_defs_select ON workflow_definitions
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY wf_defs_insert ON workflow_definitions
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY wf_defs_update ON workflow_definitions
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY wf_defs_delete ON workflow_definitions
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 4.5 workflow_steps — 工作流步骤表
-- 策略：跟随 workflow_definitions 的租户隔离
-- ----------------------------------------------------------------------------
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_steps_select ON workflow_steps
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY wf_steps_insert ON workflow_steps
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY wf_steps_update ON workflow_steps
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY wf_steps_delete ON workflow_steps
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 4.6 workflow_transitions — 工作流转换表
-- 策略：跟随 workflow_definitions 的租户隔离
-- ----------------------------------------------------------------------------
ALTER TABLE workflow_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_trans_select ON workflow_transitions
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY wf_trans_insert ON workflow_transitions
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY wf_trans_delete ON workflow_transitions
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 4.7 workflow_instances — 工作流实例表
-- 策略：
--   SELECT: 租户内用户可查看工作流实例
--   INSERT: admin/editor/system 可启动工作流
--   UPDATE: system/admin 可更新状态（工作流引擎驱动）
--   DELETE: 仅 admin 可删除
-- ----------------------------------------------------------------------------
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instances FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_inst_select ON workflow_instances
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY wf_inst_insert ON workflow_instances
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY wf_inst_update ON workflow_instances
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            started_by = openclaw_user_id()   -- 启动者可操作
            OR is_openclaw_admin()             -- admin/system 可操作
        )
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            started_by = openclaw_user_id()   -- 防止通过 UPDATE started_by 转移归属
            OR is_openclaw_admin()
        )
    );

CREATE POLICY wf_inst_delete ON workflow_instances
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 4.8 workflow_step_results — 工作流步骤执行结果表
-- 策略：
--   SELECT: 通过 workflow_instances 间接关联租户
--   INSERT: system/admin 可写入（引擎写入步骤结果）
--   UPDATE/DELETE: 禁止（执行结果不可篡改）
-- ----------------------------------------------------------------------------
ALTER TABLE workflow_step_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_results FORCE ROW LEVEL SECURITY;

CREATE POLICY wf_results_select ON workflow_step_results
    FOR SELECT
    TO openclaw_app
    USING (
        EXISTS (
            SELECT 1 FROM workflow_instances wi
            WHERE wi.id = workflow_step_results.instance_id
              AND wi.tenant_id = openclaw_tenant_id()
        )
    );

CREATE POLICY wf_results_insert ON workflow_step_results
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        is_openclaw_admin()
        AND EXISTS (
            SELECT 1 FROM workflow_instances wi
            WHERE wi.id = workflow_step_results.instance_id
              AND wi.tenant_id = openclaw_tenant_id()
        )
    );

-- 无 UPDATE/DELETE 策略 = 禁止修改/删除步骤执行结果


-- ----------------------------------------------------------------------------
-- 4.9 handoff_requests — 人机转交请求表
-- 策略：
--   SELECT: 租户内用户可查看转交请求（被分配者和 admin 都需要可见）
--   INSERT: system/admin/editor 可创建转交请求
--   UPDATE: 被分配的操作员可更新状态（resolution）；admin 可更新任何
--   DELETE: 仅 admin 可删除
-- ----------------------------------------------------------------------------
ALTER TABLE handoff_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY handoff_select ON handoff_requests
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY handoff_insert ON handoff_requests
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY handoff_update ON handoff_requests
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            assigned_to = openclaw_user_id()   -- 被分配的操作员
            OR is_openclaw_admin()              -- admin 可更新任何
        )
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            assigned_to = openclaw_user_id()   -- 防止操作员通过 UPDATE assigned_to 转移工单
            OR is_openclaw_admin()
        )
    );

CREATE POLICY handoff_delete ON handoff_requests
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 4.10 knowledge_entries — 共享知识库表
-- 策略：
--   SELECT: 租户内所有用户可查看知识条目（共享知识库设计）
--   INSERT: admin/editor 可创建知识条目
--   UPDATE: 创建者可修改自己的条目；admin 可修改任何
--   DELETE: 创建者可删除自己的条目；admin 可删除任何
-- ----------------------------------------------------------------------------
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY knowledge_select ON knowledge_entries
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY knowledge_insert ON knowledge_entries
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY knowledge_update ON knowledge_entries
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            created_by = openclaw_user_id()
            OR is_openclaw_admin()
        )
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            created_by = openclaw_user_id()    -- 防止通过 UPDATE created_by 转移条目所有权
            OR is_openclaw_admin()
        )
    );

CREATE POLICY knowledge_delete ON knowledge_entries
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            created_by = openclaw_user_id()
            OR is_openclaw_admin()
        )
    );


-- ============================================================================
-- 第五部分：消息队列持久化 (Queue Backend)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5.1 queue_messages — 队列消息表
-- 策略：
--   SELECT: 租户隔离；admin/system 可查看（worker 进程以 system 角色 dequeue）
--   INSERT: system/admin 可入队
--   UPDATE: system/admin 可更新状态（dequeue, ack, nack）
--   DELETE: system 可清理已完成/死信消息
-- 注意：队列操作由 QueueBackend 内部以 system 角色执行，
--        普通用户不直接操作此表
-- ----------------------------------------------------------------------------
ALTER TABLE queue_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY queue_select ON queue_messages
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'system')
    );

CREATE POLICY queue_insert ON queue_messages
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY queue_update ON queue_messages
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY queue_delete ON queue_messages
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() = 'system'
    );


-- ============================================================================
-- 第六部分：可嵌入模块 (Embedding)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6.1 api_keys — API Key 表
-- 策略：
--   SELECT: 用户只能看到自己创建的 API Key；admin 可看到租户内全部
--   INSERT: 租户内用户可自行创建 API Key
--   UPDATE: 用户可撤销自己的 Key（status→revoked）；admin 可管理全部
--   DELETE: 禁止物理删除（通过 revoke 软失效）
-- ----------------------------------------------------------------------------
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select ON api_keys
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            user_id = openclaw_user_id()    -- 用户只能看自己的 Key
            OR is_openclaw_admin()           -- admin 可看全部
        )
    );

CREATE POLICY api_keys_insert ON api_keys
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            user_id = openclaw_user_id()    -- 只能为自己创建 Key
            OR is_openclaw_admin()           -- admin 可为任何人创建
        )
    );

CREATE POLICY api_keys_update ON api_keys
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            user_id = openclaw_user_id()    -- 用户可撤销自己的 Key
            OR is_openclaw_admin()           -- admin 可管理全部
        )
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            user_id = openclaw_user_id()    -- 防止通过 UPDATE user_id 转移 Key 所有权
            OR is_openclaw_admin()
        )
    );

-- 不创建 DELETE 策略 = 禁止物理删除 API Key


-- ----------------------------------------------------------------------------
-- 6.2 rate_limit_configs — 限流配置表
-- 策略：
--   SELECT: 租户内用户可查看限流配置
--   INSERT/UPDATE/DELETE: 仅 admin 可管理限流配置
-- ----------------------------------------------------------------------------
ALTER TABLE rate_limit_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_configs FORCE ROW LEVEL SECURITY;

CREATE POLICY rate_limit_select ON rate_limit_configs
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY rate_limit_insert ON rate_limit_configs
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY rate_limit_update ON rate_limit_configs
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY rate_limit_delete ON rate_limit_configs
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 6.3 message_envelopes — 消息信封表
-- 策略：
--   SELECT: 租户内用户可查看消息（按会话权限）
--   INSERT: admin/editor/system 可写入
--   UPDATE/DELETE: 禁止（消息不可篡改/删除，保证消息完整性）
-- ----------------------------------------------------------------------------
ALTER TABLE message_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_envelopes FORCE ROW LEVEL SECURITY;

CREATE POLICY envelopes_select ON message_envelopes
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            source_id = openclaw_user_id()       -- 消息发送者可查看
            OR is_openclaw_admin()                -- admin 可查看全部
            OR openclaw_user_role() IN ('editor', 'system')
        )
    );

CREATE POLICY envelopes_insert ON message_envelopes
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

-- 无 UPDATE/DELETE 策略 = 消息不可篡改/删除


-- ============================================================================
-- 第七部分：可隔离模块 (Isolation)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7.1 runtime_instances — Agent 运行时实例表
-- 策略：
--   SELECT: 租户内用户可查看运行时实例状态
--   INSERT/UPDATE: 仅 system/admin 可管理（AgentRuntimeBackend 内部操作）
--   DELETE: 仅 system 可清理已终止实例
-- ----------------------------------------------------------------------------
ALTER TABLE runtime_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_instances FORCE ROW LEVEL SECURITY;

CREATE POLICY runtime_select ON runtime_instances
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY runtime_insert ON runtime_instances
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY runtime_update ON runtime_instances
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY runtime_delete ON runtime_instances
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() = 'system'
    );


-- ============================================================================
-- 第八部分：可靠性模块 (Reliability)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 8.1 checkpoints — 任务检查点表
-- 策略：
--   SELECT: 租户隔离
--   INSERT: system/admin 可创建检查点
--   UPDATE: 禁止（检查点是不可变快照）
--   DELETE: system 可清理过期检查点
-- ----------------------------------------------------------------------------
ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY checkpoints_select ON checkpoints
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY checkpoints_insert ON checkpoints
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

-- 无 UPDATE 策略 = 检查点不可修改

CREATE POLICY checkpoints_delete ON checkpoints
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() = 'system'
    );


-- ----------------------------------------------------------------------------
-- 8.2 circuit_breaker_states — 熔断器状态表
-- 策略：
--   SELECT: 租户内用户可查看熔断器状态（运维监控需要）
--   INSERT/UPDATE: 仅 system/admin 可管理
--   DELETE: 仅 admin 可删除
-- ----------------------------------------------------------------------------
ALTER TABLE circuit_breaker_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_breaker_states FORCE ROW LEVEL SECURITY;

CREATE POLICY cb_select ON circuit_breaker_states
    FOR SELECT
    TO openclaw_app
    USING (tenant_id = openclaw_tenant_id());

CREATE POLICY cb_insert ON circuit_breaker_states
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY cb_update ON circuit_breaker_states
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

CREATE POLICY cb_delete ON circuit_breaker_states
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 8.3 platform_events — 平台事件表
-- 策略：
--   SELECT: 租户隔离；admin/system 可查看
--   INSERT: system/admin 可写入事件
--   UPDATE: system 可标记事件为已处理 (processed=true)
--   DELETE: 禁止（事件日志不可删除，用于回放和审计）
-- ----------------------------------------------------------------------------
ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_events FORCE ROW LEVEL SECURITY;

CREATE POLICY events_select ON platform_events
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY events_insert ON platform_events
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );

CREATE POLICY events_update ON platform_events
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() = 'system'
    )
    WITH CHECK (tenant_id = openclaw_tenant_id());

-- 无 DELETE 策略 = 事件记录不可删除


-- ============================================================================
-- 第九部分：会话管理 (Sessions)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 9.1 sessions — 会话表
-- 策略：
--   SELECT: 用户可查看自己的会话；admin 可查看租户内全部
--   INSERT: 租户内用户可创建会话
--   UPDATE: 会话所属用户可修改（标题/元数据/归档）；admin 可修改全部
--   DELETE: 仅 admin 可删除（建议通过 status='deleted' 软删除）
-- 注意：替换 schema 中已有的 tenant_isolation_sessions 策略
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation_sessions ON sessions;

CREATE POLICY sessions_select ON sessions
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            user_id = openclaw_user_id()      -- 用户查看自己的会话
            OR user_id IS NULL                  -- 无归属的会话（公共）
            OR is_openclaw_admin()              -- admin 查看全部
        )
    );

CREATE POLICY sessions_insert ON sessions
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND openclaw_user_role() IN ('admin', 'editor', 'system')
    );

CREATE POLICY sessions_update ON sessions
    FOR UPDATE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            user_id = openclaw_user_id()      -- 会话所属者可修改
            OR is_openclaw_admin()              -- admin 可修改全部
        )
    )
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
        AND (
            user_id = openclaw_user_id()      -- 防止通过 UPDATE user_id 转移会话所有权
            OR is_openclaw_admin()
        )
    );

CREATE POLICY sessions_delete ON sessions
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ----------------------------------------------------------------------------
-- 9.2 session_messages — 会话消息表
-- 策略：
--   SELECT: 用户可查看自己会话中的消息；admin 可查看全部
--   INSERT: 租户内用户/系统可写入消息
--   UPDATE: 禁止（聊天记录不可篡改）
--   DELETE: 仅 admin 可删除（配合会话删除的级联清理）
-- 注意：替换 schema 中已有的 tenant_isolation_session_msgs 策略
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_isolation_session_msgs ON session_messages;

CREATE POLICY session_msgs_select ON session_messages
    FOR SELECT
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND (
            EXISTS (
                SELECT 1 FROM sessions s
                WHERE s.id = session_messages.session_id
                  AND s.tenant_id = openclaw_tenant_id()
                  AND (
                      s.user_id = openclaw_user_id()
                      OR s.user_id IS NULL
                      OR is_openclaw_admin()
                  )
            )
        )
    );

CREATE POLICY session_msgs_insert ON session_messages
    FOR INSERT
    TO openclaw_app
    WITH CHECK (
        tenant_id = openclaw_tenant_id()
    );

-- 无 UPDATE 策略 = 聊天记录不可篡改

CREATE POLICY session_msgs_delete ON session_messages
    FOR DELETE
    TO openclaw_app
    USING (
        tenant_id = openclaw_tenant_id()
        AND is_openclaw_admin()
    );


-- ============================================================================
-- 第十部分：系统表（无需 RLS）
-- ============================================================================

-- schema_migrations：数据库迁移追踪表
-- 此表为系统级基础设施，不含租户数据，不需要 RLS。
-- 仅 openclaw_admin 角色可操作（DDL 迁移时使用）。


-- ============================================================================
-- 权限授予：确保 openclaw_app 角色可以操作所有业务表
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openclaw_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openclaw_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO openclaw_app;


-- ============================================================================
-- 列级安全 (Column-Level Security)
-- 目标：即使 RLS 允许 UPDATE，也限制应用角色只能更新安全列，
--        不能修改由系统/引擎驱动的关键字段。
-- ============================================================================

-- schema_migrations: 应用角色完全不应操作迁移表，收回全部 DML 权限
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM openclaw_app;

-- workflow_instances: 收回全列 UPDATE 后，仅允许更新安全业务列
REVOKE UPDATE ON workflow_instances FROM openclaw_app;
GRANT UPDATE (state, current_step_id, context, error, completed_at, updated_at)
    ON workflow_instances TO openclaw_app;


-- ============================================================================
-- RLS 策略总结（v1.1 — 安全加固版）
-- ============================================================================
--
-- 与 v1.0 的主要差异（★ 标记）：
--   ★ WITH CHECK 加固：8 张表的 UPDATE WITH CHECK 从纯租户隔离改为
--     同时校验所有权字段，防止通过 UPDATE 转移归属/提权。
--   ★ tasks SELECT：从全租户可见改为仅能看到自己创建的 Agent 下的任务。
--   ★ audit_events INSERT：移除 is_openclaw_admin() 约束，
--     保证审计管道不可绕过（PRD 合规要求）。
--   ★ queue_messages SELECT：从 is_openclaw_admin() 改为
--     admin/system 可读，以便 worker 进程以 system 角色 dequeue。
--   ★ sessions INSERT：增加角色检查，viewer 只读角色不能创建会话。
--   ★ 列级安全：schema_migrations 收回 DML；workflow_instances
--     仅允许更新引擎驱动的安全列。
--
-- ┌────────────────────────────┬──────────────┬─────────────────┬──────────────────────┬──────────────────┐
-- │ 表                         │ SELECT       │ INSERT          │ UPDATE               │ DELETE           │
-- ├────────────────────────────┼──────────────┼─────────────────┼──────────────────────┼──────────────────┤
-- │ tenants                    │ 自己租户      │ system          │ admin                │ 禁止             │
-- │ enterprise_kv              │ 租户隔离      │ 租户隔离        │ 租户隔离             │ 租户隔离         │
-- │ distributed_locks          │ admin        │ admin           │ admin                │ admin            │
-- │ users                      │ 租户隔离      │ admin           │ ★自己/admin(+WC)    │ admin            │
-- │ roles                      │ 租户隔离      │ admin           │ ★admin(非系统)(+WC) │ admin(非系统)    │
-- │ permissions                │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ role_permissions           │ 租户隔离      │ admin           │ —                    │ admin            │
-- │ user_role_assignments      │ 租户隔离      │ admin(非自己)   │ —                    │ admin            │
-- │ user_groups                │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ user_group_members         │ 租户隔离      │ admin           │ —                    │ admin            │
-- │ policy_definitions         │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ policy_rules               │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ content_filter_rules       │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ quota_configs              │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ quota_usage                │ 自己/admin    │ admin           │ admin                │ system           │
-- │ audit_events               │ admin        │ ★租户隔离       │ 禁止                 │ 禁止             │
-- │ agents                     │ 租户隔离      │ admin/editor    │ ★创建者/admin(+WC)  │ admin            │
-- │ tasks                      │ ★自己Agent   │ admin/editor    │ admin                │ admin            │
-- │ task_state_transitions     │ 通过task      │ admin           │ 禁止                 │ 禁止             │
-- │ workflow_definitions       │ 租户隔离      │ admin/editor    │ admin/editor         │ admin            │
-- │ workflow_steps             │ 租户隔离      │ admin/editor    │ admin/editor         │ admin            │
-- │ workflow_transitions       │ 租户隔离      │ admin/editor    │ —                    │ admin            │
-- │ workflow_instances         │ 租户隔离      │ admin/editor    │ ★启动者/admin(+WC)  │ admin            │
-- │ workflow_step_results      │ 通过inst      │ admin           │ 禁止                 │ 禁止             │
-- │ handoff_requests           │ 租户隔离      │ admin/editor    │ ★被分配者/admin(+WC)│ admin            │
-- │ knowledge_entries          │ 租户隔离      │ admin/editor    │ ★创建者/admin(+WC)  │ 创建者/admin     │
-- │ queue_messages             │ ★admin/sys   │ admin           │ admin                │ system           │
-- │ api_keys                   │ 自己/admin    │ 自己/admin      │ ★自己/admin(+WC)    │ 禁止             │
-- │ rate_limit_configs         │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ message_envelopes          │ 发送者/admin  │ admin/editor    │ 禁止                 │ 禁止             │
-- │ runtime_instances          │ 租户隔离      │ admin           │ admin                │ system           │
-- │ checkpoints                │ 租户隔离      │ admin           │ 禁止                 │ system           │
-- │ circuit_breaker_states     │ 租户隔离      │ admin           │ admin                │ admin            │
-- │ platform_events            │ admin        │ admin           │ system               │ 禁止             │
-- │ sessions                   │ 自己/admin    │ ★admin/editor  │ ★自己/admin(+WC)    │ admin            │
-- │ session_messages           │ 自己会话      │ 租户隔离        │ 禁止                 │ admin            │
-- │ schema_migrations          │ 无RLS ★列级  │ ★REVOKE        │ ★REVOKE             │ ★REVOKE          │
-- └────────────────────────────┴──────────────┴─────────────────┴──────────────────────┴──────────────────┘
--
-- (+WC) = WITH CHECK 同时校验所有权字段，防止 UPDATE 转移归属
--
-- 列级安全：
--   - schema_migrations: REVOKE INSERT/UPDATE/DELETE (仅 openclaw_admin 可操作)
--   - workflow_instances: REVOKE UPDATE → GRANT UPDATE (state, current_step_id,
--     context, error, completed_at, updated_at) 仅允许引擎安全列
--
-- 不可变表（禁止 UPDATE + DELETE）的设计理由：
--   - audit_events: 合规审计要求，审计记录不可篡改
--   - task_state_transitions: FSM 状态历史，保证可追溯性
--   - workflow_step_results: 执行结果不可更改，支持断点恢复的确定性
--   - message_envelopes: 消息完整性保证，支持消息追溯和重放
--   - session_messages: 聊天记录不可篡改，审计和回放需要
--   - checkpoints: 检查点是不可变快照，保证恢复确定性
--   - platform_events: 事件日志不可删除，支持回放和审计
