/**
 * HealthChecker — system-level health aggregation (PRD §5.6).
 */

export interface HealthChecker {
  registerProbe(name: string, probe: HealthProbe): void;
  check(): Promise<HealthReport>;
  checkProbe(name: string): Promise<ProbeResult>;
}

export interface HealthProbe {
  name: string;
  check(): Promise<ProbeResult>;
}

export interface ProbeResult {
  healthy: boolean;
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  probes: Record<string, ProbeResult>;
  timestamp: Date;
}
