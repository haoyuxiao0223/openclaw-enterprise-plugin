/**
 * QuotaManager — pluggable resource quota enforcement.
 *
 * PRD §5.1 (Governance/Quota): Supports per-tenant, per-user,
 * per-role, and per-agent quota configuration with time-windowed usage tracking.
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface QuotaManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  check(ctx: TenantContext, key: QuotaKey): Promise<QuotaCheckResult>;
  consume(ctx: TenantContext, key: QuotaKey, amount: number): Promise<QuotaCheckResult>;
  getUsage(ctx: TenantContext, key: QuotaKey): Promise<QuotaUsage>;
}

export interface QuotaKey {
  scopeType: "tenant" | "user" | "role" | "agent";
  scopeId?: string;
  resourceType: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
  percentUsed: number;
}

export interface QuotaUsage {
  usedValue: number;
  maxValue: number;
  windowStart: Date;
  windowEnd: Date;
}
