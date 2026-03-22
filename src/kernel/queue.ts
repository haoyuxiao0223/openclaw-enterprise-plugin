/**
 * QueueBackend — pluggable task/message queue abstraction.
 *
 * PRD §4.2: Replaces the current in-memory command queue and followup queue
 * with a unified interface supporting priorities, delayed scheduling,
 * idempotency, retry with DLQ, and both pull/push consumption models.
 *
 * Reference implementations:
 *  - MemoryQueueBackend   (wraps existing command-queue.ts)
 *  - RedisQueueBackend    (BullMQ-based, enterprise production)
 *  - PostgresQueueBackend (SKIP LOCKED pattern, lightweight enterprise)
 */

import type { TenantContext } from "./tenant-context.ts";
import type { BackendLifecycle, HealthStatus, PaginatedResult } from "./types.ts";

export interface QueueMessage {
  id: string;
  tenantId: string;
  type: string;
  payload: unknown;
  priority?: QueuePriority;
  idempotencyKey?: string;
  scheduledAt?: Date;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  metadata?: Record<string, string>;
}

export type QueuePriority = "high" | "normal" | "low";

export interface EnqueueOptions {
  priority?: QueuePriority;
  /** Delay in milliseconds before the message becomes visible. */
  delay?: number;
  idempotencyKey?: string;
  maxAttempts?: number;
  /** Message TTL in milliseconds. */
  ttl?: number;
}

export interface DequeueOptions {
  /** Long-poll wait time in milliseconds. */
  waitTimeMs?: number;
  /** Auto-nack timeout if consumer doesn't ack in time. */
  visibilityTimeout?: number;
}

export interface QueueHandler {
  (message: QueueMessage): Promise<void>;
}

export interface QueueSubscription {
  unsubscribe(): Promise<void>;
}

export interface SubscribeOptions {
  concurrency?: number;
}

export interface NackOptions {
  /** Delay before the message becomes visible again. */
  redeliveryDelay?: number;
}

export interface QueueBackend extends BackendLifecycle {
  healthCheck(): Promise<HealthStatus>;

  enqueue(
    ctx: TenantContext,
    queue: string,
    message: Omit<QueueMessage, "id" | "attempts" | "createdAt">,
    options?: EnqueueOptions,
  ): Promise<string>;

  dequeue(queue: string, options?: DequeueOptions): Promise<QueueMessage | null>;
  subscribe(queue: string, handler: QueueHandler, options?: SubscribeOptions): QueueSubscription;

  ack(queue: string, messageId: string): Promise<void>;
  nack(queue: string, messageId: string, options?: NackOptions): Promise<void>;

  getQueueDepth(queue: string): Promise<number>;
  purge(queue: string): Promise<number>;

  getDeadLetterMessages(
    queue: string,
    options?: { offset?: number; limit?: number },
  ): Promise<PaginatedResult<QueueMessage>>;
  replayDeadLetter(queue: string, messageId: string): Promise<void>;
}
