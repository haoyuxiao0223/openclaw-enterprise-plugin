/**
 * AuditPipeline — the central audit engine (PRD §5.2.3).
 *
 * Maintains an async buffer that batches events and writes them
 * to all registered sinks in parallel. Non-blocking to avoid
 * impacting business request latency.
 */

import type { TenantContext } from "../kernel/tenant-context.ts";
import type { PaginatedResult } from "../kernel/types.ts";
import type { AuditEvent } from "./audit-event.ts";
import type { AuditSink } from "./audit-sink.ts";

export interface AuditQuery {
  from?: Date;
  to?: Date;
  category?: string;
  action?: string;
  actorId?: string;
  outcome?: string;
  resourceType?: string;
  requestId?: string;
  offset?: number;
  limit?: number;
}

export interface AuditMetrics {
  bufferedEvents: number;
  totalEmitted: number;
  sinkCount: number;
}

export interface AuditPipeline {
  registerSink(sink: AuditSink): void;
  emit(event: AuditEvent): void;
  query(ctx: TenantContext, query: AuditQuery): Promise<PaginatedResult<AuditEvent>>;
  getMetrics(): AuditMetrics;
}
