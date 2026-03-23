import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createWorkflowRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const engine = modules.collaboration?.workflowEngine;
    if (!engine) return c.json({ error: "Workflow engine not configured" }, 501);

    const body = await c.req.json();
    await engine.registerWorkflow(body);
    return c.json({ id: body.id, version: body.version }, 201);
  });

  app.post("/:workflowId/start", async (c) => {
    const engine = modules.collaboration?.workflowEngine;
    if (!engine) return c.json({ error: "Workflow engine not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const instance = await engine.startWorkflow(
      ctx,
      c.req.param("workflowId"),
      body.input,
      body.options,
    );
    return c.json(instance, 201);
  });

  return app;
}

export function createWorkflowInstanceRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.get("/:instanceId", async (c) => {
    const engine = modules.collaboration?.workflowEngine;
    if (!engine) return c.json({ error: "Workflow engine not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const instance = await engine.getWorkflowInstance(ctx, c.req.param("instanceId"));
    if (!instance) return c.json({ error: "Workflow instance not found" }, 404);
    return c.json(instance);
  });

  app.post("/:instanceId/signal", async (c) => {
    const engine = modules.collaboration?.workflowEngine;
    if (!engine) return c.json({ error: "Workflow engine not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    await engine.signal(ctx, c.req.param("instanceId"), body);
    return c.json({ success: true });
  });

  return app;
}
