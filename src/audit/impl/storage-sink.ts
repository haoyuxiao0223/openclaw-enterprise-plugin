/**
 * Storage AuditSink — persists audit events to StorageBackend.
 *
 * When backed by PostgreSQL, events go to the audit_events table.
 * Supports querying via the StorageBackend.list interface.
 */

import type { AuditSink, AuditSinkCapabilities } from "../audit-sink.ts";
import type { AuditEvent } from "../audit-event.ts";
import type { StorageBackend } from "../../kernel/storage.ts";
import { createDefaultTenantContext } from "../../kernel/tenant-context.ts";

const COLLECTION = "audit_events";

export class StorageAuditSink implements AuditSink {
  readonly name = "storage";
  private storage: StorageBackend;

  constructor(storage: StorageBackend) {
    this.storage = storage;
  }

  capabilities(): AuditSinkCapabilities {
    return { queryable: true, streaming: false, batchSize: 500 };
  }

  async write(event: AuditEvent): Promise<void> {
    const ctx = createDefaultTenantContext({ tenantId: event.tenantId });
    await this.storage.set(ctx, COLLECTION, event.id, event);
  }

  async writeBatch(events: AuditEvent[]): Promise<void> {
    if (events.length === 0) return;
    const ctx = createDefaultTenantContext({ tenantId: events[0]!.tenantId });
    const entries = events.map((e) => ({ key: e.id, value: e }));
    await this.storage.batchSet(ctx, COLLECTION, entries);
  }
}
