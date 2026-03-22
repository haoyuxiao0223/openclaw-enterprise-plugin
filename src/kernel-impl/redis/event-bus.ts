/**
 * Redis EventBus — Pub/Sub-based multi-instance event distribution.
 *
 * Uses one ioredis connection for publishing and a separate subscriber
 * connection (ioredis requirement). Pattern subscriptions via PSUBSCRIBE.
 */

import type IORedis from "ioredis";
import type {
  EventBus,
  PlatformEvent,
  EventHandler,
  EventSubscription,
} from "../../kernel/event-bus.ts";
import { createRedisConnection, type RedisConnectionConfig } from "./connection.ts";

const CHANNEL_PREFIX = "oc:events:";

export class RedisEventBus implements EventBus {
  private pub: IORedis;
  private sub: IORedis;
  private handlers = new Map<string, Set<{ pattern: string; handler: EventHandler }>>();
  private channelHandlers = new Map<string, Set<EventHandler>>();

  constructor(config: RedisConnectionConfig) {
    this.pub = createRedisConnection(config);
    this.sub = createRedisConnection({ ...config, enableAutoPipelining: false });
  }

  async initialize(): Promise<void> {
    await Promise.all([this.pub.connect(), this.sub.connect()]);

    this.sub.on("pmessage", (_pattern: string, channel: string, message: string) => {
      const event = JSON.parse(message) as PlatformEvent;
      event.timestamp = new Date(event.timestamp);
      const eventType = channel.slice(CHANNEL_PREFIX.length);

      for (const [, handlerSet] of this.handlers) {
        for (const { pattern, handler } of handlerSet) {
          if (matchPattern(pattern, eventType)) {
            handler(event).catch((err) =>
              console.error(`RedisEventBus handler error [${pattern}]:`, err),
            );
          }
        }
      }

      const exact = this.channelHandlers.get(eventType);
      if (exact) {
        for (const h of exact) {
          h(event).catch((err) =>
            console.error(`RedisEventBus exact handler error [${eventType}]:`, err),
          );
        }
      }
    });

    await this.sub.psubscribe(`${CHANNEL_PREFIX}*`);
  }

  async shutdown(): Promise<void> {
    await this.sub.punsubscribe();
    this.sub.disconnect();
    this.pub.disconnect();
    this.handlers.clear();
    this.channelHandlers.clear();
  }

  async publish(event: PlatformEvent): Promise<void> {
    const channel = `${CHANNEL_PREFIX}${event.type}`;
    await this.pub.publish(channel, JSON.stringify(event));
  }

  async publishBatch(events: PlatformEvent[]): Promise<void> {
    const pipeline = this.pub.pipeline();
    for (const event of events) {
      pipeline.publish(`${CHANNEL_PREFIX}${event.type}`, JSON.stringify(event));
    }
    await pipeline.exec();
  }

  subscribe(pattern: string, handler: EventHandler): EventSubscription {
    const id = crypto.randomUUID();
    const entry = { pattern, handler };
    if (!this.handlers.has(id)) {
      this.handlers.set(id, new Set());
    }
    this.handlers.get(id)!.add(entry);

    return {
      unsubscribe: () => {
        this.handlers.get(id)?.delete(entry);
        if (this.handlers.get(id)?.size === 0) {
          this.handlers.delete(id);
        }
      },
    };
  }

  async once(pattern: string, timeoutMs: number): Promise<PlatformEvent> {
    return new Promise<PlatformEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`RedisEventBus.once timeout after ${timeoutMs}ms for: ${pattern}`));
      }, timeoutMs);

      const sub = this.subscribe(pattern, async (event) => {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(event);
      });
    });
  }
}

function matchPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return eventType.startsWith(pattern.slice(0, -2) + ".");
  }
  return pattern === eventType;
}
