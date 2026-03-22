/**
 * CircuitBreaker — fault-tolerance pattern (PRD §5.6.2).
 *
 * States: closed → open → half_open → closed|open
 */

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMaxCalls: number;
  resetTimeMs: number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureAt?: Date;
  lastSuccessAt?: Date;
  openedAt?: Date;
  halfOpenCalls: number;
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly stats: CircuitBreakerStats,
  ) {
    super(`Circuit breaker is open. Retry after ${retryAfterMs}ms`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureAt?: Date;
  private lastSuccessAt?: Date;
  private openedAt?: Date;
  private halfOpenCalls = 0;
  private readonly opts: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.opts = options;
  }

  get stats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      halfOpenCalls: this.halfOpenCalls,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === "open") {
      const elapsed = Date.now() - (this.openedAt?.getTime() ?? 0);
      if (elapsed < this.opts.resetTimeMs) {
        throw new CircuitBreakerOpenError(this.opts.resetTimeMs - elapsed, this.stats);
      }
      this.transitionTo("half_open");
    }

    if (this.state === "half_open" && this.halfOpenCalls >= this.opts.halfOpenMaxCalls) {
      throw new CircuitBreakerOpenError(this.opts.resetTimeMs, this.stats);
    }

    if (this.state === "half_open") this.halfOpenCalls++;

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  reset(): void {
    this.transitionTo("closed");
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenCalls = 0;
    this.openedAt = undefined;
  }

  private checkState(): void {
    if (this.state !== "open") return;
    const elapsed = Date.now() - (this.openedAt?.getTime() ?? 0);
    if (elapsed >= this.opts.resetTimeMs) {
      this.transitionTo("half_open");
    }
  }

  private onSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessAt = new Date();

    if (this.state === "half_open" && this.consecutiveSuccesses >= this.opts.successThreshold) {
      this.transitionTo("closed");
      this.halfOpenCalls = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureAt = new Date();

    if (this.state === "closed" && this.consecutiveFailures >= this.opts.failureThreshold) {
      this.transitionTo("open");
      this.openedAt = new Date();
    } else if (this.state === "half_open") {
      this.transitionTo("open");
      this.openedAt = new Date();
      this.halfOpenCalls = 0;
    }
  }

  private transitionTo(next: CircuitState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.opts.onStateChange?.(prev, next);
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Circuit breaker timeout after ${this.opts.timeoutMs}ms`)),
        this.opts.timeoutMs,
      );
      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
