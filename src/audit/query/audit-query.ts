/**
 * AuditQuery — structured query interface for audit event retrieval (PRD §5.2).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { PaginatedResult } from "../../kernel/types.ts";
import type { AuditEvent, AuditCategory } from "../audit-event.ts";

export interface AuditQuery {
  from?: Date;
  to?: Date;
  category?: AuditCategory;
  action?: string;
  actorId?: string;
  outcome?: "success" | "failure" | "denied";
  resourceType?: string;
  requestId?: string;
  offset?: number;
  limit?: number;
}

export interface AuditQueryService {
  query(ctx: TenantContext, query: AuditQuery): Promise<PaginatedResult<AuditEvent>>;
  getById(ctx: TenantContext, eventId: string): Promise<AuditEvent | null>;
  getMetrics(ctx: TenantContext): Promise<AuditMetrics>;
}

export interface AuditMetrics {
  bufferedEvents: number;
  totalEmitted: number;
  sinkCount: number;
  sinks: Array<{
    name: string;
    status: "healthy" | "degraded" | "unhealthy";
    eventsWritten: number;
    capabilities: { queryable: boolean; realtime: boolean; tamperProof: boolean };
  }>;
}
