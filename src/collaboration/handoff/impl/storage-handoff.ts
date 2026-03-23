import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type { StorageBackend } from "../../../kernel/storage.ts";
import type { EventBus } from "../../../kernel/event-bus.ts";
import type {
  HandoffManager,
  HandoffRequest,
  HandoffResult,
} from "../handoff-manager.ts";

const COLLECTION = "handoff_requests";

type PersistedHandoff = Omit<
  HandoffResult,
  "createdAt" | "updatedAt" | "expiresAt" | "resolvedAt"
> & {
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt?: Date | string;
  resolvedAt?: Date | string;
};

function asDate(v: Date | string | undefined): Date | undefined {
  if (v === undefined) return undefined;
  return v instanceof Date ? v : new Date(v);
}

function toHandoffResult(row: PersistedHandoff): HandoffResult {
  return {
    ...row,
    createdAt: asDate(row.createdAt)!,
    updatedAt: asDate(row.updatedAt)!,
    expiresAt: asDate(row.expiresAt),
    resolvedAt: asDate(row.resolvedAt),
  };
}

export class StorageHandoffManager implements HandoffManager {
  private storage: StorageBackend;
  private eventBus: EventBus;

  constructor(storage: StorageBackend, eventBus: EventBus) {
    this.storage = storage;
    this.eventBus = eventBus;
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  async createRequest(ctx: TenantContext, request: HandoffRequest): Promise<HandoffResult> {
    const now = new Date();
    const id = crypto.randomUUID();
    const priority = request.priority ?? "normal";
    const result: HandoffResult = {
      id,
      tenantId: ctx.tenantId,
      taskId: request.taskId,
      sessionKey: request.sessionKey,
      agentId: request.agentId,
      reason: request.reason,
      priority,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: request.expiresAt,
    };
    await this.storage.set(ctx, COLLECTION, id, result);
    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "handoff.request.pending",
      tenantId: ctx.tenantId,
      source: "handoff-manager",
      timestamp: new Date(),
      data: result,
    });
    return result;
  }

  async assignRequest(ctx: TenantContext, handoffId: string, assignee: string): Promise<void> {
    const updated = await this.storage.atomicUpdate<HandoffResult>(
      ctx,
      COLLECTION,
      handoffId,
      (current) => {
        if (!current) throw new Error(`Handoff not found: ${handoffId}`);
        const row = toHandoffResult(current as PersistedHandoff);
        if (row.status !== "pending") {
          throw new Error(`Handoff ${handoffId} is not pending`);
        }
        return {
          ...row,
          status: "assigned" as const,
          assignedTo: assignee,
          updatedAt: new Date(),
        };
      },
    );
    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "handoff.request.assigned",
      tenantId: ctx.tenantId,
      source: "handoff-manager",
      timestamp: new Date(),
      data: updated,
    });
  }

  async resolveRequest(ctx: TenantContext, handoffId: string, resolution: unknown): Promise<void> {
    const updated = await this.storage.atomicUpdate<HandoffResult>(
      ctx,
      COLLECTION,
      handoffId,
      (current) => {
        if (!current) throw new Error(`Handoff not found: ${handoffId}`);
        const row = toHandoffResult(current as PersistedHandoff);
        if (row.status !== "pending" && row.status !== "assigned") {
          throw new Error(`Handoff ${handoffId} cannot be resolved from status ${row.status}`);
        }
        const now = new Date();
        return {
          ...row,
          status: "resolved" as const,
          resolution,
          resolvedAt: now,
          updatedAt: now,
        };
      },
    );
    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "handoff.request.resolved",
      tenantId: ctx.tenantId,
      source: "handoff-manager",
      timestamp: new Date(),
      data: updated,
    });
  }

  async cancelRequest(ctx: TenantContext, handoffId: string): Promise<void> {
    const updated = await this.storage.atomicUpdate<HandoffResult>(
      ctx,
      COLLECTION,
      handoffId,
      (current) => {
        if (!current) throw new Error(`Handoff not found: ${handoffId}`);
        const row = toHandoffResult(current as PersistedHandoff);
        if (row.status === "resolved" || row.status === "cancelled") {
          throw new Error(`Handoff ${handoffId} cannot be cancelled from status ${row.status}`);
        }
        return {
          ...row,
          status: "cancelled" as const,
          updatedAt: new Date(),
        };
      },
    );
    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "handoff.request.cancelled",
      tenantId: ctx.tenantId,
      source: "handoff-manager",
      timestamp: new Date(),
      data: updated,
    });
  }

  async getRequest(ctx: TenantContext, handoffId: string): Promise<HandoffResult | null> {
    const row = await this.storage.get<PersistedHandoff>(ctx, COLLECTION, handoffId);
    if (!row) return null;
    return toHandoffResult(row);
  }
}
