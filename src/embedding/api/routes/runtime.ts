import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createRuntimeRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const runtime = modules.isolation?.runtimeBackend;
    if (!runtime) return c.json({ error: "Runtime backend not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const instances = await runtime.listInstances(ctx);
    return c.json({ items: instances, total: instances.length });
  });

  app.post("/", async (c) => {
    const runtime = modules.isolation?.runtimeBackend;
    if (!runtime) return c.json({ error: "Runtime backend not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const instance = await runtime.createInstance(ctx, body);
    return c.json(instance, 201);
  });

  app.get("/:instanceId", async (c) => {
    const runtime = modules.isolation?.runtimeBackend;
    if (!runtime) return c.json({ error: "Runtime backend not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const instance = await runtime.getInstance(ctx, c.req.param("instanceId"));
    if (!instance) return c.json({ error: "Runtime instance not found" }, 404);
    return c.json(instance);
  });

  app.get("/:instanceId/metrics", async (c) => {
    const runtime = modules.isolation?.runtimeBackend;
    if (!runtime) return c.json({ error: "Runtime backend not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const metrics = await runtime.getMetrics(ctx, c.req.param("instanceId"));
    return c.json(metrics);
  });

  app.delete("/:instanceId", async (c) => {
    const runtime = modules.isolation?.runtimeBackend;
    if (!runtime) return c.json({ error: "Runtime backend not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    await runtime.destroyInstance(ctx, c.req.param("instanceId"));
    return c.json({ success: true });
  });

  return app;
}
