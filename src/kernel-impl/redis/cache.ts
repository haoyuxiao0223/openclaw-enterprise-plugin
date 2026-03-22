/**
 * Redis CacheBackend — enterprise production cache.
 *
 * Uses ioredis for all cache operations with native TTL support,
 * atomic INCR for counters, and SET NX for distributed dedup.
 */

import type IORedis from "ioredis";
import type { CacheBackend } from "../../kernel/cache.ts";
import { createRedisConnection, type RedisConnectionConfig } from "./connection.ts";

export class RedisCacheBackend implements CacheBackend {
  private client: IORedis;
  private readonly prefix: string;

  constructor(config: RedisConnectionConfig) {
    this.client = createRedisConnection(config);
    this.prefix = config.keyPrefix ?? "oc:cache:";
  }

  async initialize(): Promise<void> {
    await this.client.connect();
    await this.client.ping();
  }

  async shutdown(): Promise<void> {
    this.client.disconnect();
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.k(key));
    return raw !== null ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlMs && ttlMs > 0) {
      await this.client.set(this.k(key), serialized, "PX", ttlMs);
    } else {
      await this.client.set(this.k(key), serialized);
    }
  }

  async delete(key: string): Promise<boolean> {
    const count = await this.client.del(this.k(key));
    return count > 0;
  }

  async has(key: string): Promise<boolean> {
    const exists = await this.client.exists(this.k(key));
    return exists > 0;
  }

  async increment(key: string, delta = 1, ttlMs?: number): Promise<number> {
    const k = this.k(key);
    let result: number;

    if (delta === 1) {
      result = await this.client.incr(k);
    } else {
      result = await this.client.incrby(k, delta);
    }

    if (ttlMs && ttlMs > 0) {
      const currentTtl = await this.client.pttl(k);
      if (currentTtl < 0) {
        await this.client.pexpire(k, ttlMs);
      }
    }

    return result;
  }

  async setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(
      this.k(key),
      JSON.stringify(value),
      "PX",
      ttlMs,
      "NX",
    );
    return result === "OK";
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }
}
