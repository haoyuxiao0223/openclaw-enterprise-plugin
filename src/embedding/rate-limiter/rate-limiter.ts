/**
 * RateLimiter — pluggable API rate limiting (PRD §5.4.2).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface RateLimiter {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  check(ctx: TenantContext, key: RateLimitKey): Promise<RateLimitResult>;
  consume(ctx: TenantContext, key: RateLimitKey, tokens?: number): Promise<RateLimitResult>;
  reset(ctx: TenantContext, key: RateLimitKey): Promise<void>;
}

export interface RateLimitKey {
  scope: "tenant" | "user" | "api_key" | "ip";
  identifier: string;
  resource: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  windowMs: number;
  retryAfterMs?: number;
}

export interface RateLimitRule {
  id: string;
  scope: RateLimitKey["scope"];
  resource: string;
  maxRequests: number;
  windowMs: number;
  burstSize?: number;
}
