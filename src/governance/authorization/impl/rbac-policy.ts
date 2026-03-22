/**
 * RBAC policy engine — CASL-based authorization.
 *
 * Maps PRD PolicyRule to CASL rules:
 *   rule.actions    → CASL action
 *   rule.resources  → CASL subject
 *   rule.conditions → CASL conditions (MongoDB query syntax)
 *
 * Supports dynamic policy loading and tenant-scoped caching.
 */

import { PureAbility, AbilityBuilder } from "@casl/ability";
import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type { StorageBackend } from "../../../kernel/storage.ts";
import { createDefaultTenantContext } from "../../../kernel/tenant-context.ts";
import type {
  PolicyEngine,
  AuthzRequest,
  AuthzDecision,
  PolicyDefinition,
} from "../policy-engine.ts";

export class RbacPolicyEngine implements PolicyEngine {
  private abilityCache = new Map<string, PureAbility>();
  private policies: PolicyDefinition[] = [];
  private storage: StorageBackend;

  constructor(deps: { storage: StorageBackend }) {
    this.storage = deps.storage;
  }

  async initialize(): Promise<void> {
    const ctx = createDefaultTenantContext();
    const stored = await this.storage.list<PolicyDefinition>(ctx, "policies", {});
    this.policies = stored.items;
  }

  async shutdown(): Promise<void> {
    this.abilityCache.clear();
  }

  async authorize(_ctx: TenantContext, request: AuthzRequest): Promise<AuthzDecision> {
    const ability = this.getOrBuildAbility(request);
    const allowed = ability.can(request.action, request.resource.type);

    if (!allowed) {
      return { allowed: false, reason: "RBAC policy denied" };
    }

    return { allowed: true };
  }

  async batchAuthorize(ctx: TenantContext, requests: AuthzRequest[]): Promise<AuthzDecision[]> {
    return Promise.all(requests.map((r) => this.authorize(ctx, r)));
  }

  async loadPolicies(policies: PolicyDefinition[]): Promise<void> {
    this.policies = policies;
    this.abilityCache.clear();

    const ctx = createDefaultTenantContext();
    for (const policy of policies) {
      await this.storage.set(ctx, "policies", policy.id, policy);
    }
  }

  private getOrBuildAbility(request: AuthzRequest): PureAbility {
    const cacheKey = `${request.subject.userId}:${request.subject.roles.sort().join(",")}`;
    const cached = this.abilityCache.get(cacheKey);
    if (cached) return cached;

    const builder = new AbilityBuilder(PureAbility);

    for (const policy of this.policies) {
      for (const rule of policy.rules) {
        const matchesSubject = rule.subjects.some(
          (s) => request.subject.roles.includes(s) || s === "*",
        );
        if (!matchesSubject) continue;

        if (rule.effect === "allow") {
          for (const action of rule.actions) {
            for (const resource of rule.resources) {
              builder.can(action, resource, rule.conditions as Record<string, unknown>);
            }
          }
        } else {
          for (const action of rule.actions) {
            for (const resource of rule.resources) {
              builder.cannot(action, resource, rule.conditions as Record<string, unknown>);
            }
          }
        }
      }
    }

    const ability = builder.build();
    this.abilityCache.set(cacheKey, ability);
    return ability;
  }
}
