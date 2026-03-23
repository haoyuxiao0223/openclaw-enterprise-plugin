/**
 * REST API builder — Hono-based enterprise REST API.
 *
 * Mounts at /api/v1/* on the existing Gateway HTTP server.
 * Each route passes through the enterprise middleware chain.
 *
 * All six dimensions are exposed here:
 *   Governance, Audit, Collaboration, Embedding, Isolation, Reliability
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
import { createWorkflowRoutes, createWorkflowInstanceRoutes } from "./routes/workflows.ts";
import { createHandoffRoutes } from "./routes/handoffs.ts";
import { createKnowledgeRoutes } from "./routes/knowledge.ts";
import { createRuntimeRoutes } from "./routes/runtime.ts";
import { createContentFilterRoutes } from "./routes/content-filters.ts";
import { createQuotaRoutes } from "./routes/quotas.ts";
import { createQueueRoutes } from "./routes/queues.ts";
import { createCheckpointRoutes } from "./routes/checkpoints.ts";
import { createPolicyRoutes, createAuthzRoutes } from "./routes/policies.ts";

export function buildRestApi(modules: EnterpriseModules): Hono {
  const api = new Hono();

  api.use("*", cors());

  // Authentication & Identity
  api.route("/api/v1/auth", createAuthRoutes(modules));

  // Kernel
  api.route("/api/v1/tenants", createTenantRoutes(modules));

  // Governance
  api.route("/api/v1/users", createUserRoutes(modules));
  api.route("/api/v1/roles", createRoleRoutes(modules));
  api.route("/api/v1/policies", createPolicyRoutes(modules));
  api.route("/api/v1/authz", createAuthzRoutes(modules));
  api.route("/api/v1/content-filters", createContentFilterRoutes(modules));
  api.route("/api/v1/quotas", createQuotaRoutes(modules));

  // Audit
  api.route("/api/v1/audit", createAuditRoutes(modules));

  // Collaboration
  api.route("/api/v1/agents", createAgentRoutes(modules));
  api.route("/api/v1/sessions", createSessionRoutes(modules));
  api.route("/api/v1/tasks", createTaskRoutes(modules));
  api.route("/api/v1/workflows", createWorkflowRoutes(modules));
  api.route("/api/v1/workflow-instances", createWorkflowInstanceRoutes(modules));
  api.route("/api/v1/handoffs", createHandoffRoutes(modules));
  api.route("/api/v1/knowledge", createKnowledgeRoutes(modules));

  // Embedding
  api.route("/api/v1/api-keys", createApiKeyRoutes(modules));

  // Isolation
  api.route("/api/v1/runtime-instances", createRuntimeRoutes(modules));

  // Reliability
  api.route("/api/v1/queues", createQueueRoutes(modules));
  api.route("/api/v1", createCheckpointRoutes(modules));
  api.route("/api/v1", createHealthRoutes(modules));

  return api;
}
