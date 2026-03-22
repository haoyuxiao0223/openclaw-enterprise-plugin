/**
 * TenantContext — the universal context object that flows through every operation.
 *
 * PRD §2.2 mandates that all API calls, events, logs, and storage operations
 * carry a TenantContext containing tenantId, userId, agentId, and requestId.
 * This is an architectural constraint, not an optional feature.
 */

export interface TenantContext {
  /** Tenant identifier. Defaults to "default" for personal-edition compatibility. */
  readonly tenantId: string;
  /** Authenticated user performing the operation, if applicable. */
  readonly userId?: string;
  /** Agent involved in the operation, if applicable. */
  readonly agentId?: string;
  /** Unique request correlation ID for distributed tracing. */
  readonly requestId: string;
  /** Origin of the operation. */
  readonly source: TenantContextSource;
}

export type TenantContextSource = "api" | "channel" | "cron" | "internal";

/** Creates a minimal TenantContext for internal / personal-edition use. */
export function createDefaultTenantContext(
  overrides?: Partial<TenantContext>,
): TenantContext {
  return {
    tenantId: "default",
    requestId: crypto.randomUUID(),
    source: "internal",
    ...overrides,
  };
}
