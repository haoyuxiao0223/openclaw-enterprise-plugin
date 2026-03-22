/**
 * Kernel Abstraction Layer — public barrel export.
 *
 * All upper-layer enterprise modules depend only on these interfaces,
 * never on concrete implementations.
 */

export type { TenantContext, TenantContextSource } from "./tenant-context.ts";
export { createDefaultTenantContext } from "./tenant-context.ts";

export type {
  HealthStatus,
  PaginatedResult,
  StorageQuery,
  BackendLifecycle,
} from "./types.ts";

export type { StorageBackend, StorageTransaction } from "./storage.ts";
export type { QueueBackend, QueueMessage, QueueHandler, QueueSubscription, EnqueueOptions, DequeueOptions, NackOptions, SubscribeOptions, QueuePriority } from "./queue.ts";
export type { CacheBackend } from "./cache.ts";
export type { SecretBackend } from "./secret.ts";
export type { EventBus, PlatformEvent, EventHandler, EventSubscription } from "./event-bus.ts";
export type { LockBackend, LockHandle, LockOptions, LeaderElection, LeaderElectionOptions } from "./lock.ts";
