/**
 * CheckpointManager — task/workflow state persistence (PRD §5.6.3).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface CheckpointManager {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  save(ctx: TenantContext, checkpoint: CheckpointInput): Promise<Checkpoint>;
  load(ctx: TenantContext, checkpointId: string): Promise<Checkpoint | null>;
  loadLatest(ctx: TenantContext, targetId: string, targetType: string): Promise<Checkpoint | null>;
  delete(ctx: TenantContext, checkpointId: string): Promise<boolean>;
  list(ctx: TenantContext, targetId: string, targetType: string): Promise<Checkpoint[]>;
}

export interface CheckpointInput {
  targetId: string;
  targetType: "task" | "workflow" | "session";
  state: unknown;
  stepIndex?: number;
  completedSteps?: string[];
  pendingSteps?: string[];
  metadata?: Record<string, unknown>;
}

export interface Checkpoint {
  id: string;
  tenantId: string;
  targetId: string;
  targetType: string;
  state: unknown;
  stepIndex?: number;
  completedSteps: string[];
  pendingSteps: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}
