import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createKnowledgeRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const store = modules.collaboration?.knowledgeStore;
    if (!store) return c.json({ error: "Knowledge store not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const result = await store.search(ctx, {
      namespace: c.req.query("namespace"),
      q: c.req.query("q"),
      tags: c.req.query("tags")?.split(",").filter(Boolean),
      offset: Number(c.req.query("offset") ?? 0),
      limit: Number(c.req.query("limit") ?? 20),
    });
    return c.json(result);
  });

  app.post("/", async (c) => {
    const store = modules.collaboration?.knowledgeStore;
    if (!store) return c.json({ error: "Knowledge store not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const entry = await store.set(ctx, body);
    return c.json(entry, 201);
  });

  app.get("/:namespace/:key", async (c) => {
    const store = modules.collaboration?.knowledgeStore;
    if (!store) return c.json({ error: "Knowledge store not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const entry = await store.get(ctx, c.req.param("namespace"), c.req.param("key"));
    if (!entry) return c.json({ error: "Knowledge entry not found" }, 404);
    return c.json(entry);
  });

  app.delete("/:entryId", async (c) => {
    const store = modules.collaboration?.knowledgeStore;
    if (!store) return c.json({ error: "Knowledge store not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const deleted = await store.delete(ctx, c.req.param("entryId"));
    if (!deleted) return c.json({ error: "Knowledge entry not found" }, 404);
    return c.json({ success: true });
  });

  return app;
}
