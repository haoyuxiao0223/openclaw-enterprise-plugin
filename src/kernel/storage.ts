/**
 * StorageBackend — pluggable persistence abstraction.
 *
 * PRD §4.1: All persistent data (sessions, config, credentials, agent metadata,
 * audit records) flows through this interface. TenantContext as the first
 * parameter enforces tenant isolation at the storage layer.
 *
 * Reference implementations:
 *  - MemoryStorageBackend   (dev/test, single-process)
 *  - FileSystemStorageBackend (personal-edition compat)
 *  - PostgresStorageBackend  (enterprise production)
 */

import type { TenantContext } from "./tenant-context.ts";
import type { BackendLifecycle, HealthStatus, PaginatedResult, StorageQuery } from "./types.ts";

export interface StorageTransaction {
  get<T>(collection: string, key: string): Promise<T | null>;
  set<T>(collection: string, key: string, value: T): Promise<void>;
  delete(collection: string, key: string): Promise<boolean>;
}

export interface StorageBackend extends BackendLifecycle {
  healthCheck(): Promise<HealthStatus>;

  get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null>;
  set<T>(ctx: TenantContext, collection: string, key: string, value: T): Promise<void>;
  delete(ctx: TenantContext, collection: string, key: string): Promise<boolean>;
  list<T>(ctx: TenantContext, collection: string, query: StorageQuery): Promise<PaginatedResult<T>>;

  atomicUpdate<T>(
    ctx: TenantContext,
    collection: string,
    key: string,
    updater: (current: T | null) => T,
  ): Promise<T>;

  batchGet<T>(ctx: TenantContext, collection: string, keys: string[]): Promise<Map<string, T>>;
  batchSet<T>(
    ctx: TenantContext,
    collection: string,
    entries: Array<{ key: string; value: T }>,
  ): Promise<void>;

  /**
   * Optional transactional support. Backends that cannot provide ACID
   * transactions leave this undefined; callers must check before use.
   */
  transaction?<T>(ctx: TenantContext, fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;
}
