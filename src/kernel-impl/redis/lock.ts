/**
 * Redis LockBackend — Redlock algorithm for distributed mutual exclusion.
 *
 * Uses redlock-universal for multi-instance Redis lock coordination.
 * Leader election via periodic lock renewal.
 */

import Redlock from "redlock-universal";
import type IORedis from "ioredis";
import type {
  LockBackend,
  LockOptions,
  LockHandle,
  LeaderElectionOptions,
  LeaderElection,
} from "../../kernel/lock.ts";
import { createRedisConnection, type RedisConnectionConfig } from "./connection.ts";

const LOCK_PREFIX = "oc:lock:";

export class RedisLockBackend implements LockBackend {
  private redlock: Redlock | null = null;
  private client: IORedis;
  private leaderIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(config: RedisConnectionConfig) {
    this.client = createRedisConnection(config);
  }

  async initialize(): Promise<void> {
    await this.client.connect();
    this.redlock = new Redlock([this.client], {
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
    });
  }

  async shutdown(): Promise<void> {
    for (const interval of this.leaderIntervals.values()) {
      clearInterval(interval);
    }
    this.leaderIntervals.clear();
    this.client.disconnect();
  }

  async acquire(key: string, options: LockOptions): Promise<LockHandle | null> {
    if (!this.redlock) throw new Error("RedisLockBackend not initialized");

    const lockKey = `${LOCK_PREFIX}${key}`;
    const deadline = Date.now() + (options.waitMs ?? 0);

    while (true) {
      try {
        const lock = await this.redlock.acquire([lockKey], options.ttlMs);
        return {
          key,
          token: lock.value,
          expiresAt: new Date(Date.now() + options.ttlMs),
          _lock: lock,
        } as LockHandle & { _lock: unknown };
      } catch {
        if (Date.now() >= deadline) return null;
        await sleep(options.retryIntervalMs ?? 50);
      }
    }
  }

  async release(handle: LockHandle): Promise<void> {
    const extended = handle as LockHandle & { _lock?: { release(): Promise<void> } };
    if (extended._lock) {
      await extended._lock.release();
    }
  }

  async extend(handle: LockHandle, extensionMs: number): Promise<boolean> {
    const extended = handle as LockHandle & { _lock?: { extend(ms: number): Promise<unknown> } };
    if (!extended._lock) return false;
    try {
      await extended._lock.extend(extensionMs);
      return true;
    } catch {
      return false;
    }
  }

  electLeader(
    group: string,
    candidateId: string,
    options: LeaderElectionOptions,
  ): LeaderElection {
    let isLeaderFlag = false;
    let onElectedCb: (() => void) | null = null;
    let onDeposedCb: (() => void) | null = null;
    let currentLock: (LockHandle & { _lock?: unknown }) | null = null;

    const renewMs = options.renewIntervalMs ?? Math.floor(options.ttlMs / 3);

    const tryAcquire = async () => {
      try {
        const handle = await this.acquire(`leader:${group}`, {
          ttlMs: options.ttlMs,
          waitMs: 0,
        });
        if (handle) {
          currentLock = handle as typeof currentLock;
          if (!isLeaderFlag) {
            isLeaderFlag = true;
            onElectedCb?.();
          }
        }
      } catch {
        if (isLeaderFlag) {
          isLeaderFlag = false;
          onDeposedCb?.();
        }
      }
    };

    const renewOrAcquire = async () => {
      if (currentLock) {
        const extended = await this.extend(currentLock, options.ttlMs);
        if (!extended) {
          isLeaderFlag = false;
          currentLock = null;
          onDeposedCb?.();
          await tryAcquire();
        }
      } else {
        await tryAcquire();
      }
    };

    tryAcquire();
    const interval = setInterval(renewOrAcquire, renewMs);
    this.leaderIntervals.set(`${group}:${candidateId}`, interval);

    return {
      isLeader: () => isLeaderFlag,
      onElected: (handler) => { onElectedCb = handler; },
      onDeposed: (handler) => { onDeposedCb = handler; },
      resign: async () => {
        clearInterval(interval);
        this.leaderIntervals.delete(`${group}:${candidateId}`);
        if (currentLock) {
          await this.release(currentLock);
          isLeaderFlag = false;
          currentLock = null;
        }
      },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
