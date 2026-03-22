import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createAuditRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.get("/events", async (c) => {
    const pipeline = modules.audit?.pipeline;
    if (!pipeline) return c.json({ error: "Audit not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await pipeline.query(ctx, {
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
      action: c.req.query("action"),
      category: c.req.query("category"),
    });

    return c.json(result);
  });

  app.get("/events/:id", async (c) => {
    const pipeline = modules.audit?.pipeline;
    if (!pipeline) return c.json({ error: "Audit not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await pipeline.query(ctx, { limit: 1 });
    const event = result.items.find((e) => e.id === c.req.param("id"));
    if (!event) return c.json({ error: "Audit event not found" }, 404);
    return c.json(event);
  });

  app.get("/metrics", async (c) => {
    const pipeline = modules.audit?.pipeline;
    if (!pipeline) return c.json({ error: "Audit not configured" }, 501);

    const metrics = pipeline.getMetrics();
    return c.json(metrics);
  });

  return app;
}
