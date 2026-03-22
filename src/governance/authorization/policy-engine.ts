/**
 * PolicyEngine — pluggable authorization abstraction.
 *
 * PRD §5.1.2: Decouples authorization logic from the gateway.
 * The existing method-scopes.ts is wrapped as ScopePolicyEngine.
 * Enterprise users can implement RBAC, ABAC, or OPA-based engines.
 */

import type { UserIdentity } from "../identity/identity-provider.ts";

export interface PolicyEngine {
  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  authorize(request: AuthzRequest): Promise<AuthzDecision>;
  batchAuthorize(requests: AuthzRequest[]): Promise<AuthzDecision[]>;
  loadPolicies(policies: PolicyDefinition[]): Promise<void>;
}

export interface AuthzRequest {
  subject: UserIdentity;
  action: string;
  resource: ResourceDescriptor;
  context?: Record<string, unknown>;
}

export interface ResourceDescriptor {
  type: string;
  id?: string;
  tenantId: string;
  attributes?: Record<string, unknown>;
}

export interface AuthzDecision {
  allowed: boolean;
  reason?: string;
  obligations?: AuthzObligation[];
}

export interface AuthzObligation {
  type: string;
  params?: Record<string, unknown>;
}

export interface PolicyDefinition {
  id: string;
  version: number;
  rules: PolicyRule[];
}

export interface PolicyRule {
  effect: "allow" | "deny";
  subjects: string[];
  actions: string[];
  resources: string[];
  conditions?: Record<string, unknown>;
  priority?: number;
}
