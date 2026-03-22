import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createTaskRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();
  const storage = modules.kernel.storage;

  app.get("/", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await storage.list(ctx, "tasks", {
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    const id = crypto.randomUUID();
    await storage.set(ctx, "tasks", id, {
      ...body,
      id,
      state: "pending",
      attemptCount: 0,
      createdAt: new Date(),
    });

    if (modules.kernel.queue) {
      await modules.kernel.queue.enqueue(ctx, "tasks", {
        tenantId: ctx.tenantId,
        type: body.type ?? "custom",
        payload: { taskId: id, ...body },
        maxAttempts: body.maxAttempts ?? 3,
      });
    }

    return c.json({ id, state: "pending" }, 201);
  });

  app.get("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const task = await storage.get(ctx, "tasks", c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
  });

  app.post("/:id/cancel", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const task = await storage.get<Record<string, unknown>>(ctx, "tasks", c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);

    await storage.set(ctx, "tasks", c.req.param("id"), {
      ...task,
      state: "killed",
      updatedAt: new Date(),
    });

    return c.json({ success: true, state: "killed" });
  });

  return app;
}
