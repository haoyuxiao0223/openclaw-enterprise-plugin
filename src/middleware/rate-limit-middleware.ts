/**
 * Rate-limiting middleware — enforces request quotas via RateLimiter.
 */

import type { RateLimiter } from "../embedding/rate-limiter/rate-limiter.ts";
import type { TenantContext } from "../kernel/tenant-context.ts";
import type { Middleware } from "./types.ts";

export interface RateLimitMiddlewareOptions {
  rateLimiter: RateLimiter;
  keyExtractor?: (req: {
    tenantContext?: TenantContext;
    path: string;
    ip?: string;
    locals: Record<string, unknown>;
  }) => { scope: "tenant" | "user" | "api_key" | "ip"; identifier: string; resource: string };
}

export function createRateLimitMiddleware(opts: RateLimitMiddlewareOptions): Middleware {
  const { rateLimiter, keyExtractor } = opts;

  return async (req, res, next) => {
    const ctx = req.tenantContext;
    if (!ctx) {
      await next();
      return;
    }

    const key = keyExtractor
      ? keyExtractor(req)
      : {
          scope: "tenant" as const,
          identifier: ctx.tenantId,
          resource: req.path,
        };

    const result = await rateLimiter.consume(ctx, key);

    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Window", String(result.windowMs));

    if (!result.allowed) {
      if (result.retryAfterMs) {
        res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      }
      res.setStatus(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
          retryAfterMs: result.retryAfterMs,
        },
      });
      return;
    }

    await next();
  };
}
