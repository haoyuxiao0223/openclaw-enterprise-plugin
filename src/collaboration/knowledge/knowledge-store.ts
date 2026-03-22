/**
 * KnowledgeStore — shared knowledge base interface (PRD §5.3).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { PaginatedResult } from "../../kernel/types.ts";

export interface KnowledgeStore {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  get(ctx: TenantContext, namespace: string, key: string): Promise<KnowledgeEntry | null>;
  set(ctx: TenantContext, entry: KnowledgeEntryInput): Promise<KnowledgeEntry>;
  delete(ctx: TenantContext, entryId: string): Promise<boolean>;
  search(ctx: TenantContext, query: KnowledgeQuery): Promise<PaginatedResult<KnowledgeEntry>>;
}

export interface KnowledgeEntry {
  id: string;
  tenantId: string;
  namespace: string;
  key: string;
  content: string;
  contentType: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeEntryInput {
  namespace?: string;
  key: string;
  content: string;
  contentType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeQuery {
  namespace?: string;
  tags?: string[];
  q?: string;
  offset?: number;
  limit?: number;
}
