import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type { RateLimitKey, RateLimiter, RateLimitResult } from "../rate-limiter.ts";

type WindowState = { count: number; windowStart: number };

export class MemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, WindowState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly defaultLimit: number,
    private readonly defaultWindowMs: number,
  ) {}

  async initialize(): Promise<void> {
    if (this.cleanupTimer !== null) return;
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60_000);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }

  async check(_ctx: TenantContext, key: RateLimitKey): Promise<RateLimitResult> {
    return Promise.resolve(this.evaluate(key, 1, false));
  }

  async consume(_ctx: TenantContext, key: RateLimitKey, tokens = 1): Promise<RateLimitResult> {
    return Promise.resolve(this.evaluate(key, tokens, true));
  }

  async reset(_ctx: TenantContext, key: RateLimitKey): Promise<void> {
    this.store.delete(this.compositeKey(key));
  }

  private compositeKey(key: RateLimitKey): string {
    return `${key.scope}:${key.identifier}:${key.resource}`;
  }

  private evaluate(key: RateLimitKey, need: number, mutate: boolean): RateLimitResult {
    const limit = this.defaultLimit;
    const windowMs = this.defaultWindowMs;
    const now = Date.now();
    const ck = this.compositeKey(key);
    const existing = this.store.get(ck);

    let windowStart: number;
    let baseCount: number;

    if (!existing || now - existing.windowStart >= windowMs) {
      windowStart = now;
      baseCount = 0;
    } else {
      windowStart = existing.windowStart;
      baseCount = existing.count;
    }

    const allowed = baseCount + need <= limit;
    const retryAfterMs = allowed ? undefined : Math.max(0, windowStart + windowMs - now);
    const remaining = Math.max(0, limit - baseCount - (allowed ? need : 0));

    if (mutate && allowed) {
      this.store.set(ck, { count: baseCount + need, windowStart });
    }

    return {
      allowed,
      remaining,
      limit,
      windowMs,
      retryAfterMs,
    };
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [ck, state] of this.store) {
      if (now - state.windowStart >= this.defaultWindowMs) {
        this.store.delete(ck);
      }
    }
  }
}
