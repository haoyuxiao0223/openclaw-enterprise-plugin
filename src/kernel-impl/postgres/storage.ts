/**
 * PostgreSQL StorageBackend — production enterprise storage.
 *
 * Tenant isolation: enforced via RLS policies. Each operation sets
 * SET LOCAL openclaw.tenant_id before executing queries.
 *
 * Performance: connection pool (Kysely/pg), batch upsert via
 * INSERT ... ON CONFLICT, JSONB GIN indexes for list queries.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { StorageBackend, StorageTransaction } from "../../kernel/storage.ts";
import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { HealthStatus, PaginatedResult, StorageQuery } from "../../kernel/types.ts";
import type { DatabaseSchema } from "./schema-types.ts";
import { createKyselyInstance, withTenantScope, type PostgresConnectionConfig } from "./connection.ts";
import { runMigrations } from "./migrations/runner.ts";

export class PostgresStorageBackend implements StorageBackend {
  private db: Kysely<DatabaseSchema> | null = null;
  private readonly config: PostgresConnectionConfig;

  constructor(config: Record<string, unknown>) {
    this.config = {
      connectionString: config["connectionString"] as string,
      pool: config["pool"] as PostgresConnectionConfig["pool"],
    };
  }

  async initialize(): Promise<void> {
    this.db = createKyselyInstance(this.config);
    await runMigrations(this.db);
  }

  async shutdown(): Promise<void> {
    await this.db?.destroy();
    this.db = null;
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await sql`SELECT 1`.execute(this.requireDb());
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        details: { error: String(err) },
      };
    }
  }

  async get<T>(ctx: TenantContext, collection: string, key: string): Promise<T | null> {
    return withTenantScope(this.requireDb(), ctx, async (db) => {
      const row = await db
        .selectFrom("enterprise_kv")
        .where("tenant_id", "=", ctx.tenantId)
        .where("collection", "=", collection)
        .where("key", "=", key)
        .select("value")
        .executeTakeFirst();
      return row ? (row.value as T) : null;
    });
  }

  async set<T>(ctx: TenantContext, collection: string, key: string, value: T): Promise<void> {
    await withTenantScope(this.requireDb(), ctx, async (db) => {
      await db
        .insertInto("enterprise_kv")
        .values({
          tenant_id: ctx.tenantId,
          collection,
          key,
          value: JSON.stringify(value),
        })
        .onConflict((oc) =>
          oc.columns(["tenant_id", "collection", "key"]).doUpdateSet({
            value: JSON.stringify(value),
            updated_at: new Date(),
          }),
        )
        .execute();
    });
  }

  async delete(ctx: TenantContext, collection: string, key: string): Promise<boolean> {
    return withTenantScope(this.requireDb(), ctx, async (db) => {
      const result = await db
        .deleteFrom("enterprise_kv")
        .where("tenant_id", "=", ctx.tenantId)
        .where("collection", "=", collection)
        .where("key", "=", key)
        .executeTakeFirst();
      return BigInt(result.numDeletedRows ?? 0) > 0n;
    });
  }

  async list<T>(ctx: TenantContext, collection: string, query: StorageQuery): Promise<PaginatedResult<T>> {
    return withTenantScope(this.requireDb(), ctx, async (db) => {
      let qb = db
        .selectFrom("enterprise_kv")
        .where("tenant_id", "=", ctx.tenantId)
        .where("collection", "=", collection);

      if (query.prefix) {
        qb = qb.where("key", "like", `${query.prefix}%`);
      }

      const countResult = await qb.select(sql<number>`count(*)::int`.as("count")).executeTakeFirst();
      const total = countResult?.count ?? 0;

      let dataQb = qb.select(["key", "value"]);
      if (query.orderBy) {
        dataQb = dataQb.orderBy(query.orderBy === "key" ? "key" : "created_at", query.order ?? "asc");
      }

      const offset = query.offset ?? 0;
      const limit = query.limit ?? 100;
      dataQb = dataQb.offset(offset).limit(limit);

      const rows = await dataQb.execute();
      const items = rows.map((r) => r.value as T);

      return { items, total, hasMore: offset + limit < total };
    });
  }

  async atomicUpdate<T>(
    ctx: TenantContext,
    collection: string,
    key: string,
    updater: (current: T | null) => T,
  ): Promise<T> {
    return withTenantScope(this.requireDb(), ctx, async (db) => {
      const row = await db
        .selectFrom("enterprise_kv")
        .where("tenant_id", "=", ctx.tenantId)
        .where("collection", "=", collection)
        .where("key", "=", key)
        .select("value")
        .forUpdate()
        .executeTakeFirst();

      const current = row ? (row.value as T) : null;
      const updated = updater(current);

      await db
        .insertInto("enterprise_kv")
        .values({
          tenant_id: ctx.tenantId,
          collection,
          key,
          value: JSON.stringify(updated),
        })
        .onConflict((oc) =>
          oc.columns(["tenant_id", "collection", "key"]).doUpdateSet({
            value: JSON.stringify(updated),
            updated_at: new Date(),
          }),
        )
        .execute();

      return updated;
    });
  }

  async batchGet<T>(ctx: TenantContext, collection: string, keys: string[]): Promise<Map<string, T>> {
    if (keys.length === 0) return new Map();

    return withTenantScope(this.requireDb(), ctx, async (db) => {
      const rows = await db
        .selectFrom("enterprise_kv")
        .where("tenant_id", "=", ctx.tenantId)
        .where("collection", "=", collection)
        .where("key", "in", keys)
        .select(["key", "value"])
        .execute();

      const result = new Map<string, T>();
      for (const row of rows) {
        result.set(row.key, row.value as T);
      }
      return result;
    });
  }

  async batchSet<T>(
    ctx: TenantContext,
    collection: string,
    entries: Array<{ key: string; value: T }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    await withTenantScope(this.requireDb(), ctx, async (db) => {
      const values = entries.map((e) => ({
        tenant_id: ctx.tenantId,
        collection,
        key: e.key,
        value: JSON.stringify(e.value),
      }));

      await db
        .insertInto("enterprise_kv")
        .values(values)
        .onConflict((oc) =>
          oc.columns(["tenant_id", "collection", "key"]).doUpdateSet({
            value: sql`EXCLUDED.value`,
            updated_at: new Date(),
          }),
        )
        .execute();
    });
  }

  async transaction<T>(ctx: TenantContext, fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    return this.requireDb().transaction().execute(async (trx) => {
      await sql`SELECT set_config('openclaw.tenant_id', ${ctx.tenantId}, true)`.execute(trx);
      const stx = new PostgresStorageTransaction(trx as unknown as Kysely<DatabaseSchema>, ctx.tenantId);
      return fn(stx);
    });
  }

  private requireDb(): Kysely<DatabaseSchema> {
    if (!this.db) throw new Error("PostgresStorageBackend not initialized");
    return this.db;
  }
}

class PostgresStorageTransaction implements StorageTransaction {
  constructor(
    private readonly trx: Kysely<DatabaseSchema>,
    private readonly tenantId: string,
  ) {}

  async get<T>(collection: string, key: string): Promise<T | null> {
    const row = await this.trx
      .selectFrom("enterprise_kv")
      .where("tenant_id", "=", this.tenantId)
      .where("collection", "=", collection)
      .where("key", "=", key)
      .select("value")
      .executeTakeFirst();
    return row ? (row.value as T) : null;
  }

  async set<T>(collection: string, key: string, value: T): Promise<void> {
    await this.trx
      .insertInto("enterprise_kv")
      .values({
        tenant_id: this.tenantId,
        collection,
        key,
        value: JSON.stringify(value),
      })
      .onConflict((oc) =>
        oc.columns(["tenant_id", "collection", "key"]).doUpdateSet({
          value: JSON.stringify(value),
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  async delete(collection: string, key: string): Promise<boolean> {
    const result = await this.trx
      .deleteFrom("enterprise_kv")
      .where("tenant_id", "=", this.tenantId)
      .where("collection", "=", collection)
      .where("key", "=", key)
      .executeTakeFirst();
    return BigInt(result.numDeletedRows ?? 0) > 0n;
  }
}
