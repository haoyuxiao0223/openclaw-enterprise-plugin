import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type {
  AgentRuntimeBackend,
  RuntimeInstance,
  RuntimeMetrics,
  RuntimeSpec,
} from "../agent-runtime.ts";

export class InProcessRuntime implements AgentRuntimeBackend {
  private readonly instances = new Map<string, RuntimeInstance>();

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  async createInstance(ctx: TenantContext, spec: RuntimeSpec): Promise<RuntimeInstance> {
    const id = crypto.randomUUID();
    const now = new Date();
    const instance: RuntimeInstance = {
      id,
      tenantId: ctx.tenantId,
      agentId: spec.agentId,
      state: "running",
      spec,
      createdAt: now,
      startedAt: now,
    };
    this.instances.set(id, instance);
    return instance;
  }

  async destroyInstance(ctx: TenantContext, instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.tenantId !== ctx.tenantId) {
      return;
    }
    instance.state = "stopped";
    instance.stoppedAt = new Date();
  }

  async getInstance(ctx: TenantContext, instanceId: string): Promise<RuntimeInstance | null> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.tenantId !== ctx.tenantId) {
      return null;
    }
    return instance;
  }

  async listInstances(ctx: TenantContext): Promise<RuntimeInstance[]> {
    return [...this.instances.values()].filter((i) => i.tenantId === ctx.tenantId);
  }

  async getMetrics(ctx: TenantContext, instanceId: string): Promise<RuntimeMetrics> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.tenantId !== ctx.tenantId) {
      return {
        memoryUsedMb: 0,
        cpuUsagePercent: 0,
        activeConnections: 0,
        requestCount: 0,
        errorCount: 0,
        uptimeMs: 0,
      };
    }
    const mem = process.memoryUsage();
    return {
      memoryUsedMb: mem.heapUsed / (1024 * 1024),
      cpuUsagePercent: 0,
      activeConnections: 0,
      requestCount: 0,
      errorCount: 0,
      uptimeMs: Math.round(process.uptime() * 1000),
    };
  }
}
