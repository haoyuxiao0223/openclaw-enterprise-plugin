/**
 * Authentication middleware — validates Bearer token via IdentityProvider.
 */

import type { IdentityProvider } from "../governance/identity/identity-provider.ts";
import type { Middleware } from "./types.ts";

export interface AuthnMiddlewareOptions {
  identityProvider: IdentityProvider;
  excludePaths?: string[];
}

export function createAuthnMiddleware(opts: AuthnMiddlewareOptions): Middleware {
  const { identityProvider, excludePaths = [] } = opts;

  return async (req, res, next) => {
    if (excludePaths.some((p) => req.path.startsWith(p))) {
      await next();
      return;
    }

    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      res.setStatus(401).json({
        error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" },
      });
      return;
    }

    const token = authHeader.slice(7);

    try {
      const result = await identityProvider.authenticate({
        type: "token",
        credentials: { token },
      });

      if (!result.authenticated || !result.identity) {
        res.setStatus(401).json({
          error: { code: "UNAUTHORIZED", message: result.error ?? "Authentication failed" },
        });
        return;
      }

      req.locals["userId"] = result.identity.userId;
      req.locals["userRoles"] = result.identity.roles;
      req.locals["identity"] = result.identity;
      await next();
    } catch {
      res.setStatus(500).json({
        error: { code: "AUTH_ERROR", message: "Authentication service unavailable" },
      });
    }
  };
}
