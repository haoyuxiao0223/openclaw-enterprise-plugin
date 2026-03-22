import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createRoleRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();
  const storage = modules.kernel.storage;

  app.get("/", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await storage.list(ctx, "roles", {
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    const id = body.id ?? crypto.randomUUID();
    await storage.set(ctx, "roles", id, { ...body, id, createdAt: new Date() });
    return c.json({ id }, 201);
  });

  app.get("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const role = await storage.get(ctx, "roles", c.req.param("id"));
    if (!role) return c.json({ error: "Role not found" }, 404);
    return c.json(role);
  });

  app.put("/:id", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    await storage.set(ctx, "roles", c.req.param("id"), { ...body, updatedAt: new Date() });
    return c.json({ success: true });
  });

  app.delete("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const deleted = await storage.delete(ctx, "roles", c.req.param("id"));
    if (!deleted) return c.json({ error: "Role not found" }, 404);
    return c.json({ success: true });
  });

  return app;
}
