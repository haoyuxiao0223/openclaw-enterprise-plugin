/**
 * MemoryCacheBackend — in-memory reference implementation of CacheBackend.
 *
 * Map-based cache with TTL expiration. Single-process only.
 */

import type { CacheBackend } from "../../kernel/cache.ts";

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt?: number;
}

export class MemoryCacheBackend implements CacheBackend {
  private store = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  async initialize(): Promise<void> {
    this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async increment(key: string, delta = 1, ttlMs?: number): Promise<number> {
    const current = await this.get<number>(key);
    const newVal = (current ?? 0) + delta;
    await this.set(key, newVal, ttlMs);
    return newVal;
  }

  async setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean> {
    if (await this.has(key)) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
  }

  private evictExpired(): void {
    for (const [key, entry] of this.store) {
      if (this.isExpired(entry)) this.store.delete(key);
    }
  }
}
