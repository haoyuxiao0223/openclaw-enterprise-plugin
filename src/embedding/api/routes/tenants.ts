import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createTenantRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();
  const storage = modules.kernel.storage;

  app.get("/", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await storage.list(ctx, "tenants", {
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    const id = body.id ?? crypto.randomUUID();
    await storage.set(ctx, "tenants", id, { ...body, id, createdAt: new Date() });
    return c.json({ id }, 201);
  });

  app.get("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const tenant = await storage.get(ctx, "tenants", c.req.param("id"));
    if (!tenant) return c.json({ error: "Tenant not found" }, 404);
    return c.json(tenant);
  });

  app.put("/:id", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    await storage.set(ctx, "tenants", c.req.param("id"), { ...body, updatedAt: new Date() });
    return c.json({ success: true });
  });

  app.delete("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const deleted = await storage.delete(ctx, "tenants", c.req.param("id"));
    if (!deleted) return c.json({ error: "Tenant not found" }, 404);
    return c.json({ success: true });
  });

  return app;
}
