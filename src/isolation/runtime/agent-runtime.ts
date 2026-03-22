/**
 * AgentRuntimeBackend — isolated agent execution (PRD §5.5.1).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface AgentRuntimeBackend {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  createInstance(ctx: TenantContext, spec: RuntimeSpec): Promise<RuntimeInstance>;
  destroyInstance(ctx: TenantContext, instanceId: string): Promise<void>;
  getInstance(ctx: TenantContext, instanceId: string): Promise<RuntimeInstance | null>;
  listInstances(ctx: TenantContext): Promise<RuntimeInstance[]>;
  getMetrics(ctx: TenantContext, instanceId: string): Promise<RuntimeMetrics>;
}

export interface RuntimeSpec {
  agentId: string;
  image?: string;
  memoryLimitMb: number;
  cpuLimit: number;
  timeoutMs: number;
  environment: Record<string, string>;
  networkPolicy?: NetworkPolicy;
  filesystemPolicy?: FilesystemPolicy;
}

export interface RuntimeInstance {
  id: string;
  tenantId: string;
  agentId: string;
  state: "creating" | "running" | "stopped" | "failed";
  spec: RuntimeSpec;
  createdAt: Date;
  startedAt?: Date;
  stoppedAt?: Date;
}

export interface RuntimeMetrics {
  memoryUsedMb: number;
  cpuUsagePercent: number;
  activeConnections: number;
  requestCount: number;
  errorCount: number;
  uptimeMs: number;
}

export interface NetworkPolicy {
  mode: "none" | "allowlist" | "denylist" | "full";
  rules: NetworkRule[];
}

export interface NetworkRule {
  direction: "inbound" | "outbound";
  host: string;
  port?: number;
  protocol?: "tcp" | "udp" | "http" | "https";
  action: "allow" | "deny";
}

export interface FilesystemPolicy {
  readOnly: boolean;
  allowedPaths: string[];
  deniedPaths: string[];
  maxSizeMb: number;
}
