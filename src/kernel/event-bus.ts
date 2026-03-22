/**
 * EventBus — pluggable inter-module communication abstraction.
 *
 * PRD §4.5: All modules communicate through the EventBus rather than
 * direct calls, enabling loose coupling. Audit, reliability, and metrics
 * modules subscribe to specific event patterns.
 *
 * Reference implementations:
 *  - InProcessEventBus (EventEmitter-based, zero-dependency default)
 *  - RedisEventBus     (Pub/Sub + Streams, multi-instance)
 */

import type { BackendLifecycle } from "./types.ts";

export interface PlatformEvent {
  id: string;
  /** Dot-separated event type, e.g. "audit.operation", "task.state.changed". */
  type: string;
  tenantId: string;
  /** Module that produced the event. */
  source: string;
  timestamp: Date;
  data: unknown;
  metadata?: Record<string, string>;
}

export interface EventHandler {
  (event: PlatformEvent): Promise<void>;
}

export interface EventSubscription {
  unsubscribe(): void;
}

export interface EventBus extends BackendLifecycle {
  publish(event: PlatformEvent): Promise<void>;
  publishBatch(events: PlatformEvent[]): Promise<void>;

  /**
   * Subscribe to events matching a glob-style pattern.
   * Examples: "audit.*", "task.state.changed", "*"
   */
  subscribe(pattern: string, handler: EventHandler): EventSubscription;

  /** One-shot subscription that resolves with the first matching event. */
  once(pattern: string, timeoutMs: number): Promise<PlatformEvent>;
}
