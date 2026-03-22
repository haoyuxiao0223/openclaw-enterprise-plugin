/**
 * TenantContext injection middleware — extracts tenant from headers/token.
 */

import { createDefaultTenantContext } from "../kernel/tenant-context.ts";
import type { Middleware } from "./types.ts";

export interface TenantMiddlewareOptions {
  headerName?: string;
  required?: boolean;
}

export function createTenantMiddleware(opts?: TenantMiddlewareOptions): Middleware {
  const headerName = opts?.headerName ?? "x-tenant-id";
  const required = opts?.required ?? true;

  return async (req, res, next) => {
    const tenantId = req.headers[headerName];

    if (!tenantId && required) {
      res.setStatus(400).json({
        error: { code: "MISSING_TENANT", message: `Missing required header: ${headerName}` },
      });
      return;
    }

    req.tenantContext = createDefaultTenantContext({
      tenantId: tenantId ?? "default",
      userId: req.locals["userId"] as string | undefined,
      requestId: req.headers["x-request-id"] ?? crypto.randomUUID(),
      source: "api",
    });

    req.locals["tenantId"] = req.tenantContext.tenantId;
    await next();
  };
}
