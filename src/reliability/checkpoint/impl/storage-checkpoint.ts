import type { StorageBackend } from "../../../kernel/storage.ts";
import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type {
  Checkpoint,
  CheckpointInput,
  CheckpointManager,
} from "../checkpoint-manager.ts";

const COLLECTION = "checkpoints";
const LIST_PAGE = 200;

function storageKey(targetType: string, targetId: string, id: string): string {
  return `${targetType}:${targetId}:${id}`;
}

function normalizeCheckpoint(raw: Checkpoint): Checkpoint {
  const createdAt =
    raw.createdAt instanceof Date ? raw.createdAt : new Date(String(raw.createdAt));
  return {
    ...raw,
    completedSteps: raw.completedSteps ?? [],
    pendingSteps: raw.pendingSteps ?? [],
    metadata: raw.metadata ?? {},
    createdAt,
  };
}

export class StorageCheckpointManager implements CheckpointManager {
  constructor(private readonly storage: StorageBackend) {}

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  async save(ctx: TenantContext, input: CheckpointInput): Promise<Checkpoint> {
    const id = crypto.randomUUID();
    const key = storageKey(input.targetType, input.targetId, id);
    const checkpoint: Checkpoint = {
      id,
      tenantId: ctx.tenantId,
      targetId: input.targetId,
      targetType: input.targetType,
      state: input.state,
      stepIndex: input.stepIndex,
      completedSteps: input.completedSteps ?? [],
      pendingSteps: input.pendingSteps ?? [],
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    await this.storage.set(ctx, COLLECTION, key, checkpoint);
    return checkpoint;
  }

  async load(ctx: TenantContext, checkpointId: string): Promise<Checkpoint | null> {
    let offset = 0;
    while (true) {
      const page = await this.storage.list<Checkpoint>(ctx, COLLECTION, {
        offset,
        limit: LIST_PAGE,
      });
      for (const raw of page.items) {
        const c = normalizeCheckpoint(raw);
        if (c.id === checkpointId) return c;
      }
      if (!page.hasMore) return null;
      offset += LIST_PAGE;
    }
  }

  async loadLatest(
    ctx: TenantContext,
    targetId: string,
    targetType: string,
  ): Promise<Checkpoint | null> {
    const list = await this.list(ctx, targetId, targetType);
    return list[0] ?? null;
  }

  async delete(ctx: TenantContext, checkpointId: string): Promise<boolean> {
    const existing = await this.load(ctx, checkpointId);
    if (!existing) return false;
    const key = storageKey(existing.targetType, existing.targetId, existing.id);
    return this.storage.delete(ctx, COLLECTION, key);
  }

  async list(
    ctx: TenantContext,
    targetId: string,
    targetType: string,
  ): Promise<Checkpoint[]> {
    const prefix = `${targetType}:${targetId}:`;
    let offset = 0;
    const out: Checkpoint[] = [];
    while (true) {
      const page = await this.storage.list<Checkpoint>(ctx, COLLECTION, {
        prefix,
        offset,
        limit: LIST_PAGE,
      });
      for (const raw of page.items) {
        out.push(normalizeCheckpoint(raw));
      }
      if (!page.hasMore) break;
      offset += LIST_PAGE;
    }
    out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return out;
  }
}
