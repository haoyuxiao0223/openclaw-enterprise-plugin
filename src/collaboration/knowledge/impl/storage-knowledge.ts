import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type { StorageBackend } from "../../../kernel/storage.ts";
import type { PaginatedResult } from "../../../kernel/types.ts";
import type {
  KnowledgeEntry,
  KnowledgeEntryInput,
  KnowledgeQuery,
  KnowledgeStore,
} from "../knowledge-store.ts";

const COLLECTION = "knowledge_entries";

type PersistedKnowledge = Omit<KnowledgeEntry, "createdAt" | "updatedAt"> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

function compositeKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function toKnowledgeEntry(row: PersistedKnowledge): KnowledgeEntry {
  return {
    ...row,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

function matchesTags(entry: KnowledgeEntry, tags?: string[]): boolean {
  if (!tags?.length) return true;
  return tags.every((t) => entry.tags.includes(t));
}

function matchesText(entry: KnowledgeEntry, q?: string): boolean {
  if (!q?.trim()) return true;
  const needle = q.toLowerCase();
  return (
    entry.key.toLowerCase().includes(needle) ||
    entry.content.toLowerCase().includes(needle)
  );
}

export class StorageKnowledgeStore implements KnowledgeStore {
  private storage: StorageBackend;

  constructor(storage: StorageBackend) {
    this.storage = storage;
  }

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  async get(ctx: TenantContext, namespace: string, key: string): Promise<KnowledgeEntry | null> {
    const row = await this.storage.get<PersistedKnowledge>(
      ctx,
      COLLECTION,
      compositeKey(namespace, key),
    );
    if (!row) return null;
    return toKnowledgeEntry(row);
  }

  async set(ctx: TenantContext, entry: KnowledgeEntryInput): Promise<KnowledgeEntry> {
    const namespace = entry.namespace ?? "default";
    const ck = compositeKey(namespace, entry.key);
    const now = new Date();
    const existing = await this.storage.get<PersistedKnowledge>(ctx, COLLECTION, ck);
    const prev = existing ? toKnowledgeEntry(existing as PersistedKnowledge) : null;
    const id = prev?.id ?? crypto.randomUUID();
    const createdAt = prev?.createdAt ?? now;
    const contentType = entry.contentType ?? prev?.contentType ?? "text/plain";
    const tags = entry.tags ?? prev?.tags ?? [];
    const metadata = entry.metadata ?? prev?.metadata ?? {};
    const saved: KnowledgeEntry = {
      id,
      tenantId: ctx.tenantId,
      namespace,
      key: entry.key,
      content: entry.content,
      contentType,
      tags,
      metadata,
      createdBy: prev?.createdBy ?? ctx.userId,
      createdAt,
      updatedAt: now,
    };
    await this.storage.set(ctx, COLLECTION, ck, saved);
    return saved;
  }

  async delete(ctx: TenantContext, entryId: string): Promise<boolean> {
    const batch = 500;
    for (let offset = 0; ; offset += batch) {
      const page = await this.storage.list<PersistedKnowledge>(ctx, COLLECTION, {
        offset,
        limit: batch,
      });
      for (const raw of page.items) {
        const entry = toKnowledgeEntry(raw as PersistedKnowledge);
        if (entry.id === entryId) {
          return this.storage.delete(ctx, COLLECTION, compositeKey(entry.namespace, entry.key));
        }
      }
      if (!page.hasMore) break;
    }
    return false;
  }

  async search(ctx: TenantContext, query: KnowledgeQuery): Promise<PaginatedResult<KnowledgeEntry>> {
    const batch = 500;
    const all: KnowledgeEntry[] = [];
    for (let offset = 0; ; offset += batch) {
      const page = await this.storage.list<PersistedKnowledge>(ctx, COLLECTION, {
        offset,
        limit: batch,
      });
      all.push(...page.items.map((raw) => toKnowledgeEntry(raw as PersistedKnowledge)));
      if (!page.hasMore) break;
    }
    let entries = all;
    if (query.namespace !== undefined) {
      entries = entries.filter((e) => e.namespace === query.namespace);
    }
    entries = entries.filter(
      (e) => matchesTags(e, query.tags) && matchesText(e, query.q),
    );
    const total = entries.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    const items = entries.slice(offset, offset + limit);
    return {
      items,
      total,
      hasMore: offset + limit < total,
    };
  }
}
