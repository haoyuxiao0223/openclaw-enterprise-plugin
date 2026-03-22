import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createSessionRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();
  const storage = modules.kernel.storage;

  app.get("/", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await storage.list(ctx, "sessions", {
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    const id = body.id ?? crypto.randomUUID();
    await storage.set(ctx, "sessions", id, {
      ...body,
      id,
      state: "active",
      createdAt: new Date(),
    });
    return c.json({ id }, 201);
  });

  app.get("/:key", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const session = await storage.get(ctx, "sessions", c.req.param("key"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json(session);
  });

  app.post("/:key/send", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    const messageId = crypto.randomUUID();
    await storage.set(ctx, "session_messages", messageId, {
      id: messageId,
      sessionKey: c.req.param("key"),
      ...body,
      createdAt: new Date(),
    });

    return c.json({ messageId, status: "queued" }, 202);
  });

  app.get("/:key/history", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await storage.list(ctx, "session_messages", {
      prefix: c.req.param("key"),
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json(result);
  });

  app.delete("/:key", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const deleted = await storage.delete(ctx, "sessions", c.req.param("key"));
    if (!deleted) return c.json({ error: "Session not found" }, 404);
    return c.json({ success: true });
  });

  return app;
}
