/**
 * HandoffManager — human-agent handoff interface (PRD §5.3).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface HandoffManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  createRequest(ctx: TenantContext, request: HandoffRequest): Promise<HandoffResult>;
  assignRequest(ctx: TenantContext, handoffId: string, assignee: string): Promise<void>;
  resolveRequest(ctx: TenantContext, handoffId: string, resolution: unknown): Promise<void>;
  cancelRequest(ctx: TenantContext, handoffId: string): Promise<void>;
  getRequest(ctx: TenantContext, handoffId: string): Promise<HandoffResult | null>;
}

export interface HandoffRequest {
  taskId?: string;
  sessionKey?: string;
  agentId: string;
  reason: string;
  priority?: "high" | "normal" | "low";
  expiresAt?: Date;
}

export interface HandoffResult {
  id: string;
  tenantId: string;
  taskId?: string;
  sessionKey?: string;
  agentId: string;
  reason: string;
  priority: "high" | "normal" | "low";
  status: "pending" | "assigned" | "resolved" | "expired" | "cancelled";
  assignedTo?: string;
  resolution?: unknown;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  resolvedAt?: Date;
}
