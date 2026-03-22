import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createAgentRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();
  const storage = modules.kernel.storage;

  app.get("/", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await storage.list(ctx, "agents", {
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    const id = body.id ?? crypto.randomUUID();
    await storage.set(ctx, "agents", id, {
      ...body,
      id,
      status: "active",
      createdAt: new Date(),
    });
    return c.json({ id }, 201);
  });

  app.get("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const agent = await storage.get(ctx, "agents", c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json(agent);
  });

  app.put("/:id", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    await storage.set(ctx, "agents", c.req.param("id"), { ...body, updatedAt: new Date() });
    return c.json({ success: true });
  });

  app.delete("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const deleted = await storage.delete(ctx, "agents", c.req.param("id"));
    if (!deleted) return c.json({ error: "Agent not found" }, 404);
    return c.json({ success: true });
  });

  return app;
}
