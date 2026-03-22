/**
 * InProcessEventBus — in-memory EventEmitter-based reference implementation.
 *
 * Zero-dependency, zero-latency event bus for single-process scenarios.
 * Uses glob-style pattern matching for subscriptions.
 */

import type { EventBus, PlatformEvent, EventHandler, EventSubscription } from "../../kernel/event-bus.ts";

interface Subscriber {
  pattern: string;
  regex: RegExp;
  handler: EventHandler;
  active: boolean;
}

export class InProcessEventBus implements EventBus {
  private subscribers: Subscriber[] = [];

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.subscribers = [];
  }

  async publish(event: PlatformEvent): Promise<void> {
    const active = this.subscribers.filter((s) => s.active && s.regex.test(event.type));
    await Promise.allSettled(active.map((s) => s.handler(event)));
  }

  async publishBatch(events: PlatformEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe(pattern: string, handler: EventHandler): EventSubscription {
    const regex = globToRegex(pattern);
    const sub: Subscriber = { pattern, regex, handler, active: true };
    this.subscribers.push(sub);

    return {
      unsubscribe: () => {
        sub.active = false;
        this.subscribers = this.subscribers.filter((s) => s !== sub);
      },
    };
  }

  once(pattern: string, timeoutMs: number): Promise<PlatformEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`EventBus.once timed out after ${timeoutMs}ms for pattern "${pattern}"`));
      }, timeoutMs);

      const sub = this.subscribe(pattern, async (event) => {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(event);
      });
    });
  }
}

/** Convert a simple glob pattern (with `*`) to a RegExp. */
function globToRegex(pattern: string): RegExp {
  if (pattern === "*") return /^.+$/;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^.]*");
  return new RegExp(`^${escaped}$`);
}
