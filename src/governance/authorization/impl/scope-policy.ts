/**
 * Scope-based policy engine — wraps existing method-scopes.ts logic.
 *
 * Default Phase 0-1 implementation. Admin role allows everything.
 * Non-admin uses a static scope mapping.
 */

import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type {
  PolicyEngine,
  AuthzRequest,
  AuthzDecision,
  PolicyDefinition,
} from "../policy-engine.ts";

export class ScopePolicyEngine implements PolicyEngine {
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async authorize(_ctx: TenantContext, request: AuthzRequest): Promise<AuthzDecision> {
    if (request.subject.roles.includes("admin")) {
      return { allowed: true };
    }

    const requiredScope = `${request.resource.type}.${request.action}`;
    const hasScope = request.subject.roles.some((role) =>
      SCOPE_MAP[role]?.includes(requiredScope) ?? false,
    );

    if (hasScope) return { allowed: true };

    return {
      allowed: false,
      reason: `Missing scope: ${requiredScope}`,
    };
  }

  async batchAuthorize(ctx: TenantContext, requests: AuthzRequest[]): Promise<AuthzDecision[]> {
    return Promise.all(requests.map((r) => this.authorize(ctx, r)));
  }

  async loadPolicies(_policies: PolicyDefinition[]): Promise<void> {}
}

const SCOPE_MAP: Record<string, string[]> = {
  viewer: [
    "session.read",
    "agent.read",
    "config.read",
    "channel.read",
  ],
  operator: [
    "session.read",
    "session.create",
    "agent.read",
    "agent.create",
    "config.read",
    "config.update",
    "channel.read",
    "task.read",
    "task.create",
  ],
};
