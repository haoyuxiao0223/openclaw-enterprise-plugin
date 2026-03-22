/**
 * LogAuditSink — writes audit events to stdout/file (default sink).
 */

import type { AuditEvent } from "../audit-event.ts";
import type { AuditSink, AuditSinkCapabilities } from "../audit-sink.ts";

export class LogAuditSink implements AuditSink {
  readonly name = "log-sink";
  private logFn: (line: string) => void;

  constructor(logFn?: (line: string) => void) {
    this.logFn = logFn ?? ((line) => console.log(line));
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async write(event: AuditEvent): Promise<void> {
    this.logFn(JSON.stringify(event));
  }

  async writeBatch(events: AuditEvent[]): Promise<void> {
    for (const event of events) {
      this.logFn(JSON.stringify(event));
    }
  }

  capabilities(): AuditSinkCapabilities {
    return { queryable: false, realtime: true, tamperProof: false };
  }
}
