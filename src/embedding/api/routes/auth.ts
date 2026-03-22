/**
 * Auth routes — POST /auth/login, /auth/logout, /auth/refresh, GET /auth/me
 */

import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";

export function createAuthRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const body = await c.req.json();
    const provider = modules.governance?.identityProvider;
    if (!provider) return c.json({ error: "No identity provider configured" }, 501);

    const result = await provider.authenticate({
      type: body.grant_type === "password" ? "password" : "token",
      credentials: body,
    });

    if (!result.authenticated) {
      return c.json({ error: result.error ?? "Authentication failed" }, 401);
    }

    return c.json({
      access_token: result.token ?? "static-token",
      token_type: "Bearer",
      expires_in: 3600,
      identity: result.identity,
    });
  });

  app.post("/logout", async (c) => {
    const token = c.req.header("authorization")?.replace("Bearer ", "");
    if (token && modules.governance?.identityProvider?.revokeToken) {
      await modules.governance.identityProvider.revokeToken(token);
    }
    return c.json({ success: true });
  });

  app.post("/refresh", async (c) => {
    const body = await c.req.json();
    const provider = modules.governance?.identityProvider;
    if (!provider?.refreshToken) {
      return c.json({ error: "Token refresh not supported" }, 501);
    }

    const result = await provider.refreshToken(body.refresh_token);
    if (!result.authenticated) {
      return c.json({ error: result.error }, 401);
    }

    return c.json({
      access_token: result.token,
      token_type: "Bearer",
      expires_in: 3600,
    });
  });

  app.get("/me", async (c) => {
    const token = c.req.header("authorization")?.replace("Bearer ", "");
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const provider = modules.governance?.identityProvider;
    if (!provider) return c.json({ error: "No identity provider" }, 501);

    const result = await provider.authenticate({
      type: "token",
      credentials: { token },
    });

    if (!result.authenticated || !result.identity) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return c.json(result.identity);
  });

  return app;
}
