/**
 * Redis QueueBackend — BullMQ-based enterprise queue.
 *
 * Mapping PRD interface to BullMQ:
 *   enqueue     → Queue.add
 *   subscribe   → Worker
 *   ack         → auto on worker success
 *   nack        → job.moveToFailed
 *   priority    → BullMQ priority (1=high, 5=normal, 10=low)
 *   delay       → BullMQ delay option
 *   DLQ         → BullMQ failed jobs (exceeded maxAttempts)
 *   idempotency → BullMQ jobId dedup
 */

import { Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import type {
  QueueBackend,
  QueueMessage,
  EnqueueOptions,
  DequeueOptions,
  QueueHandler,
  QueueSubscription,
  SubscribeOptions,
  NackOptions,
} from "../../kernel/queue.ts";
import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { HealthStatus, PaginatedResult } from "../../kernel/types.ts";
import { createRedisConnection, type RedisConnectionConfig } from "./connection.ts";

export class RedisQueueBackend implements QueueBackend {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private connection: IORedis;
  private readonly config: RedisConnectionConfig;

  constructor(config: RedisConnectionConfig) {
    this.config = config;
    this.connection = createRedisConnection(config);
  }

  async initialize(): Promise<void> {
    await this.connection.connect();
    await this.connection.ping();
  }

  async shutdown(): Promise<void> {
    for (const worker of this.workers.values()) await worker.close();
    for (const queue of this.queues.values()) await queue.close();
    this.connection.disconnect();
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.connection.ping();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, details: { error: String(err) } };
    }
  }

  async enqueue(
    ctx: TenantContext,
    queue: string,
    message: Omit<QueueMessage, "id" | "attempts" | "createdAt">,
    options?: EnqueueOptions,
  ): Promise<string> {
    const q = this.getOrCreateQueue(queue);

    const job = await q.add(
      message.type,
      {
        tenantId: ctx.tenantId,
        payload: message.payload,
        metadata: message.metadata,
      },
      {
        jobId: options?.idempotencyKey ?? undefined,
        priority: mapPriority(options?.priority ?? message.priority ?? "normal"),
        delay: options?.delay,
        attempts: options?.maxAttempts ?? message.maxAttempts ?? 3,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    );

    return job.id!;
  }

  async dequeue(queue: string, options?: DequeueOptions): Promise<QueueMessage | null> {
    const q = this.getOrCreateQueue(queue);
    const jobs = await q.getJobs(["waiting"], 0, 0);
    if (jobs.length === 0) return null;

    const job = jobs[0]!;
    return {
      id: job.id!,
      tenantId: job.data.tenantId,
      type: job.name,
      payload: job.data.payload,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 3,
      createdAt: new Date(job.timestamp),
      metadata: job.data.metadata,
    };
  }

  subscribe(queue: string, handler: QueueHandler, options?: SubscribeOptions): QueueSubscription {
    const worker = new Worker(
      queue,
      async (job) => {
        const message: QueueMessage = {
          id: job.id!,
          tenantId: job.data.tenantId,
          type: job.name,
          payload: job.data.payload,
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 3,
          createdAt: new Date(job.timestamp),
          metadata: job.data.metadata,
        };
        await handler(message);
      },
      {
        connection: createRedisConnection(this.config),
        concurrency: options?.concurrency ?? 5,
      },
    );

    this.workers.set(queue, worker);

    return {
      unsubscribe: async () => {
        await worker.close();
        this.workers.delete(queue);
      },
    };
  }

  async ack(_queue: string, _messageId: string): Promise<void> {
    // BullMQ auto-acks on successful worker processing
  }

  async nack(queue: string, messageId: string, _options?: NackOptions): Promise<void> {
    const q = this.getOrCreateQueue(queue);
    const job = await q.getJob(messageId);
    if (job) {
      await job.moveToFailed(new Error("Explicitly nacked"), job.token ?? "0", true);
    }
  }

  async getQueueDepth(queue: string): Promise<number> {
    const q = this.getOrCreateQueue(queue);
    return q.getWaitingCount();
  }

  async purge(queue: string): Promise<number> {
    const q = this.getOrCreateQueue(queue);
    const count = await q.getWaitingCount();
    await q.drain();
    return count;
  }

  async getDeadLetterMessages(
    queue: string,
    options?: { offset?: number; limit?: number },
  ): Promise<PaginatedResult<QueueMessage>> {
    const q = this.getOrCreateQueue(queue);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const failed = await q.getFailed(offset, offset + limit - 1);

    return {
      items: failed.map((job) => ({
        id: job.id!,
        tenantId: job.data.tenantId,
        type: job.name,
        payload: job.data.payload,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 3,
        createdAt: new Date(job.timestamp),
        metadata: job.data.metadata,
      })),
      total: await q.getFailedCount(),
      hasMore: offset + limit < (await q.getFailedCount()),
    };
  }

  async replayDeadLetter(queue: string, messageId: string): Promise<void> {
    const q = this.getOrCreateQueue(queue);
    const job = await q.getJob(messageId);
    if (job) {
      await job.retry();
    }
  }

  private getOrCreateQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, { connection: createRedisConnection(this.config) }));
    }
    return this.queues.get(name)!;
  }
}

function mapPriority(p: "high" | "normal" | "low" | undefined): number {
  if (p === "high") return 1;
  if (p === "low") return 10;
  return 5;
}
