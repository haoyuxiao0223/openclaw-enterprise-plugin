declare module "pg" {
  export interface PoolConfig {
    connectionString?: string;
    min?: number;
    max?: number;
    idleTimeoutMillis?: number;
    [key: string]: unknown;
  }

  export interface QueryResult<T = Record<string, unknown>> {
    rows: T[];
    rowCount: number;
    command: string;
    fields: Array<{ name: string; dataTypeID: number }>;
  }

  export class PoolClient {
    query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    release(err?: Error): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    connect(): Promise<PoolClient>;
    query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): this;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  }

  const pg: { Pool: typeof Pool };
  export default pg;
}

declare module "redlock" {
  import type IORedis from "ioredis";

  interface Lock {
    value: string;
    attempts: number;
    expiration: number;
    release(): Promise<void>;
    extend(duration: number): Promise<Lock>;
  }

  interface RedlockOptions {
    driftFactor?: number;
    retryCount?: number;
    retryDelay?: number;
    retryJitter?: number;
    automaticExtensionThreshold?: number;
  }

  class Redlock {
    constructor(clients: IORedis[], options?: RedlockOptions);
    acquire(resources: string[], duration: number): Promise<Lock>;
    release(lock: Lock): Promise<void>;
    extend(lock: Lock, duration: number): Promise<Lock>;
    quit(): Promise<void>;
  }

  export default Redlock;
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface PluginApi {
    registerService(service: {
      start: () => Promise<unknown>;
      stop: () => Promise<void>;
    }): void;
    registerHttpRoute(route: {
      path: string;
      handler: unknown;
    }): void;
    getConfig(): Record<string, unknown>;
  }

  export interface ServiceContext {
    config: Record<string, unknown>;
    logger: {
      info(...args: unknown[]): void;
      warn(...args: unknown[]): void;
      error(...args: unknown[]): void;
      debug(...args: unknown[]): void;
    };
  }

  export interface PluginEntry {
    name: string;
    version: string;
    setup(api: PluginApi, ctx: ServiceContext): Promise<void>;
  }

  export function definePluginEntry(entry: PluginEntry): PluginEntry;
}
