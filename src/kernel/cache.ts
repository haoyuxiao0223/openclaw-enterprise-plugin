/**
 * CacheBackend — pluggable caching abstraction.
 *
 * PRD §4.3: High-frequency read caching for health status, config snapshots,
 * session metadata, and deduplication. Supports atomic increment for
 * counters / rate-limiting, and setIfAbsent for distributed dedup.
 *
 * Reference implementations:
 *  - MemoryCacheBackend (Map + TTL, default zero-dependency)
 *  - RedisCacheBackend  (enterprise production)
 */

import type { BackendLifecycle } from "./types.ts";

export interface CacheBackend extends BackendLifecycle {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;

  /** Atomic increment (counters, rate-limiting). Returns the new value. */
  increment(key: string, delta?: number, ttlMs?: number): Promise<number>;

  /**
   * Set only if key does not already exist (distributed dedup).
   * Returns true if the value was set, false if the key already existed.
   */
  setIfAbsent<T>(key: string, value: T, ttlMs: number): Promise<boolean>;
}
