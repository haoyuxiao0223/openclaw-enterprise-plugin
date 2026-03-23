import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type { StorageBackend } from "../../../kernel/storage.ts";
import type { PaginatedResult } from "../../../kernel/types.ts";
import type {
  ApiKeyCreateInput,
  ApiKeyCreateResult,
  ApiKeyInfo,
  ApiKeyManager,
  ApiKeyQuery,
  ApiKeyValidation,
} from "../api-key-manager.ts";

const COLLECTION = "api_keys";
const KEY_PREFIX = "k:";
const HASH_PREFIX = "h:";
const RAW_PREFIX = "oc_live_";

type HashIndex = { id: string };

type StoredApiKey = {
  id: string;
  tenantId: string;
  keyHash: string;
  prefix: string;
  name: string;
  scopes: string[];
  expiresAt?: string;
  createdAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
};

async function sha256Hex(value: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${RAW_PREFIX}${b64}`;
}

function toInfo(row: StoredApiKey): ApiKeyInfo {
  return {
    id: row.id,
    tenantId: row.tenantId,
    prefix: row.prefix,
    name: row.name,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : undefined,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
    createdAt: new Date(row.createdAt),
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
  };
}

export class StorageApiKeyManager implements ApiKeyManager {
  constructor(private readonly storage: StorageBackend) {}

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  async create(ctx: TenantContext, input: ApiKeyCreateInput): Promise<ApiKeyCreateResult> {
    const id = crypto.randomUUID();
    const rawKey = generateRawKey();
    const keyHash = await sha256Hex(rawKey);
    const createdAt = new Date();
    const row: StoredApiKey = {
      id,
      tenantId: ctx.tenantId,
      keyHash,
      prefix: RAW_PREFIX,
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expiresAt?.toISOString(),
      createdAt: createdAt.toISOString(),
      metadata: input.metadata,
    };
    await this.storage.set(ctx, COLLECTION, `${KEY_PREFIX}${id}`, row);
    await this.storage.set(ctx, COLLECTION, `${HASH_PREFIX}${keyHash}`, { id } satisfies HashIndex);
    return {
      id,
      rawKey,
      prefix: RAW_PREFIX,
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      createdAt,
    };
  }

  async validate(ctx: TenantContext, rawKey: string): Promise<ApiKeyValidation> {
    const keyHash = await sha256Hex(rawKey);
    const idx = await this.storage.get<HashIndex>(ctx, COLLECTION, `${HASH_PREFIX}${keyHash}`);
    if (!idx) {
      return { valid: false, reason: "unknown_key" };
    }
    const row = await this.storage.get<StoredApiKey>(ctx, COLLECTION, `${KEY_PREFIX}${idx.id}`);
    if (!row || row.tenantId !== ctx.tenantId) {
      return { valid: false, reason: "unknown_key" };
    }
    if (row.revokedAt) {
      return { valid: false, keyId: row.id, tenantId: row.tenantId, reason: "revoked" };
    }
    if (row.expiresAt && new Date(row.expiresAt) <= new Date()) {
      return { valid: false, keyId: row.id, tenantId: row.tenantId, reason: "expired" };
    }
    const nowIso = new Date().toISOString();
    await this.storage.atomicUpdate<StoredApiKey>(ctx, COLLECTION, `${KEY_PREFIX}${row.id}`, (cur) => {
      if (!cur) return row;
      return { ...cur, lastUsedAt: nowIso };
    });
    return {
      valid: true,
      keyId: row.id,
      tenantId: row.tenantId,
      scopes: row.scopes,
    };
  }

  async revoke(ctx: TenantContext, keyId: string): Promise<boolean> {
    const key = `${KEY_PREFIX}${keyId}`;
    const existing = await this.storage.get<StoredApiKey>(ctx, COLLECTION, key);
    if (!existing) return false;
    if (existing.revokedAt) return true;
    const revokedAt = new Date().toISOString();
    await this.storage.set(ctx, COLLECTION, key, { ...existing, revokedAt });
    return true;
  }

  async list(ctx: TenantContext, query?: ApiKeyQuery): Promise<PaginatedResult<ApiKeyInfo>> {
    const includeRevoked = query?.includeRevoked ?? false;
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? 20;

    const rows: StoredApiKey[] = [];
    let pageOffset = 0;
    const pageSize = 200;
    while (true) {
      const page = await this.storage.list<StoredApiKey>(ctx, COLLECTION, {
        prefix: KEY_PREFIX,
        offset: pageOffset,
        limit: pageSize,
      });
      rows.push(...page.items);
      if (!page.hasMore) break;
      pageOffset += pageSize;
    }

    let filtered = includeRevoked ? rows : rows.filter((r) => !r.revokedAt);
    filtered = filtered.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit).map(toInfo);
    return {
      items,
      total,
      hasMore: offset + limit < total,
    };
  }

  async rotate(ctx: TenantContext, keyId: string): Promise<ApiKeyCreateResult> {
    const key = `${KEY_PREFIX}${keyId}`;
    const existing = await this.storage.get<StoredApiKey>(ctx, COLLECTION, key);
    if (!existing) {
      throw new Error("API key not found");
    }
    await this.revoke(ctx, keyId);
    return this.create(ctx, {
      name: existing.name,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt ? new Date(existing.expiresAt) : undefined,
      metadata: existing.metadata,
    });
  }
}
