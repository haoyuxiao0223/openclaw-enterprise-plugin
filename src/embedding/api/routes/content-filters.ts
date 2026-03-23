import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createContentFilterRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.post("/test", async (c) => {
    const filter = modules.governance?.contentFilter;
    if (!filter) return c.json({ error: "Content filter not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const result = await filter.filter(ctx, body);
    return c.json(result);
  });

  return app;
}
