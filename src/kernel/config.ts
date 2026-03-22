/**
 * Enterprise configuration types.
 *
 * Maps to the "enterprise" section in openclaw.json (PRD Appendix A).
 * When enterprise.enabled is false or absent, all enterprise features
 * are disabled and behavior matches the personal edition exactly.
 */

export interface EnterpriseConfig {
  enabled: boolean;

  kernel?: KernelConfig;
  governance?: GovernanceConfig;
  audit?: AuditConfig;
  isolation?: IsolationConfig;
  embedding?: EmbeddingConfig;
  reliability?: ReliabilityConfig;
}

export interface KernelConfig {
  storage?: BackendSelector;
  queue?: BackendSelector;
  cache?: BackendSelector;
  secret?: BackendSelector;
  eventBus?: BackendSelector;
  lock?: BackendSelector;
}

export interface BackendSelector {
  backend: string;
  [key: string]: unknown;
}

export interface GovernanceConfig {
  identity?: { provider: string; [key: string]: unknown };
  authorization?: { engine: string; defaultRole?: string; [key: string]: unknown };
  dataProtection?: { filters?: Array<{ type: string; direction: string }> };
  quota?: { enabled: boolean; defaultLimits?: Record<string, number> };
}

export interface AuditConfig {
  sinks?: Array<{ type: string; [key: string]: unknown }>;
}

export interface IsolationConfig {
  runtime?: {
    backend: string;
    defaults?: {
      network?: { mode: string; allowedHosts?: string[] };
      resources?: { memoryMb?: number; cpuMillicores?: number };
    };
  };
}

export interface EmbeddingConfig {
  restApi?: { enabled: boolean; prefix?: string };
  openapi?: { enabled: boolean };
  rateLimit?: { backend: string; defaultLimits?: Record<string, number> };
}

export interface ReliabilityConfig {
  retry?: { defaultPolicy?: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number } };
  circuitBreaker?: { failureThreshold: number; resetTimeoutMs: number };
  timeout?: {
    defaults?: Record<string, number>;
    cascadeKill?: { signalDelayMs: number; abortDelayMs: number; killDelayMs: number };
  };
  checkpoint?: { enabled: boolean };
  metrics?: { provider: string; port?: number };
}

/** Resolves a safe default config for personal-edition / unconfigured mode. */
export function resolveDefaultEnterpriseConfig(): EnterpriseConfig {
  return { enabled: false };
}
