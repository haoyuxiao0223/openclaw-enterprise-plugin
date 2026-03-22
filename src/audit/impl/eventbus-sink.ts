/**
 * EventBusAuditSink — publishes audit events to the EventBus
 * for internal module consumption (metrics, alerting, etc).
 */

import type { EventBus } from "../../kernel/event-bus.ts";
import type { AuditEvent } from "../audit-event.ts";
import type { AuditSink, AuditSinkCapabilities } from "../audit-sink.ts";

export class EventBusAuditSink implements AuditSink {
  readonly name = "eventbus-sink";

  constructor(private eventBus: EventBus) {}

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async write(event: AuditEvent): Promise<void> {
    await this.eventBus.publish({
      id: event.id,
      type: `audit.${event.category}`,
      tenantId: event.tenantId,
      source: "audit-pipeline",
      timestamp: event.timestamp,
      data: event,
    });
  }

  async writeBatch(events: AuditEvent[]): Promise<void> {
    for (const event of events) {
      await this.write(event);
    }
  }

  capabilities(): AuditSinkCapabilities {
    return { queryable: false, realtime: true, tamperProof: false };
  }
}
