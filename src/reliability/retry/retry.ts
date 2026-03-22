/**
 * Retry utilities — configurable retry with backoff (PRD §5.6).
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitter: true,
};

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: Partial<RetryOptions>,
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...opts };
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (config.retryableErrors && !config.retryableErrors(err)) {
        throw err;
      }

      if (attempt >= config.maxAttempts) break;

      const delay = computeDelay(attempt, config);
      config.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

function computeDelay(attempt: number, opts: RetryOptions): number {
  let delay = opts.baseDelayMs * opts.backoffMultiplier ** (attempt - 1);
  delay = Math.min(delay, opts.maxDelayMs);
  if (opts.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }
  return Math.round(delay);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
