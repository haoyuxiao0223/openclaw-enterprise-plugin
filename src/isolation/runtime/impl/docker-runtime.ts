// Production use requires dockerode integration.

import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type {
  AgentRuntimeBackend,
  RuntimeInstance,
  RuntimeMetrics,
  RuntimeSpec,
} from "../agent-runtime.ts";

type DockerInstance = RuntimeInstance & { containerId?: string };

export class DockerRuntime implements AgentRuntimeBackend {
  private readonly instances = new Map<string, DockerInstance>();

  async initialize(): Promise<void> {}

  async shutdown(): Promise<void> {}

  async createInstance(ctx: TenantContext, spec: RuntimeSpec): Promise<RuntimeInstance> {
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const instance: DockerInstance = {
      id,
      tenantId: ctx.tenantId,
      agentId: spec.agentId,
      state: "creating",
      spec,
      createdAt,
    };
    this.instances.set(id, instance);
    console.info(`[DockerRuntime] would create container for instance ${id} (agent ${spec.agentId})`);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    instance.state = "running";
    instance.startedAt = new Date();
    instance.containerId = `stub-${id}`;
    console.info(`[DockerRuntime] stub container ready: ${instance.containerId}`);
    return instance;
  }

  async destroyInstance(ctx: TenantContext, instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.tenantId !== ctx.tenantId) {
      return;
    }
    console.info(
      `[DockerRuntime] would stop and remove container ${instance.containerId ?? "(none)"} for instance ${instanceId}`,
    );
    instance.state = "stopped";
    instance.stoppedAt = new Date();
    instance.containerId = undefined;
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
    const uptimeMs =
      instance.startedAt && instance.state === "running"
        ? Date.now() - instance.startedAt.getTime()
        : 0;
    return {
      memoryUsedMb: 0,
      cpuUsagePercent: 0,
      activeConnections: 0,
      requestCount: 0,
      errorCount: 0,
      uptimeMs,
    };
  }
}
