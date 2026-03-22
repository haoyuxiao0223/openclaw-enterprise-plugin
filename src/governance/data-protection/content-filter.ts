/**
 * ContentFilter — pluggable input/output content filtering.
 *
 * PRD §5.1.3: Enterprise users register multiple filters that form
 * a chain by direction and priority. Filters can redact, block, or
 * flag content containing sensitive data.
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface ContentFilter {
  readonly direction: "inbound" | "outbound" | "both";

  filter(ctx: TenantContext, content: FilterableContent): Promise<FilterResult>;
}

export interface FilterableContent {
  text?: string;
  attachments?: Array<{ name: string; mimeType: string; data: Buffer }>;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}

export interface FilterResult {
  passed: boolean;
  content: FilterableContent;
  violations: FilterViolation[];
  action: "allow" | "redact" | "block" | "review";
}

export interface FilterViolation {
  rule: string;
  severity: "info" | "warning" | "critical";
  description: string;
  matchedContent?: string;
}
