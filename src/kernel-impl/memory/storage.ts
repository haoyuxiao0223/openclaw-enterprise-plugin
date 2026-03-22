/**
 * MemoryStorageBackend — in-memory reference implementation of StorageBackend.
 *
 * Uses a nested Map structure: Map<tenantId, Map<collection, Map<key, value>>>.
 * Suitable for development, testing, and single-process personal-edition use.
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { StorageBackend, StorageTransaction } from "../../kernel/storage.ts";
import type { HealthStatus, PaginatedResult, StorageQuery } from "../../kernel/types.ts";

type TenantStore = Map<string, Map<string, { value: unknown; createdAt: Date; updatedAt: Date }>>;

export class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, TenantStore>();

  async initialize(): Promise<void> {
    // no-op for memory backend
  }

  async shutdown(): Promise<void> {
    this.store.clear();
  }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0, details: { type: "memory" } };
  }

  private getTenantStore(tenantId: string): TenantStore {
    let ts = this.store.get(tenantId);
    if (!ts) {
      ts = new Map();
      this.store.set(tenantId, ts);
    }
    return ts;
  }

  private getCollection(tenantId: string, collection: string) {
    const ts = this.getTenantStore(tenantId);
    let col = ts.get(collection);
    if (!col) {
      col = new Map();
      ts.set(collection, col);
    }
    return col;
  }

  async get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null> {
    const col = this.getCollection(ctx.tenantId, collection);
    const entry = col.get(key);
    return entry ? (entry.value as T) : null;
  }

  async set<T>(ctx: TenantContext, collection: string, key: string, value: T): Promise<void> {
    const col = this.getCollection(ctx.tenantId, collection);
    const existing = col.get(key);
    const now = new Date();
    col.set(key, {
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async delete(ctx: TenantContext, collection: string, key: string): Promise<boolean> {
    const col = this.getCollection(ctx.tenantId, collection);
    return col.delete(key);
  }

  async list<T>(
    ctx: TenantContext,
    collection: string,
    query: StorageQuery,
  ): Promise<PaginatedResult<T>> {
    const col = this.getCollection(ctx.tenantId, collection);
    let entries = Array.from(col.entries());

    if (query.prefix) {
      const prefix = query.prefix;
      entries = entries.filter(([k]) => k.startsWith(prefix));
    }

    const total = entries.length;
    const order = query.order === "asc" ? 1 : -1;

    entries.sort((a, b) => {
      if (query.orderBy === "key") return a[0].localeCompare(b[0]) * order;
      return (a[1].updatedAt.getTime() - b[1].updatedAt.getTime()) * order;
    });

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    const sliced = entries.slice(offset, offset + limit);

    return {
      items: sliced.map(([, entry]) => entry.value as T),
      total,
      hasMore: offset + limit < total,
    };
  }

  async atomicUpdate<T>(
    ctx: TenantContext,
    collection: string,
    key: string,
    updater: (current: T | null) => T,
  ): Promise<T> {
    const current = await this.get<T>(ctx, collection, key);
    const updated = updater(current);
    await this.set(ctx, collection, key, updated);
    return updated;
  }

  async batchGet<T>(
    ctx: TenantContext,
    collection: string,
    keys: string[],
  ): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const col = this.getCollection(ctx.tenantId, collection);
    for (const key of keys) {
      const entry = col.get(key);
      if (entry) result.set(key, entry.value as T);
    }
    return result;
  }

  async batchSet<T>(
    ctx: TenantContext,
    collection: string,
    entries: Array<{ key: string; value: T }>,
  ): Promise<void> {
    for (const { key, value } of entries) {
      await this.set(ctx, collection, key, value);
    }
  }

  async transaction<T>(
    ctx: TenantContext,
    fn: (tx: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    // Memory backend: transactions run inline (no real isolation needed)
    const self = this;
    const tx: StorageTransaction = {
      async get<V>(collection: string, key: string) {
        return self.get<V>(ctx, collection, key);
      },
      async set<V>(collection: string, key: string, value: V) {
        return self.set<V>(ctx, collection, key, value);
      },
      async delete(collection: string, key: string) {
        return self.delete(ctx, collection, key);
      },
    };
    return fn(tx);
  }
}
