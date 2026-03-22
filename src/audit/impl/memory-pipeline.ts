/**
 * MemoryAuditPipeline — in-memory reference implementation of AuditPipeline.
 *
 * Buffers events and flushes to registered sinks asynchronously.
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { PaginatedResult } from "../../kernel/types.ts";
import type { AuditEvent } from "../audit-event.ts";
import type { AuditSink } from "../audit-sink.ts";
import type { AuditPipeline, AuditQuery, AuditMetrics } from "../audit-pipeline.ts";

export class MemoryAuditPipeline implements AuditPipeline {
  private sinks: AuditSink[] = [];
  private buffer: AuditEvent[] = [];
  private totalEmitted = 0;
  private flushInterval: ReturnType<typeof setInterval> | undefined;
  private allEvents: AuditEvent[] = [];

  constructor(private flushIntervalMs = 1000, private batchSize = 100) {}

  registerSink(sink: AuditSink): void {
    this.sinks.push(sink);
  }

  emit(event: AuditEvent): void {
    this.buffer.push(event);
    this.allEvents.push(event);
    this.totalEmitted++;

    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  async query(ctx: TenantContext, query: AuditQuery): Promise<PaginatedResult<AuditEvent>> {
    let filtered = this.allEvents.filter((e) => e.tenantId === ctx.tenantId);

    if (query.from) filtered = filtered.filter((e) => e.timestamp >= query.from!);
    if (query.to) filtered = filtered.filter((e) => e.timestamp <= query.to!);
    if (query.category) filtered = filtered.filter((e) => e.category === query.category);
    if (query.action) filtered = filtered.filter((e) => e.action === query.action);
    if (query.actorId) filtered = filtered.filter((e) => e.actor.id === query.actorId);
    if (query.outcome) filtered = filtered.filter((e) => e.outcome === query.outcome);
    if (query.resourceType) filtered = filtered.filter((e) => e.resource.type === query.resourceType);
    if (query.requestId) filtered = filtered.filter((e) => e.source.requestId === query.requestId);

    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const sliced = filtered.slice(offset, offset + limit);

    return {
      items: sliced,
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
    };
  }

  getMetrics(): AuditMetrics {
    return {
      bufferedEvents: this.buffer.length,
      totalEmitted: this.totalEmitted,
      sinkCount: this.sinks.length,
    };
  }

  start(): void {
    this.flushInterval = setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  stop(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);

    await Promise.allSettled(
      this.sinks.map((sink) => sink.writeBatch(batch)),
    );
  }
}
