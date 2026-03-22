/**
 * AuditSink — pluggable audit event destination (PRD §5.2.2).
 *
 * Multiple sinks can be registered in parallel (e.g. file + webhook).
 * Sinks must be highly available; failures should be retried internally.
 */

import type { AuditEvent } from "./audit-event.ts";

export interface AuditSink {
  readonly name: string;

  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  write(event: AuditEvent): Promise<void>;
  writeBatch(events: AuditEvent[]): Promise<void>;

  capabilities(): AuditSinkCapabilities;
}

export interface AuditSinkCapabilities {
  queryable: boolean;
  realtime: boolean;
  tamperProof: boolean;
}
