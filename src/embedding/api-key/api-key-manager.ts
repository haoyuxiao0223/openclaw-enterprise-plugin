/**
 * ApiKeyManager — API key lifecycle management (PRD §5.4).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { PaginatedResult } from "../../kernel/types.ts";

export interface ApiKeyManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  create(ctx: TenantContext, input: ApiKeyCreateInput): Promise<ApiKeyCreateResult>;
  validate(ctx: TenantContext, rawKey: string): Promise<ApiKeyValidation>;
  revoke(ctx: TenantContext, keyId: string): Promise<boolean>;
  list(ctx: TenantContext, query?: ApiKeyQuery): Promise<PaginatedResult<ApiKeyInfo>>;
  rotate(ctx: TenantContext, keyId: string): Promise<ApiKeyCreateResult>;
}

export interface ApiKeyCreateInput {
  name: string;
  scopes: string[];
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ApiKeyCreateResult {
  id: string;
  rawKey: string;
  prefix: string;
  name: string;
  scopes: string[];
  expiresAt?: Date;
  createdAt: Date;
}

export interface ApiKeyValidation {
  valid: boolean;
  keyId?: string;
  tenantId?: string;
  userId?: string;
  scopes?: string[];
  reason?: string;
}

export interface ApiKeyInfo {
  id: string;
  tenantId: string;
  prefix: string;
  name: string;
  scopes: string[];
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  revokedAt?: Date;
}

export interface ApiKeyQuery {
  includeRevoked?: boolean;
  offset?: number;
  limit?: number;
}
