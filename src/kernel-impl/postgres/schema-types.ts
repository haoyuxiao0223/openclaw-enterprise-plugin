/**
 * Kysely database schema types — compile-time table/column checking.
 * Mirrors database-schema.sql definitions.
 */

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

export interface DatabaseSchema {
  tenants: TenantsTable;
  enterprise_kv: EnterpriseKvTable;
  distributed_locks: DistributedLocksTable;
  users: UsersTable;
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  user_role_assignments: UserRoleAssignmentsTable;
  policy_definitions: PolicyDefinitionsTable;
  policy_rules: PolicyRulesTable;
  content_filter_rules: ContentFilterRulesTable;
  quota_definitions: QuotaDefinitionsTable;
  agents: AgentsTable;
  sessions: SessionsTable;
  session_messages: SessionMessagesTable;
  tasks: TasksTable;
  workflows: WorkflowsTable;
  workflow_instances: WorkflowInstancesTable;
  handoff_requests: HandoffRequestsTable;
  knowledge_entries: KnowledgeEntriesTable;
  queue_messages: QueueMessagesTable;
  api_keys: ApiKeysTable;
  rate_limit_rules: RateLimitRulesTable;
  message_envelope_log: MessageEnvelopeLogTable;
  runtime_instances: RuntimeInstancesTable;
  checkpoints: CheckpointsTable;
  circuit_breaker_states: CircuitBreakerStatesTable;
  platform_events: PlatformEventsTable;
  audit_events: AuditEventsTable;
  schema_migrations: SchemaMigrationsTable;
}

// ----- Kernel Layer -----

