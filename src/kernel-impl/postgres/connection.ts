/**
 * Kysely-based PostgreSQL connection management.
 *
 * Design:
 *  - Single connection pool, created by PostgresStorageBackend.initialize()
 *  - RLS support: each query sets session variables via SET LOCAL
 *  - Pool params are configurable (min/max/idle timeout)
 */

import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { DatabaseSchema } from "./schema-types.ts";

export interface PostgresConnectionConfig {
  connectionString: string;
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMs?: number;
  };
}

export function createKyselyInstance(config: PostgresConnectionConfig): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: config.connectionString,
        min: config.pool?.min ?? 2,
        max: config.pool?.max ?? 10,
        idleTimeoutMillis: config.pool?.idleTimeoutMs ?? 30_000,
      }),
    }),
  });
}

/**
 * Execute a callback within a tenant-scoped context.
 * Sets PostgreSQL session variables used by RLS policies.
 */
export async function withTenantScope<T>(
  db: Kysely<DatabaseSchema>,
  ctx: TenantContext,
  fn: (db: Kysely<DatabaseSchema>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('openclaw.tenant_id', ${ctx.tenantId}, true)`.execute(trx);
    if (ctx.userId) {
      await sql`SELECT set_config('openclaw.user_id', ${ctx.userId}, true)`.execute(trx);
    }
    return fn(trx as unknown as Kysely<DatabaseSchema>);
  });
}
