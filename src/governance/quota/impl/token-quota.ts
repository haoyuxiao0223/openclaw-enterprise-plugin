import type { CacheBackend } from "../../../kernel/cache.ts";
import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type { StorageBackend } from "../../../kernel/storage.ts";
import type {
  QuotaCheckResult,
  QuotaKey,
  QuotaManager,
  QuotaUsage,
} from "../quota-manager.ts";

const COLLECTION = "token_quota_usage";

type StoredUsage = {
  used: number;
};

class QuotaExceededError extends Error {
  constructor() {
    super("quota exceeded");
    this.name = "QuotaExceededError";
  }
}

export type TokenQuotaManagerOptions = {
  storage: StorageBackend;
  cache?: CacheBackend;
  windowMs: number;
  defaultLimit: number;
  resolveLimit?: (ctx: TenantContext, key: QuotaKey) => number | Promise<number>;
};

type WindowInfo = {
  windowStart: number;
  windowEnd: number;
  resetAt: Date;
};

export class TokenQuotaManager implements QuotaManager {
  private readonly storage: StorageBackend;
  private readonly cache: CacheBackend | undefined;
  private readonly windowMs: number;
  private readonly defaultLimit: number;
  private readonly resolveLimit?: (ctx: TenantContext, key: QuotaKey) => number | Promise<number>;

  constructor(options: TokenQuotaManagerOptions) {
    this.storage = options.storage;
    this.cache = options.cache;
    this.windowMs = options.windowMs;
    this.defaultLimit = options.defaultLimit;
    this.resolveLimit = options.resolveLimit;
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
    await this.cache?.initialize();
  }

  async shutdown(): Promise<void> {
    await this.cache?.shutdown();
    await this.storage.shutdown();
  }

  async check(ctx: TenantContext, key: QuotaKey): Promise<QuotaCheckResult> {
    const win = this.windowFor(Date.now());
    const limit = await this.resolveQuotaLimit(ctx, key);
    const recordKey = this.recordKey(key, win.windowStart);
    const used = await this.readUsed(ctx, recordKey, win);
    return this.toCheckResult(used, limit, win, used < limit);
  }

  async consume(ctx: TenantContext, key: QuotaKey, amount: number): Promise<QuotaCheckResult> {
    const win = this.windowFor(Date.now());
    const limit = await this.resolveQuotaLimit(ctx, key);
    const recordKey = this.recordKey(key, win.windowStart);

    if (amount <= 0) {
      const used = await this.readUsed(ctx, recordKey, win);
      return this.toCheckResult(used, limit, win, true);
    }

    if (limit === 0) {
      const used = await this.readUsed(ctx, recordKey, win);
      return this.toCheckResult(used, limit, win, false);
    }

    try {
      const next = await this.storage.atomicUpdate<StoredUsage>(
        ctx,
        COLLECTION,
        recordKey,
        (current) => {
          const used = (current as StoredUsage | null)?.used ?? 0;
          if (used + amount > limit) {
            throw new QuotaExceededError();
          }
          return { used: used + amount };
        },
      );
      await this.writeCacheUsed(ctx, recordKey, next.used, win);
      return this.toCheckResult(next.used, limit, win, true);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        const used = await this.readUsed(ctx, recordKey, win);
        return this.toCheckResult(used, limit, win, false);
      }
      throw e;
    }
  }

  async getUsage(ctx: TenantContext, key: QuotaKey): Promise<QuotaUsage> {
    const win = this.windowFor(Date.now());
    const limit = await this.resolveQuotaLimit(ctx, key);
    const recordKey = this.recordKey(key, win.windowStart);
    const used = await this.readUsed(ctx, recordKey, win);
    return {
      usedValue: used,
      maxValue: limit,
      windowStart: new Date(win.windowStart),
      windowEnd: new Date(win.windowEnd),
    };
  }

  private windowFor(nowMs: number): WindowInfo {
    const windowStart = Math.floor(nowMs / this.windowMs) * this.windowMs;
    const windowEnd = windowStart + this.windowMs;
    return {
      windowStart,
      windowEnd,
      resetAt: new Date(windowEnd),
    };
  }

  private recordKey(key: QuotaKey, windowStart: number): string {
    const scopeId = key.scopeId ?? "";
    return `${key.scopeType}:${scopeId}:${key.resourceType}:${windowStart}`;
  }

  private cacheKey(ctx: TenantContext, recordKey: string): string {
    return `token-quota:${ctx.tenantId}:${recordKey}`;
  }

  private async resolveQuotaLimit(ctx: TenantContext, key: QuotaKey): Promise<number> {
    if (this.resolveLimit) {
      const n = await this.resolveLimit(ctx, key);
      if (Number.isFinite(n) && n >= 0) {
        return Math.floor(n);
      }
    }
    return Math.max(0, Math.floor(this.defaultLimit));
  }

  private async readUsed(ctx: TenantContext, recordKey: string, win: WindowInfo): Promise<number> {
    const ck = this.cacheKey(ctx, recordKey);
    if (this.cache) {
      const cached = await this.cache.get<number>(ck);
      if (cached !== null) {
        return cached;
      }
    }
    const row = await this.storage.get<StoredUsage>(ctx, COLLECTION, recordKey);
    const used = row?.used ?? 0;
    await this.writeCacheUsed(ctx, recordKey, used, win);
    return used;
  }

  private async writeCacheUsed(
    ctx: TenantContext,
    recordKey: string,
    used: number,
    win: WindowInfo,
  ): Promise<void> {
    if (!this.cache) {
      return;
    }
    const ttlMs = Math.max(0, win.windowEnd - Date.now());
    await this.cache.set(this.cacheKey(ctx, recordKey), used, ttlMs || undefined);
  }

  private toCheckResult(
    used: number,
    limit: number,
    win: WindowInfo,
    allowed: boolean,
  ): QuotaCheckResult {
    const remaining = Math.max(0, limit - used);
    const percentUsed =
      limit === 0 ? (used > 0 ? 100 : 0) : Math.min(100, (used / limit) * 100);
    return {
      allowed,
      remaining,
      limit,
      resetAt: win.resetAt,
      percentUsed,
    };
  }
}
