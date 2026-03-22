/**
 * SimpleWorkflowEngine — linear workflow reference implementation.
 *
 * Supports:
 *   - Sequential step execution
 *   - human_review steps (pause + signal)
 *   - wait_signal steps
 *   - Error handling and timeout
 *   - Persistence via StorageBackend
 *
 * Does NOT support (left for enterprise implementations):
 *   - Parallel steps
 *   - Condition branches (DAG)
 *   - Complex state rollback
 */

import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type { StorageBackend } from "../../../kernel/storage.ts";
import type { EventBus } from "../../../kernel/event-bus.ts";
import type {
  WorkflowEngine,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowOptions,
  WorkflowSignal,
} from "../workflow-engine.ts";

const COLLECTION_DEFS = "workflow_definitions";
const COLLECTION_INSTANCES = "workflow_instances";

interface PersistedInstance extends WorkflowInstance {
  currentStepIndex: number;
  stepResults: unknown[];
}

export class SimpleWorkflowEngine implements WorkflowEngine {
  private definitions = new Map<string, WorkflowDefinition>();
  private storage: StorageBackend;
  private eventBus: EventBus;

  constructor(deps: { storage: StorageBackend; eventBus: EventBus }) {
    this.storage = deps.storage;
    this.eventBus = deps.eventBus;
  }

  async initialize(): Promise<void> {
    const ctx = defaultCtx();
    const stored = await this.storage.list<WorkflowDefinition>(ctx, COLLECTION_DEFS, {});
    for (const def of stored.items) {
      this.definitions.set(def.id, def);
    }
  }

  async shutdown(): Promise<void> {
    this.definitions.clear();
  }

  async registerWorkflow(definition: WorkflowDefinition): Promise<void> {
    this.definitions.set(definition.id, definition);
    const ctx = defaultCtx();
    await this.storage.set(ctx, COLLECTION_DEFS, definition.id, definition);
  }

  async startWorkflow(
    ctx: TenantContext,
    workflowId: string,
    input: unknown,
    _options?: WorkflowOptions,
  ): Promise<WorkflowInstance> {
    const definition = this.definitions.get(workflowId);
    if (!definition) throw new Error(`Workflow not found: ${workflowId}`);

    const instance: PersistedInstance = {
      id: crypto.randomUUID(),
      workflowId,
      workflowVersion: definition.version,
      tenantId: ctx.tenantId,
      state: "running",
      currentStepId: definition.steps[0]?.id,
      input,
      createdAt: new Date(),
      updatedAt: new Date(),
      currentStepIndex: 0,
      stepResults: [],
    };

    await this.storage.set(ctx, COLLECTION_INSTANCES, instance.id, instance);

    this.executeStep(ctx, instance, definition).catch((err) => {
      console.error(`Workflow ${instance.id} execution error:`, err);
      this.failInstance(ctx, instance, String(err));
    });

    return instance;
  }

  async getWorkflowInstance(ctx: TenantContext, instanceId: string): Promise<WorkflowInstance | null> {
    return this.storage.get<PersistedInstance>(ctx, COLLECTION_INSTANCES, instanceId);
  }

  async signal(ctx: TenantContext, instanceId: string, signal: WorkflowSignal): Promise<void> {
    const instance = await this.storage.get<PersistedInstance>(ctx, COLLECTION_INSTANCES, instanceId);
    if (!instance) throw new Error(`Workflow instance not found: ${instanceId}`);

    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: `workflow.signal.${instanceId}`,
      tenantId: ctx.tenantId,
      source: "workflow-engine",
      timestamp: new Date(),
      data: signal,
    });
  }

  private async executeStep(
    ctx: TenantContext,
    instance: PersistedInstance,
    definition: WorkflowDefinition,
  ): Promise<void> {
    if (instance.currentStepIndex >= definition.steps.length) {
      instance.state = "completed";
      instance.updatedAt = new Date();
      instance.completedAt = new Date();
      await this.storage.set(ctx, COLLECTION_INSTANCES, instance.id, instance);

      await this.eventBus.publish({
        id: crypto.randomUUID(),
        type: "workflow.completed",
        tenantId: ctx.tenantId,
        source: "workflow-engine",
        timestamp: new Date(),
        data: { instanceId: instance.id, workflowId: instance.workflowId },
      });
      return;
    }

    const step = definition.steps[instance.currentStepIndex]!;
    instance.currentStepId = step.id;
    await this.storage.set(ctx, COLLECTION_INSTANCES, instance.id, instance);

    switch (step.type) {
      case "agent_task": {
        instance.stepResults.push({ stepId: step.id, type: "agent_task", config: step.config });
        break;
      }

      case "human_review":
      case "wait_signal": {
        instance.state = "waiting_signal";
        await this.storage.set(ctx, COLLECTION_INSTANCES, instance.id, instance);

        const signalEvent = await this.eventBus.once(
          `workflow.signal.${instance.id}`,
          step.timeoutMs ?? 86_400_000,
        );
        instance.state = "running";
        instance.stepResults.push({ stepId: step.id, result: signalEvent.data });
        break;
      }

      case "condition": {
        instance.stepResults.push({ stepId: step.id, type: "condition", config: step.config });
        break;
      }

      case "parallel": {
        instance.stepResults.push({ stepId: step.id, type: "parallel", note: "not supported in SimpleWorkflowEngine" });
        break;
      }
    }

    instance.currentStepIndex += 1;
    instance.updatedAt = new Date();
    await this.storage.set(ctx, COLLECTION_INSTANCES, instance.id, instance);
    await this.executeStep(ctx, instance, definition);
  }

  private async failInstance(ctx: TenantContext, instance: PersistedInstance, error: string): Promise<void> {
    instance.state = "failed";
    instance.error = error;
    instance.updatedAt = new Date();
    await this.storage.set(ctx, COLLECTION_INSTANCES, instance.id, instance);
  }
}

function defaultCtx(): TenantContext {
  return { tenantId: "default", requestId: crypto.randomUUID(), source: "internal" };
}
