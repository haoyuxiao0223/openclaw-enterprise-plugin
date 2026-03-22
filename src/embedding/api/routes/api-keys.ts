import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createApiKeyRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();
  const storage = modules.kernel.storage;

  app.get("/", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await storage.list(ctx, "api_keys", {
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 50),
    });
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const ctx = createDefaultTenantContext({ source: "api" });
    const id = crypto.randomUUID();
    const rawKey = `oc_${crypto.randomUUID().replace(/-/g, "")}`;
    const prefix = rawKey.slice(0, 8);

    await storage.set(ctx, "api_keys", id, {
      id,
      name: body.name,
      prefix,
      scopes: body.scopes ?? [],
      expiresAt: body.expiresAt,
      createdAt: new Date(),
    });

    return c.json({ id, rawKey, prefix, name: body.name }, 201);
  });

  app.delete("/:id", async (c) => {
    const ctx = createDefaultTenantContext({ source: "api" });
    const key = await storage.get<Record<string, unknown>>(ctx, "api_keys", c.req.param("id"));
    if (!key) return c.json({ error: "API key not found" }, 404);

    await storage.set(ctx, "api_keys", c.req.param("id"), {
      ...key,
      revokedAt: new Date(),
    });

    return c.json({ success: true });
  });

  return app;
}
