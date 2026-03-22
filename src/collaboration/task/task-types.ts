/**
 * Task entity and FSM types (PRD §5.3.1).
 */

export interface Task {
  id: string;
  tenantId: string;
  agentId: string;
  sessionKey: string;
  parentTaskId?: string;

  type: TaskType;
  state: TaskState;
  stateHistory: TaskStateTransition[];

  input: unknown;
  output?: unknown;
  error?: TaskError;
  checkpoint?: TaskCheckpoint;

  priority: "high" | "normal" | "low";
  timeoutMs: number;
  maxAttempts: number;
  attemptCount: number;
  idempotencyKey?: string;

  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export type TaskType =
  | "llm_call"
  | "tool_execution"
  | "workflow_step"
  | "message_delivery"
  | "custom";

export type TaskState =
  | "pending"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "killed"
  | "timeout";

export interface TaskStateTransition {
  from: TaskState;
  to: TaskState;
  reason: string;
  timestamp: Date;
  actor: string;
}

export interface TaskError {
  code: string;
  message: string;
  details?: unknown;
}

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  stepIndex: number;
  state: unknown;
  completedSteps: string[];
  pendingSteps: string[];
  createdAt: Date;
  metadata?: Record<string, unknown>;
}
