/**
 * Migration runner — applies SQL migrations sequentially.
 *
 * Reads migration files from the migrations directory and executes them
 * in order, tracking applied versions in the schema_migrations table.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { DatabaseSchema } from "../schema-types.ts";

export interface Migration {
  version: string;
  name: string;
  up: string;
}

const INIT_MIGRATION: Migration = {
  version: "001",
  name: "init-schema",
  up: `
    -- This is a placeholder. The actual schema is loaded from database-schema.sql
    -- during the first deployment, or auto-applied by the Helm chart.
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(32)   PRIMARY KEY,
      name        VARCHAR(255)  NOT NULL,
      applied_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      checksum    VARCHAR(64)
    );
  `,
};

export async function ensureMigrationsTable(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(32)   PRIMARY KEY,
      name        VARCHAR(255)  NOT NULL,
      applied_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      checksum    VARCHAR(64)
    )
  `.execute(db);
}

export async function getAppliedVersions(db: Kysely<DatabaseSchema>): Promise<Set<string>> {
  const rows = await db
    .selectFrom("schema_migrations")
    .select("version")
    .execute();
  return new Set(rows.map((r) => r.version));
}

export async function applyMigration(
  db: Kysely<DatabaseSchema>,
  migration: Migration,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql.raw(migration.up).execute(trx);
    await trx
      .insertInto("schema_migrations")
      .values({
        version: migration.version,
        name: migration.name,
      })
      .execute();
  });
}

export async function runMigrations(
  db: Kysely<DatabaseSchema>,
  migrations: Migration[] = [INIT_MIGRATION],
): Promise<string[]> {
  await ensureMigrationsTable(db);
  const applied = await getAppliedVersions(db);
  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version.localeCompare(b.version));

  const appliedVersions: string[] = [];
  for (const migration of pending) {
    await applyMigration(db, migration);
    appliedVersions.push(migration.version);
  }

  return appliedVersions;
}
