/**
 * Audit middleware — emits audit events for every API request.
 */

import type { AuditPipeline } from "../audit/audit-pipeline.ts";
import type { AuditEvent } from "../audit/audit-event.ts";
import type { Middleware } from "./types.ts";

export interface AuditMiddlewareOptions {
  auditPipeline: AuditPipeline;
  excludePaths?: string[];
}

export function createAuditMiddleware(opts: AuditMiddlewareOptions): Middleware {
  const { auditPipeline, excludePaths = [] } = opts;

  return async (req, res, next) => {
    if (excludePaths.some((p) => req.path.startsWith(p))) {
      await next();
      return;
    }

    const start = Date.now();
    let outcome: "success" | "failure" | "denied" = "success";

    try {
      await next();
      if (res.statusCode >= 400) outcome = res.statusCode === 403 ? "denied" : "failure";
    } catch (err) {
      outcome = "failure";
      throw err;
    } finally {
      const event: AuditEvent = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        version: "1.0",
        tenantId: req.tenantContext?.tenantId ?? "unknown",
        actor: {
          type: "user",
          id: (req.locals["userId"] as string) ?? "anonymous",
        },
        action: `${req.method} ${req.path}`,
        category: "data_access",
        outcome,
        resource: {
          type: req.path.split("/")[3] ?? "unknown",
          id: req.params["id"],
          tenantId: req.tenantContext?.tenantId ?? "unknown",
        },
        source: {
          service: "api-gateway",
          requestId: crypto.randomUUID(),
        },
        duration: Date.now() - start,
      };

      auditPipeline.emit(event);
    }
  };
}
