/**
 * InProcessLockBackend — in-memory reference implementation of LockBackend.
 *
 * Uses a Map for lock state. Single-process only.
 * Wraps the conceptual logic of the existing session-write-lock.ts.
 */

import type {
  LockBackend,
  LockHandle,
  LockOptions,
  LeaderElection,
  LeaderElectionOptions,
} from "../../kernel/lock.ts";

interface InternalLock {
  key: string;
  token: string;
  holderId: string;
  expiresAt: Date;
}

export class InProcessLockBackend implements LockBackend {
  private locks = new Map<string, InternalLock>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  async initialize(): Promise<void> {
    this.cleanupInterval = setInterval(() => this.evictExpired(), 5_000);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.locks.clear();
  }

  async acquire(key: string, options: LockOptions): Promise<LockHandle | null> {
    this.evictExpired();

    const existing = this.locks.get(key);
    if (existing) {
      if (options.waitMs && options.waitMs > 0) {
        return this.acquireWithRetry(key, options);
      }
      return null;
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + options.ttlMs);
    const lock: InternalLock = { key, token, holderId: "local", expiresAt };
    this.locks.set(key, lock);

    return { key, token, expiresAt };
  }

  async release(handle: LockHandle): Promise<void> {
    const lock = this.locks.get(handle.key);
    if (lock && lock.token === handle.token) {
      this.locks.delete(handle.key);
    }
  }

  async extend(handle: LockHandle, extensionMs: number): Promise<boolean> {
    const lock = this.locks.get(handle.key);
    if (!lock || lock.token !== handle.token) return false;
    lock.expiresAt = new Date(Date.now() + extensionMs);
    handle.expiresAt = lock.expiresAt;
    return true;
  }

  electLeader(
    group: string,
    candidateId: string,
    options: LeaderElectionOptions,
  ): LeaderElection {
    let leader = false;
    let electedHandler: (() => void) | undefined;
    let deposedHandler: (() => void) | undefined;
    let handle: LockHandle | null = null;
    let renewInterval: ReturnType<typeof setInterval> | undefined;

    const tryAcquire = async () => {
      handle = await this.acquire(`leader:${group}`, {
        ttlMs: options.ttlMs,
        waitMs: 0,
      });
      if (handle) {
        leader = true;
        electedHandler?.();
        const renewMs = options.renewIntervalMs ?? options.ttlMs / 3;
        renewInterval = setInterval(async () => {
          if (handle) {
            const ok = await this.extend(handle, options.ttlMs);
            if (!ok) {
              leader = false;
              deposedHandler?.();
              if (renewInterval) clearInterval(renewInterval);
            }
          }
        }, renewMs);
      }
    };

    // Fire-and-forget the initial acquisition
    void tryAcquire();

    return {
      isLeader: () => leader,
      onElected: (h) => {
        electedHandler = h;
        if (leader) h();
      },
      onDeposed: (h) => {
        deposedHandler = h;
      },
      resign: async () => {
        if (renewInterval) clearInterval(renewInterval);
        if (handle) {
          await this.release(handle);
          leader = false;
          deposedHandler?.();
        }
      },
    };
  }

  private async acquireWithRetry(key: string, options: LockOptions): Promise<LockHandle | null> {
    const deadline = Date.now() + (options.waitMs ?? 0);
    const interval = options.retryIntervalMs ?? 50;

    while (Date.now() < deadline) {
      this.evictExpired();
      if (!this.locks.has(key)) {
        return this.acquire(key, { ...options, waitMs: 0 });
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    return null;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks) {
      if (lock.expiresAt.getTime() <= now) {
        this.locks.delete(key);
      }
    }
  }
}
