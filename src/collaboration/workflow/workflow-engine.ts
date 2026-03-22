/**
 * WorkflowEngine — pluggable workflow orchestration (PRD §5.3.2).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface WorkflowEngine {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  registerWorkflow(definition: WorkflowDefinition): Promise<void>;
  startWorkflow(
    ctx: TenantContext,
    workflowId: string,
    input: unknown,
    options?: WorkflowOptions,
  ): Promise<WorkflowInstance>;
  getWorkflowInstance(ctx: TenantContext, instanceId: string): Promise<WorkflowInstance | null>;
  signal(ctx: TenantContext, instanceId: string, signal: WorkflowSignal): Promise<void>;
}

export interface WorkflowDefinition {
  id: string;
  version: number;
  steps: WorkflowStep[];
  transitions: WorkflowTransition[];
  errorHandler?: string;
  timeoutMs?: number;
}

export interface WorkflowStep {
  id: string;
  type: "agent_task" | "human_review" | "condition" | "parallel" | "wait_signal";
  config: Record<string, unknown>;
  timeoutMs?: number;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowOptions {
  priority?: "high" | "normal" | "low";
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  workflowVersion: number;
  tenantId: string;
  state: "running" | "waiting_signal" | "completed" | "failed" | "killed";
  currentStepId?: string;
  input: unknown;
  output?: unknown;
  error?: string;
  startedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface WorkflowSignal {
  type: string;
  data: unknown;
  sender: string;
}
