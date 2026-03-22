/**
 * Shared types used across all kernel abstractions.
 */

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  details?: Record<string, unknown>;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface StorageQuery {
  prefix?: string;
  filter?: Record<string, unknown>;
  orderBy?: string;
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

/**
 * Base lifecycle interface shared by all kernel backends.
 */
export interface BackendLifecycle {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
