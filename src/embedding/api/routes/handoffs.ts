import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createHandoffRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const mgr = modules.collaboration?.handoffManager;
    if (!mgr) return c.json({ error: "Handoff manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const result = await mgr.createRequest(ctx, body);
    return c.json(result, 201);
  });

  app.get("/:handoffId", async (c) => {
    const mgr = modules.collaboration?.handoffManager;
    if (!mgr) return c.json({ error: "Handoff manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await mgr.getRequest(ctx, c.req.param("handoffId"));
    if (!result) return c.json({ error: "Handoff not found" }, 404);
    return c.json(result);
  });

  app.put("/:handoffId/assign", async (c) => {
    const mgr = modules.collaboration?.handoffManager;
    if (!mgr) return c.json({ error: "Handoff manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const { assignee } = await c.req.json();
    await mgr.assignRequest(ctx, c.req.param("handoffId"), assignee);
    return c.json({ success: true });
  });

  app.put("/:handoffId/resolve", async (c) => {
    const mgr = modules.collaboration?.handoffManager;
    if (!mgr) return c.json({ error: "Handoff manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    await mgr.resolveRequest(ctx, c.req.param("handoffId"), body.resolution);
    return c.json({ success: true });
  });

  app.put("/:handoffId/cancel", async (c) => {
    const mgr = modules.collaboration?.handoffManager;
    if (!mgr) return c.json({ error: "Handoff manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    await mgr.cancelRequest(ctx, c.req.param("handoffId"));
    return c.json({ success: true });
  });

  return app;
}
