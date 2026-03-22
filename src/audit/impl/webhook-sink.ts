/**
 * Webhook AuditSink — sends audit events to an external HTTP endpoint.
 *
 * Batches events and sends them as JSON arrays. Retries on failure
 * with exponential backoff.
 */

import type { AuditSink, AuditSinkCapabilities } from "../audit-sink.ts";
import type { AuditEvent } from "../audit-event.ts";

export interface WebhookSinkConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

export class WebhookAuditSink implements AuditSink {
  readonly name = "webhook";
  private config: WebhookSinkConfig;

  constructor(config: WebhookSinkConfig) {
    this.config = config;
  }

  capabilities(): AuditSinkCapabilities {
    return { queryable: false, streaming: true, batchSize: 100 };
  }

  async write(event: AuditEvent): Promise<void> {
    await this.send([event]);
  }

  async writeBatch(events: AuditEvent[]): Promise<void> {
    await this.send(events);
  }

  private async send(events: AuditEvent[]): Promise<void> {
    const maxRetries = this.config.maxRetries ?? 3;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs ?? 10_000,
        );

        const response = await fetch(this.config.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
          },
          body: JSON.stringify({ events }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) return;
        lastError = new Error(`Webhook responded with ${response.status}`);
      } catch (err) {
        lastError = err;
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }

    throw lastError;
  }
}
