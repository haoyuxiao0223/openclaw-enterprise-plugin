import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";
import type { UserIdentity } from "../../../governance/identity/identity-provider.ts";

export function createPolicyRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const engine = modules.governance?.policyEngine;
    if (!engine) return c.json({ error: "Policy engine not configured" }, 501);

    const body = await c.req.json();
    await engine.loadPolicies([body]);
    return c.json({ id: body.id, version: body.version }, 201);
  });

  return app;
}

export function createAuthzRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.post("/check", async (c) => {
    const engine = modules.governance?.policyEngine;
    if (!engine) return c.json({ error: "Policy engine not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const body = await c.req.json();
    const decision = await engine.authorize(ctx, {
      subject: body.subject as UserIdentity,
      action: body.action,
      resource: {
        type: body.resource_type,
        id: body.resource_id,
        tenantId: ctx.tenantId,
      },
    });
    return c.json(decision);
  });

  app.post("/batch-check", async (c) => {
    const engine = modules.governance?.policyEngine;
    if (!engine) return c.json({ error: "Policy engine not configured" }, 501);

    const ctx = createDefaultTenantContext({ source: "api" });
    const { checks } = await c.req.json();
    const requests = checks.map((check: Record<string, unknown>) => ({
      subject: check["subject"] as UserIdentity,
      action: check["action"] as string,
      resource: {
        type: check["resource_type"] as string,
        id: check["resource_id"] as string,
        tenantId: ctx.tenantId,
      },
    }));
    const decisions = await engine.batchAuthorize(ctx, requests);
    return c.json({ results: decisions });
  });

  return app;
}
