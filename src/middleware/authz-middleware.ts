/**
 * Authorization middleware — checks permissions via PolicyEngine.
 */

import type { TenantContext } from "../kernel/tenant-context.ts";
import type { PolicyEngine } from "../governance/authorization/policy-engine.ts";
import type { Middleware } from "./types.ts";

export interface AuthzMiddlewareOptions {
  policyEngine: PolicyEngine;
  resourceResolver?: (req: { path: string; method: string; params: Record<string, string> }) => {
    type: string;
    id?: string;
  };
}

function methodToAction(method: string): string {
  const map: Record<string, string> = {
    GET: "read",
    POST: "create",
    PUT: "update",
    PATCH: "update",
    DELETE: "delete",
  };
  return map[method.toUpperCase()] ?? "read";
}

export function createAuthzMiddleware(opts: AuthzMiddlewareOptions): Middleware {
  const { policyEngine, resourceResolver } = opts;

  return async (req, res, next) => {
    const ctx = req.tenantContext as TenantContext | undefined;
    if (!ctx) {
      res.setStatus(500).json({
        error: { code: "MISSING_CONTEXT", message: "TenantContext not set" },
      });
      return;
    }

    const resource = resourceResolver
      ? resourceResolver(req)
      : { type: req.path.split("/")[3] ?? "unknown" };

    const decision = await policyEngine.authorize(ctx, {
      subject: {
        userId: ctx.userId ?? "anonymous",
        roles: (req.locals["userRoles"] as string[] | undefined) ?? [],
        attributes: {},
      },
      action: methodToAction(req.method),
      resource: {
        type: resource.type,
        id: resource.id,
        tenantId: ctx.tenantId,
        attributes: {},
      },
      environment: {
        timestamp: new Date(),
        ip: req.ip,
        userAgent: req.userAgent,
      },
    });

    if (!decision.allowed) {
      res.setStatus(403).json({
        error: {
          code: "FORBIDDEN",
          message: decision.reason ?? "Access denied",
        },
      });
      return;
    }

    if (decision.obligations && decision.obligations.length > 0) {
      req.locals["authzObligations"] = decision.obligations;
    }

    await next();
  };
}
