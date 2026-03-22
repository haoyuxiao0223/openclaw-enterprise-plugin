/**
 * LockBackend — pluggable distributed mutual-exclusion abstraction.
 *
 * PRD §4.6: Provides distributed locking for cron single-instance execution,
 * session write locks, and leader election. Wraps existing
 * session-write-lock.ts in the InProcess implementation.
 *
 * Reference implementations:
 *  - InProcessLockBackend (memory Map, wraps existing session-write-lock.ts)
 *  - RedisLockBackend     (Redlock algorithm, multi-instance)
 */

import type { BackendLifecycle } from "./types.ts";

export interface LockOptions {
  /** Lock expiration time in milliseconds. */
  ttlMs: number;
  /** Maximum wait time to acquire the lock (0 = return immediately). */
  waitMs?: number;
  retryIntervalMs?: number;
}

export interface LockHandle {
  key: string;
  /** Unique token to prevent accidental release by a different holder. */
  token: string;
  expiresAt: Date;
}

export interface LeaderElectionOptions {
  ttlMs: number;
  renewIntervalMs?: number;
}

export interface LeaderElection {
  isLeader(): boolean;
  onElected(handler: () => void): void;
  onDeposed(handler: () => void): void;
  resign(): Promise<void>;
}

export interface LockBackend extends BackendLifecycle {
  acquire(key: string, options: LockOptions): Promise<LockHandle | null>;
  release(handle: LockHandle): Promise<void>;
  extend(handle: LockHandle, extensionMs: number): Promise<boolean>;
  electLeader(
    group: string,
    candidateId: string,
    options: LeaderElectionOptions,
  ): LeaderElection;
}
