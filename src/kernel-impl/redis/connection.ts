/**
 * Unified Redis connection factory.
 * Cache, Queue, EventBus, and Lock share the same connection config.
 */

import IORedis from "ioredis";

export interface RedisConnectionConfig {
  url: string;
  maxRetriesPerRequest?: number;
  enableAutoPipelining?: boolean;
  lazyConnect?: boolean;
  keyPrefix?: string;
}

export function createRedisConnection(config: RedisConnectionConfig): IORedis {
  return new IORedis(config.url, {
    maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
    enableAutoPipelining: config.enableAutoPipelining ?? true,
    lazyConnect: config.lazyConnect ?? true,
    keyPrefix: config.keyPrefix,
  });
}