interface TenantsTable {
  id: string;
  name: string;
  display_name: string | null;
  status: string;
  settings: ColumnType<unknown, string, string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface EnterpriseKvTable {
  tenant_id: string;
  collection: string;
  key: string;
  value: ColumnType<unknown, string, string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface DistributedLocksTable {
  lock_key: string;
  token: string;
  holder_id: string;
  expires_at: Date;
  acquired_at: ColumnType<Date, Date | undefined, never>;
  metadata: ColumnType<unknown, string | undefined, string | undefined>;
}

// ----- Governance -----

interface UsersTable {
  id: string;
  tenant_id: string;
  email: string | null;
  display_name: string | null;
  identity_source: string;
  external_id: string | null;
  status: string;
  metadata: ColumnType<unknown, string, string>;
  last_login_at: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface RolesTable {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface PermissionsTable {
  id: string;
  tenant_id: string;
  action: string;
  resource_type: string;
  description: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface RolePermissionsTable {
  tenant_id: string;
  role_id: string;
  permission_id: string;
  granted_at: ColumnType<Date, Date | undefined, never>;
}

interface UserRoleAssignmentsTable {
  tenant_id: string;
  user_id: string;
  role_id: string;
  assigned_by: string | null;
  assigned_at: ColumnType<Date, Date | undefined, never>;
  expires_at: Date | null;
}

interface PolicyDefinitionsTable {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  version: number;
  is_active: boolean;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface PolicyRulesTable {
  id: Generated<string>;
  tenant_id: string;
  policy_id: string;
  effect: string;
  subjects: string[];
  actions: string[];
  resources: string[];
  conditions: ColumnType<unknown, string | undefined, string | undefined>;
  priority: number;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface ContentFilterRulesTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  pattern_type: string;
  pattern: string;
  action: string;
  direction: string;
  severity: string;
  replacement: string | null;
  is_active: boolean;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface QuotaDefinitionsTable {
  id: Generated<string>;
  tenant_id: string;
  resource_type: string;
  scope: string;
  scope_id: string | null;
  max_value: number;
  current_value: number;
  window_type: string;
  window_start: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

// ----- Collaboration -----

interface AgentsTable {
  id: string;
  tenant_id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  model_provider: string | null;
  model_name: string | null;
  system_prompt: string | null;
  tools: ColumnType<unknown, string, string>;
  settings: ColumnType<unknown, string, string>;
  status: string;
  created_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface SessionsTable {
  id: string;
  tenant_id: string;
  session_key: string;
  agent_id: string;
  user_id: string | null;
  state: string;
  state_history: ColumnType<unknown, string, string>;
  metadata: ColumnType<unknown, string, string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  last_activity_at: Date | null;
}

interface SessionMessagesTable {
  id: Generated<string>;
  tenant_id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: ColumnType<unknown, string | undefined, never>;
  tool_results: ColumnType<unknown, string | undefined, never>;
  tokens_used: number | null;
  model: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface TasksTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  session_key: string | null;
  parent_task_id: string | null;
  type: string;
  state: string;
  state_history: ColumnType<unknown, string, string>;
  input: ColumnType<unknown, string, string>;
  output: ColumnType<unknown, string | undefined, string | undefined>;
  error: ColumnType<unknown, string | undefined, string | undefined>;
  priority: string;
  timeout_ms: number;
  max_attempts: number;
  attempt_count: number;
  idempotency_key: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  started_at: Date | null;
  completed_at: Date | null;
}

interface WorkflowsTable {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  version: number;
  definition: ColumnType<unknown, string, string>;
  is_active: boolean;
  created_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface WorkflowInstancesTable {
  id: Generated<string>;
  tenant_id: string;
  workflow_id: string;
  workflow_version: number;
  state: string;
  current_step_id: string | null;
  input: ColumnType<unknown, string, string>;
  output: ColumnType<unknown, string | undefined, string | undefined>;
  error: string | null;
  started_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  completed_at: Date | null;
}

interface HandoffRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  task_id: string | null;
  session_key: string | null;
  agent_id: string;
  reason: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  resolution: ColumnType<unknown, string | undefined, string | undefined>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  expires_at: Date | null;
  resolved_at: Date | null;
}

interface KnowledgeEntriesTable {
  id: Generated<string>;
  tenant_id: string;
  namespace: string;
  key: string;
  content: string;
  content_type: string;
  tags: string[];
  metadata: ColumnType<unknown, string, string>;
  created_by: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

// ----- Embedding -----

interface QueueMessagesTable {
  id: Generated<string>;
  tenant_id: string;
  queue_name: string;
  message_type: string;
  payload: ColumnType<unknown, string, string>;
  priority: number;
  state: string;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  visible_after: Date;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface ApiKeysTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string | null;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface RateLimitRulesTable {
  id: Generated<string>;
  tenant_id: string;
  scope: string;
  resource: string;
  max_requests: number;
  window_ms: number;
  burst_size: number | null;
  is_active: boolean;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface MessageEnvelopeLogTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  session_key: string | null;
  direction: string;
  content_type: string;
  payload_summary: string | null;
  idempotency_key: string | null;
  trace_id: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  processed_at: Date | null;
}

// ----- Isolation -----

interface RuntimeInstancesTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  runtime_type: string;
  state: string;
  spec: ColumnType<unknown, string, string>;
  metrics: ColumnType<unknown, string | undefined, string | undefined>;
  external_id: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  started_at: Date | null;
  stopped_at: Date | null;
}

// ----- Reliability -----

interface CheckpointsTable {
  id: Generated<string>;
  tenant_id: string;
  target_id: string;
  target_type: string;
  state: ColumnType<unknown, string, string>;
  step_index: number | null;
  completed_steps: string[];
  pending_steps: string[];
  metadata: ColumnType<unknown, string, string>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface CircuitBreakerStatesTable {
  id: string;
  tenant_id: string;
  service_name: string;
  state: string;
  failure_count: number;
  success_count: number;
  last_failure_at: Date | null;
  last_success_at: Date | null;
  opened_at: Date | null;
  config: ColumnType<unknown, string, string>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface PlatformEventsTable {
  id: Generated<string>;
  tenant_id: string;
  event_type: string;
  source: string;
  data: ColumnType<unknown, string, string>;
  metadata: ColumnType<unknown, string | undefined, string | undefined>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface AuditEventsTable {
  id: Generated<string>;
  tenant_id: string;
  timestamp: Date;
  actor_type: string;
  actor_id: string;
  action: string;
  category: string;
  outcome: string;
  resource_type: string | null;
  resource_id: string | null;
  source_ip: string | null;
  source_user_agent: string | null;
  source_component: string | null;
  details: ColumnType<unknown, string | undefined, never>;
  duration_ms: number | null;
  error_message: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

interface SchemaMigrationsTable {
  version: string;
  name: string;
  applied_at: ColumnType<Date, Date | undefined, never>;
  checksum: string | null;
}

// ----- Utility Types -----

export type Tenant = Selectable<TenantsTable>;
export type NewTenant = Insertable<TenantsTable>;
export type TenantUpdate = Updateable<TenantsTable>;

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type Role = Selectable<RolesTable>;
export type NewRole = Insertable<RolesTable>;

export type AuditEventRow = Selectable<AuditEventsTable>;
export type NewAuditEventRow = Insertable<AuditEventsTable>;

export type TaskRow = Selectable<TasksTable>;
export type NewTaskRow = Insertable<TasksTable>;
