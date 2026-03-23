import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createCheckpointRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.get("/tasks/:taskId/checkpoints/latest", async (c) => {
    const mgr = modules.reliability?.checkpointManager;
    if (!mgr) return c.json({ error: "Checkpoint manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const checkpoint = await mgr.loadLatest(ctx, c.req.param("taskId"), "task");
    if (!checkpoint) return c.json({ error: "No checkpoint found" }, 404);
    return c.json(checkpoint);
  });

  app.post("/tasks/:taskId/checkpoints", async (c) => {
    const mgr = modules.reliability?.checkpointManager;
    if (!mgr) return c.json({ error: "Checkpoint manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const checkpoint = await mgr.save(ctx, {
      targetId: c.req.param("taskId"),
      targetType: "task",
      state: body.state,
      stepIndex: body.stepIndex,
      completedSteps: body.completedSteps,
      pendingSteps: body.pendingSteps,
      metadata: body.metadata,
    });
    return c.json(checkpoint, 201);
  });

  app.get("/tasks/:taskId/checkpoints", async (c) => {
    const mgr = modules.reliability?.checkpointManager;
    if (!mgr) return c.json({ error: "Checkpoint manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const checkpoints = await mgr.list(ctx, c.req.param("taskId"), "task");
    return c.json({ items: checkpoints, total: checkpoints.length });
  });

  app.post("/tasks/:taskId/checkpoints/:checkpointId/restore", async (c) => {
    const mgr = modules.reliability?.checkpointManager;
    if (!mgr) return c.json({ error: "Checkpoint manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const checkpoint = await mgr.load(ctx, c.req.param("checkpointId"));
    if (!checkpoint) return c.json({ error: "Checkpoint not found" }, 404);
    return c.json({ success: true, checkpoint });
  });

  return app;
}
