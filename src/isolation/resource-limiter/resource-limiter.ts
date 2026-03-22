/**
 * ResourceLimiter — per-agent resource enforcement (PRD §5.5).
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";

export interface ResourceLimiter {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  setLimits(ctx: TenantContext, agentId: string, limits: ResourceLimits): Promise<void>;
  getLimits(ctx: TenantContext, agentId: string): Promise<ResourceLimits>;
  getCurrentUsage(ctx: TenantContext, agentId: string): Promise<ResourceUsage>;
  checkLimit(ctx: TenantContext, agentId: string, resource: string, amount: number): Promise<ResourceCheckResult>;
  enforce(ctx: TenantContext, agentId: string, resource: string, amount: number): Promise<void>;
}

export interface ResourceLimits {
  maxMemoryMb: number;
  maxCpuPercent: number;
  maxConcurrentTasks: number;
  maxStorageMb: number;
  maxNetworkBandwidthKbps: number;
  custom?: Record<string, number>;
}

export interface ResourceUsage {
  memoryMb: number;
  cpuPercent: number;
  activeTasks: number;
  storageMb: number;
  networkBandwidthKbps: number;
  custom?: Record<string, number>;
}

export interface ResourceCheckResult {
  allowed: boolean;
  resource: string;
  requested: number;
  available: number;
  limit: number;
}
