/**
 * MemoryQueueBackend — in-memory reference implementation of QueueBackend.
 *
 * Priority-aware FIFO queue with visibility timeout, DLQ, and
 * delayed scheduling. Single-process only.
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";
import type {
  QueueBackend,
  QueueMessage,
  QueueHandler,
  QueueSubscription,
  EnqueueOptions,
  DequeueOptions,
  NackOptions,
  SubscribeOptions,
} from "../../kernel/queue.ts";
import type { HealthStatus, PaginatedResult } from "../../kernel/types.ts";

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

interface InternalMessage extends QueueMessage {
  state: "pending" | "processing" | "completed" | "dead_letter";
  visibleAfter: Date;
  processingDeadline?: Date;
}

export class MemoryQueueBackend implements QueueBackend {
  private queues = new Map<string, InternalMessage[]>();
  private subscriptions = new Map<string, Array<{ handler: QueueHandler; active: boolean }>>();
  private pollIntervals = new Map<string, ReturnType<typeof setInterval>>();

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {
    for (const interval of this.pollIntervals.values()) clearInterval(interval);
    this.pollIntervals.clear();
    this.queues.clear();
    this.subscriptions.clear();
  }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0, details: { type: "memory" } };
  }

  private getQueue(queue: string): InternalMessage[] {
    let q = this.queues.get(queue);
    if (!q) {
      q = [];
      this.queues.set(queue, q);
    }
    return q;
  }

  async enqueue(
    ctx: TenantContext,
    queue: string,
    message: Omit<QueueMessage, "id" | "attempts" | "createdAt">,
    options?: EnqueueOptions,
  ): Promise<string> {
    const q = this.getQueue(queue);
    const key = options?.idempotencyKey;

    if (key) {
      const dup = q.find(
        (m) => m.idempotencyKey === key && m.state !== "completed" && m.state !== "dead_letter",
      );
      if (dup) return dup.id;
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const visibleAfter = options?.delay ? new Date(now.getTime() + options.delay) : now;

    const msg: InternalMessage = {
      id,
      tenantId: ctx.tenantId,
      type: message.type,
      payload: message.payload,
      priority: options?.priority ?? message.priority ?? "normal",
      idempotencyKey: key,
      scheduledAt: message.scheduledAt,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? message.maxAttempts ?? 3,
      createdAt: now,
      metadata: message.metadata,
      state: "pending",
      visibleAfter,
    };

    q.push(msg);
    this.notifySubscribers(queue);
    return id;
  }

  async dequeue(queue: string, options?: DequeueOptions): Promise<QueueMessage | null> {
    const q = this.getQueue(queue);
    const now = new Date();

    const sortedPending = q
      .filter((m) => m.state === "pending" && m.visibleAfter <= now)
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority ?? "normal"] ?? 1) -
            (PRIORITY_ORDER[b.priority ?? "normal"] ?? 1) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );

    const msg = sortedPending[0];
    if (!msg) return null;

    msg.state = "processing";
    msg.attempts += 1;
    const timeout = options?.visibilityTimeout ?? 30_000;
    msg.processingDeadline = new Date(now.getTime() + timeout);

    return this.toPublicMessage(msg);
  }

  subscribe(
    queue: string,
    handler: QueueHandler,
    _options?: SubscribeOptions,
  ): QueueSubscription {
    let subs = this.subscriptions.get(queue);
    if (!subs) {
      subs = [];
      this.subscriptions.set(queue, subs);
    }
    const entry = { handler, active: true };
    subs.push(entry);

    // Poll for new messages on a short interval
    if (!this.pollIntervals.has(queue)) {
      const interval = setInterval(() => this.processPendingForSubscribers(queue), 100);
      this.pollIntervals.set(queue, interval);
    }

    return {
      unsubscribe: async () => {
        entry.active = false;
      },
    };
  }

  async ack(queue: string, messageId: string): Promise<void> {
    const q = this.getQueue(queue);
    const msg = q.find((m) => m.id === messageId);
    if (msg) msg.state = "completed";
  }

  async nack(queue: string, messageId: string, options?: NackOptions): Promise<void> {
    const q = this.getQueue(queue);
    const msg = q.find((m) => m.id === messageId);
    if (!msg) return;

    if (msg.attempts >= msg.maxAttempts) {
      msg.state = "dead_letter";
    } else {
      msg.state = "pending";
      const delay = options?.redeliveryDelay ?? 1000;
      msg.visibleAfter = new Date(Date.now() + delay);
    }
  }

  async getQueueDepth(queue: string): Promise<number> {
    return this.getQueue(queue).filter((m) => m.state === "pending").length;
  }

  async purge(queue: string): Promise<number> {
    const q = this.getQueue(queue);
    const count = q.filter((m) => m.state === "pending").length;
    const remaining = q.filter((m) => m.state !== "pending");
    this.queues.set(queue, remaining);
    return count;
  }

  async getDeadLetterMessages(
    queue: string,
    options?: { offset?: number; limit?: number },
  ): Promise<PaginatedResult<QueueMessage>> {
    const q = this.getQueue(queue);
    const dlq = q.filter((m) => m.state === "dead_letter");
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    const sliced = dlq.slice(offset, offset + limit);
    return {
      items: sliced.map((m) => this.toPublicMessage(m)),
      total: dlq.length,
      hasMore: offset + limit < dlq.length,
    };
  }

  async replayDeadLetter(queue: string, messageId: string): Promise<void> {
    const q = this.getQueue(queue);
    const msg = q.find((m) => m.id === messageId && m.state === "dead_letter");
    if (!msg) return;
    msg.state = "pending";
    msg.attempts = 0;
    msg.visibleAfter = new Date();
  }

  private toPublicMessage(m: InternalMessage): QueueMessage {
    return {
      id: m.id,
      tenantId: m.tenantId,
      type: m.type,
      payload: m.payload,
      priority: m.priority,
      idempotencyKey: m.idempotencyKey,
      scheduledAt: m.scheduledAt,
      attempts: m.attempts,
      maxAttempts: m.maxAttempts,
      createdAt: m.createdAt,
      metadata: m.metadata,
    };
  }

  private notifySubscribers(queue: string): void {
    // Trigger processing on next tick so enqueue returns first
    setTimeout(() => this.processPendingForSubscribers(queue), 0);
  }

  private async processPendingForSubscribers(queue: string): Promise<void> {
    const subs = this.subscriptions.get(queue)?.filter((s) => s.active);
    if (!subs?.length) return;

    const msg = await this.dequeue(queue);
    if (!msg) return;

    const sub = subs[0]!;
    try {
      await sub.handler(msg);
      await this.ack(queue, msg.id);
    } catch {
      await this.nack(queue, msg.id);
    }
  }
}
