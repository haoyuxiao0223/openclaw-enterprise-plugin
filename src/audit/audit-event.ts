/**
 * AuditEvent — the standard audit event type (PRD §5.2.1).
 *
 * Every operation that flows through the Gateway middleware chain
 * automatically produces an AuditEvent. The audit pipeline is
 * mandatory and cannot be bypassed.
 */

export interface AuditEvent {
  id: string;
  timestamp: Date;
  version: "1.0";

  tenantId: string;
  actor: AuditActor;

  action: string;
  category: AuditCategory;
  outcome: "success" | "failure" | "denied";

  resource: AuditResource;
  source: AuditSource;

  details?: Record<string, unknown>;
  duration?: number;
  error?: string;
}

export type AuditCategory =
  | "authentication"
  | "authorization"
  | "data_access"
  | "data_mutation"
  | "agent_action"
  | "tool_execution"
  | "config_change"
  | "admin_action"
  | "system_event";

export interface AuditActor {
  type: "user" | "agent" | "system" | "api_key";
  id: string;
  name?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditResource {
  type: string;
  id?: string;
  name?: string;
  tenantId: string;
}

export interface AuditSource {
  service: string;
  instance?: string;
  requestId: string;
}
