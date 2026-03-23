import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";

export function createQuotaRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.get("/usage", async (c) => {
    const mgr = modules.governance?.quotaManager;
    if (!mgr) return c.json({ error: "Quota manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const scopeType = (c.req.query("scope_type") ?? "tenant") as "tenant" | "user" | "role" | "agent";
    const scopeId = c.req.query("scope_id");
    const resourceType = c.req.query("resource_type") ?? "tokens";

    const usage = await mgr.getUsage(ctx, { scopeType, scopeId, resourceType });
    return c.json(usage);
  });

  app.post("/check", async (c) => {
    const mgr = modules.governance?.quotaManager;
    if (!mgr) return c.json({ error: "Quota manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const result = await mgr.check(ctx, body);
    return c.json(result);
  });

  app.post("/consume", async (c) => {
    const mgr = modules.governance?.quotaManager;
    if (!mgr) return c.json({ error: "Quota manager not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const result = await mgr.consume(ctx, body.key, body.amount ?? 1);
    return c.json(result);
  });

  return app;
}
