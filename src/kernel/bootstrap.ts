/**
 * Kernel Bootstrap — factory that wires up all kernel backends
 * based on the enterprise configuration.
 *
 * When enterprise mode is disabled, all backends default to their
 * in-memory / zero-dependency implementations, preserving personal-edition
 * behavior with zero external dependencies.
 */

import type { StorageBackend } from "./storage.ts";
import type { QueueBackend } from "./queue.ts";
import type { CacheBackend } from "./cache.ts";
import type { SecretBackend } from "./secret.ts";
import type { EventBus } from "./event-bus.ts";
import type { LockBackend } from "./lock.ts";
import type { EnterpriseConfig } from "./config.ts";

import { MemoryStorageBackend } from "../kernel-impl/memory/storage.ts";
import { MemoryQueueBackend } from "../kernel-impl/memory/queue.ts";
import { MemoryCacheBackend } from "../kernel-impl/memory/cache.ts";
import { EnvSecretBackend } from "../kernel-impl/memory/secret.ts";
import { InProcessEventBus } from "../kernel-impl/memory/event-bus.ts";
import { InProcessLockBackend } from "../kernel-impl/memory/lock.ts";

/**
 * Holds references to all active kernel backends.
 * Passed to enterprise modules during initialization.
 */
export interface KernelContext {
  readonly storage: StorageBackend;
  readonly queue: QueueBackend;
  readonly cache: CacheBackend;
  readonly secret: SecretBackend;
  readonly eventBus: EventBus;
  readonly lock: LockBackend;
  readonly config: EnterpriseConfig;
}

/**
 * Bootstrap the kernel: instantiate and initialize all backends.
 * This is the single entry point for enterprise infrastructure setup.
 */
export async function bootstrapKernel(config: EnterpriseConfig): Promise<KernelContext> {
  const [storage, queue, cache, secret, eventBus, lock] = await Promise.all([
    resolveStorageBackend(config),
    resolveQueueBackend(config),
    resolveCacheBackend(config),
    resolveSecretBackend(config),
    resolveEventBus(config),
    resolveLockBackend(config),
  ]);

  // Initialize all backends in parallel
  await Promise.all([
    storage.initialize(),
    queue.initialize(),
    cache.initialize(),
    secret.initialize(),
    eventBus.initialize(),
    lock.initialize(),
  ]);

  return { storage, queue, cache, secret, eventBus, lock, config };
}

/**
 * Gracefully shut down all kernel backends.
 */
export async function shutdownKernel(ctx: KernelContext): Promise<void> {
  await Promise.allSettled([
    ctx.storage.shutdown(),
    ctx.queue.shutdown(),
    ctx.cache.shutdown(),
    ctx.secret.shutdown(),
    ctx.eventBus.shutdown(),
    ctx.lock.shutdown(),
  ]);
}

async function resolveStorageBackend(config: EnterpriseConfig): Promise<StorageBackend> {
  const selector = config.kernel?.storage;
  switch (selector?.backend) {
    case "postgres": {
      const { PostgresStorageBackend } = await import("../kernel-impl/postgres/storage.ts");
      return new PostgresStorageBackend(selector);
    }
    default:
      return new MemoryStorageBackend();
  }
}

async function resolveQueueBackend(config: EnterpriseConfig): Promise<QueueBackend> {
  const selector = config.kernel?.queue;
  switch (selector?.backend) {
    case "redis": {
      const { RedisQueueBackend } = await import("../kernel-impl/redis/queue.ts");
      return new RedisQueueBackend({ url: selector["url"] as string ?? "" });
    }
    default:
      return new MemoryQueueBackend();
  }
}

async function resolveCacheBackend(config: EnterpriseConfig): Promise<CacheBackend> {
  const selector = config.kernel?.cache;
  switch (selector?.backend) {
    case "redis": {
      const { RedisCacheBackend } = await import("../kernel-impl/redis/cache.ts");
      return new RedisCacheBackend({ url: selector["url"] as string ?? "" });
    }
    default:
      return new MemoryCacheBackend();
  }
}

async function resolveSecretBackend(config: EnterpriseConfig): Promise<SecretBackend> {
  const _selector = config.kernel?.secret;
  return new EnvSecretBackend();
}

async function resolveEventBus(config: EnterpriseConfig): Promise<EventBus> {
  const selector = config.kernel?.eventBus;
  switch (selector?.backend) {
    case "redis": {
      const { RedisEventBus } = await import("../kernel-impl/redis/event-bus.ts");
      return new RedisEventBus({ url: selector["url"] as string ?? "" });
    }
    default:
      return new InProcessEventBus();
  }
}

async function resolveLockBackend(config: EnterpriseConfig): Promise<LockBackend> {
  const selector = config.kernel?.lock;
  switch (selector?.backend) {
    case "redis": {
      const { RedisLockBackend } = await import("../kernel-impl/redis/lock.ts");
      return new RedisLockBackend({ url: selector["url"] as string ?? "" });
    }
    default:
      return new InProcessLockBackend();
  }
}
