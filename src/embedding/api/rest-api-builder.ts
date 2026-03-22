/**
 * REST API builder — Hono-based enterprise REST API.
 *
 * Mounts at /api/v1/* on the existing Gateway HTTP server.
 * Each route passes through the enterprise middleware chain.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { EnterpriseModules } from "../../registry.ts";
import { createAuthRoutes } from "./routes/auth.ts";
import { createTenantRoutes } from "./routes/tenants.ts";
import { createUserRoutes } from "./routes/users.ts";
import { createRoleRoutes } from "./routes/roles.ts";
import { createAgentRoutes } from "./routes/agents.ts";
import { createSessionRoutes } from "./routes/sessions.ts";
import { createTaskRoutes } from "./routes/tasks.ts";
import { createAuditRoutes } from "./routes/audit.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { createApiKeyRoutes } from "./routes/api-keys.ts";

export function buildRestApi(modules: EnterpriseModules): Hono {
  const api = new Hono();

  api.use("*", cors());

  api.route("/api/v1/auth", createAuthRoutes(modules));
  api.route("/api/v1/tenants", createTenantRoutes(modules));
  api.route("/api/v1/users", createUserRoutes(modules));
  api.route("/api/v1/roles", createRoleRoutes(modules));
  api.route("/api/v1/agents", createAgentRoutes(modules));
  api.route("/api/v1/sessions", createSessionRoutes(modules));
  api.route("/api/v1/tasks", createTaskRoutes(modules));
  api.route("/api/v1/audit", createAuditRoutes(modules));
  api.route("/api/v1/api-keys", createApiKeyRoutes(modules));
  api.route("/api/v1", createHealthRoutes(modules));

  return api;
}
