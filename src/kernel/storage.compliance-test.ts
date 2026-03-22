/**
 * StorageBackend compliance test suite.
 *
 * All StorageBackend implementations (Memory, FileSystem, Postgres)
 * MUST pass this suite. Enterprise users can use this to validate
 * their custom implementations.
 *
 * Usage:
 *   import { runStorageComplianceTests } from "./storage.compliance-test.ts";
 *   runStorageComplianceTests(() => new MyStorageBackend());
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import type { StorageBackend } from "./storage.ts";
import type { TenantContext } from "./tenant-context.ts";

export function runStorageComplianceTests(
  factory: () => StorageBackend | Promise<StorageBackend>,
): void {
  let backend: StorageBackend;
  const ctx: TenantContext = {
    tenantId: "test-tenant",
    requestId: "test-request-001",
    source: "internal",
  };

  beforeEach(async () => {
    backend = await factory();
    await backend.initialize();
  });

  afterEach(async () => {
    await backend.shutdown();
  });

  describe("StorageBackend Compliance", () => {
    test("get returns null for non-existent key", async () => {
      const result = await backend.get(ctx, "test", "nonexistent");
      expect(result).toBeNull();
    });

    test("set then get returns same value", async () => {
      await backend.set(ctx, "test", "key1", { foo: "bar" });
      const result = await backend.get(ctx, "test", "key1");
      expect(result).toEqual({ foo: "bar" });
    });

    test("set overwrites existing value", async () => {
      await backend.set(ctx, "test", "key1", { version: 1 });
      await backend.set(ctx, "test", "key1", { version: 2 });
      const result = await backend.get(ctx, "test", "key1");
      expect(result).toEqual({ version: 2 });
    });

    test("delete returns true for existing key", async () => {
      await backend.set(ctx, "test", "key1", { foo: "bar" });
      const deleted = await backend.delete(ctx, "test", "key1");
      expect(deleted).toBe(true);
      expect(await backend.get(ctx, "test", "key1")).toBeNull();
    });

    test("delete returns false for non-existent key", async () => {
      const deleted = await backend.delete(ctx, "test", "nonexistent");
      expect(deleted).toBe(false);
    });

    test("tenant isolation: tenant A cannot see tenant B data", async () => {
      const ctxA: TenantContext = { ...ctx, tenantId: "tenant-a" };
      const ctxB: TenantContext = { ...ctx, tenantId: "tenant-b" };

      await backend.set(ctxA, "test", "shared-key", { data: "A" });
      await backend.set(ctxB, "test", "shared-key", { data: "B" });

      expect(await backend.get(ctxA, "test", "shared-key")).toEqual({ data: "A" });
      expect(await backend.get(ctxB, "test", "shared-key")).toEqual({ data: "B" });
    });

    test("list returns paginated results", async () => {
      for (let i = 0; i < 5; i++) {
        await backend.set(ctx, "test", `item-${i}`, { index: i });
      }
      const page1 = await backend.list(ctx, "test", { limit: 2, offset: 0 });
      expect(page1.items.length).toBe(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);
    });

    test("list with prefix filter", async () => {
      await backend.set(ctx, "test", "a-1", { group: "a" });
      await backend.set(ctx, "test", "a-2", { group: "a" });
      await backend.set(ctx, "test", "b-1", { group: "b" });

      const result = await backend.list(ctx, "test", { prefix: "a-" });
      expect(result.items.length).toBe(2);
    });

    test("atomicUpdate creates if not exists", async () => {
      const result = await backend.atomicUpdate<{ count: number }>(
        ctx,
        "test",
        "counter",
        (current) => ({ count: (current?.count ?? 0) + 1 }),
      );
      expect(result).toEqual({ count: 1 });
    });

    test("atomicUpdate modifies existing value", async () => {
      await backend.set(ctx, "test", "counter", { count: 5 });
      const result = await backend.atomicUpdate<{ count: number }>(
        ctx,
        "test",
        "counter",
        (current) => ({ count: (current?.count ?? 0) + 1 }),
      );
      expect(result).toEqual({ count: 6 });
    });

    test("batchGet returns matching entries", async () => {
      await backend.set(ctx, "test", "k1", { v: 1 });
      await backend.set(ctx, "test", "k2", { v: 2 });
      await backend.set(ctx, "test", "k3", { v: 3 });

      const result = await backend.batchGet<{ v: number }>(ctx, "test", ["k1", "k3", "k99"]);
      expect(result.size).toBe(2);
      expect(result.get("k1")).toEqual({ v: 1 });
      expect(result.get("k3")).toEqual({ v: 3 });
      expect(result.has("k99")).toBe(false);
    });

    test("batchSet writes multiple entries", async () => {
      await backend.batchSet(ctx, "test", [
        { key: "b1", value: { v: 10 } },
        { key: "b2", value: { v: 20 } },
      ]);

      expect(await backend.get(ctx, "test", "b1")).toEqual({ v: 10 });
      expect(await backend.get(ctx, "test", "b2")).toEqual({ v: 20 });
    });

    test("healthCheck reports healthy", async () => {
      const health = await backend.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    test("collections are independent namespaces", async () => {
      await backend.set(ctx, "col-a", "key1", { from: "a" });
      await backend.set(ctx, "col-b", "key1", { from: "b" });

      expect(await backend.get(ctx, "col-a", "key1")).toEqual({ from: "a" });
      expect(await backend.get(ctx, "col-b", "key1")).toEqual({ from: "b" });
    });
  });
}
