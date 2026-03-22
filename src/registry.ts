/**
 * EnterpriseModules registry — runtime instances of all six-dimensional modules.
 *
 * Created by bootstrapEnterprise(), lifetime matches the Gateway process.
 * Null modules mean the dimension is disabled for this deployment.
 */

import type { KernelContext } from "./kernel/bootstrap.ts";
import type { IdentityProvider } from "./governance/identity/identity-provider.ts";
import type { PolicyEngine } from "./governance/authorization/policy-engine.ts";
import type { ContentFilter } from "./governance/data-protection/content-filter.ts";
import type { QuotaManager } from "./governance/quota/quota-manager.ts";
import type { AuditPipeline } from "./audit/audit-pipeline.ts";
import type { HandoffManager } from "./collaboration/handoff/handoff-manager.ts";
import type { KnowledgeStore } from "./collaboration/knowledge/knowledge-store.ts";
import type { WorkflowEngine } from "./collaboration/workflow/workflow-engine.ts";
import type { RateLimiter } from "./embedding/rate-limiter/rate-limiter.ts";
import type { ApiKeyManager } from "./embedding/api-key/api-key-manager.ts";
import type { AgentRuntimeBackend } from "./isolation/runtime/agent-runtime.ts";
import type { ResourceLimiter } from "./isolation/resource-limiter/resource-limiter.ts";
import type { CheckpointManager } from "./reliability/checkpoint/checkpoint-manager.ts";
import type { HealthChecker } from "./reliability/health/health-checker.ts";

export interface GovernanceModule {
  identityProvider: IdentityProvider;
  policyEngine: PolicyEngine;
  contentFilter?: ContentFilter;
  quotaManager?: QuotaManager;
}

export interface AuditModule {
  pipeline: AuditPipeline;
}

export interface CollaborationModule {
  workflowEngine?: WorkflowEngine;
  handoffManager?: HandoffManager;
  knowledgeStore?: KnowledgeStore;
}

export interface EmbeddingModule {
  rateLimiter?: RateLimiter;
  apiKeyManager?: ApiKeyManager;
  restApi?: unknown;
}

export interface IsolationModule {
  runtimeBackend?: AgentRuntimeBackend;
  resourceLimiter?: ResourceLimiter;
}

export interface ReliabilityModule {
  checkpointManager?: CheckpointManager;
  healthChecker?: HealthChecker;
  metricsProvider?: unknown;
}

export interface EnterpriseModules {
  kernel: KernelContext;
  governance: GovernanceModule | null;
  audit: AuditModule | null;
  collaboration: CollaborationModule | null;
  embedding: EmbeddingModule | null;
  isolation: IsolationModule | null;
  reliability: ReliabilityModule | null;
}
