/**
 * Kubernetes Agent Runtime — each Agent runs as an independent Pod.
 *
 * RuntimeSpec maps to K8s manifests:
 *   memoryLimitMb    → container resources.limits.memory
 *   cpuLimit         → container resources.limits.cpu
 *   networkPolicy    → K8s NetworkPolicy object
 *   filesystemPolicy → PVC mount config
 */

import * as k8s from "@kubernetes/client-node";
import type { TenantContext } from "../../../kernel/tenant-context.ts";
import type {
  AgentRuntimeBackend,
  RuntimeSpec,
  RuntimeInstance,
  RuntimeMetrics,
} from "../agent-runtime.ts";

export interface K8sRuntimeConfig {
  namespace: string;
  kubeConfigPath?: string;
  defaultImage?: string;
}

export class KubernetesRuntime implements AgentRuntimeBackend {
  private coreApi!: k8s.CoreV1Api;
  private networkApi!: k8s.NetworkingV1Api;
  private readonly namespace: string;
  private readonly defaultImage: string;

  constructor(private config: K8sRuntimeConfig) {
    this.namespace = config.namespace;
    this.defaultImage = config.defaultImage ?? "openclaw/agent-runtime:latest";
  }

  async initialize(): Promise<void> {
    const kc = new k8s.KubeConfig();
    if (this.config.kubeConfigPath) {
      kc.loadFromFile(this.config.kubeConfigPath);
    } else {
      kc.loadFromDefault();
    }
    this.coreApi = kc.makeApiClient(k8s.CoreV1Api);
    this.networkApi = kc.makeApiClient(k8s.NetworkingV1Api);
  }

  async shutdown(): Promise<void> {}

  async createInstance(ctx: TenantContext, spec: RuntimeSpec): Promise<RuntimeInstance> {
    const podName = `agent-${spec.agentId}-${Date.now()}`;
    const labels = {
      "app.kubernetes.io/name": "openclaw-agent",
      "openclaw.ai/tenant-id": ctx.tenantId,
      "openclaw.ai/agent-id": spec.agentId,
    };

    const pod: k8s.V1Pod = {
      metadata: { name: podName, labels },
      spec: {
        containers: [
          {
            name: "agent",
            image: spec.image ?? this.defaultImage,
            env: Object.entries(spec.environment).map(([name, value]) => ({ name, value })),
            resources: {
              limits: {
                cpu: `${Math.round(spec.cpuLimit * 1000)}m`,
                memory: `${spec.memoryLimitMb}Mi`,
              },
            },
          },
        ],
        restartPolicy: "Never",
        automountServiceAccountToken: false,
        activeDeadlineSeconds: Math.ceil(spec.timeoutMs / 1000),
      },
    };

    await this.coreApi.createNamespacedPod({ namespace: this.namespace, body: pod });

    if (spec.networkPolicy && spec.networkPolicy.mode !== "none") {
      await this.applyNetworkPolicy(podName, spec, labels);
    }

    return {
      id: podName,
      tenantId: ctx.tenantId,
      agentId: spec.agentId,
      state: "creating",
      spec,
      createdAt: new Date(),
    };
  }

  async destroyInstance(_ctx: TenantContext, instanceId: string): Promise<void> {
    await this.coreApi.deleteNamespacedPod({
      name: instanceId,
      namespace: this.namespace,
    });
  }

  async getInstance(_ctx: TenantContext, instanceId: string): Promise<RuntimeInstance | null> {
    try {
      const pod = await this.coreApi.readNamespacedPod({
        name: instanceId,
        namespace: this.namespace,
      });
      return this.podToInstance(pod);
    } catch {
      return null;
    }
  }

  async listInstances(ctx: TenantContext): Promise<RuntimeInstance[]> {
    const pods = await this.coreApi.listNamespacedPod({
      namespace: this.namespace,
      labelSelector: `openclaw.ai/tenant-id=${ctx.tenantId}`,
    });
    return (pods.items ?? []).map((pod) => this.podToInstance(pod));
  }

  async getMetrics(_ctx: TenantContext, _instanceId: string): Promise<RuntimeMetrics> {
    return {
      memoryUsedMb: 0,
      cpuUsagePercent: 0,
      activeConnections: 0,
      requestCount: 0,
      errorCount: 0,
      uptimeMs: 0,
    };
  }

  private podToInstance(pod: k8s.V1Pod): RuntimeInstance {
    const phase = pod.status?.phase ?? "Unknown";
    const stateMap: Record<string, RuntimeInstance["state"]> = {
      Pending: "creating",
      Running: "running",
      Succeeded: "stopped",
      Failed: "failed",
      Unknown: "failed",
    };

    return {
      id: pod.metadata?.name ?? "unknown",
      tenantId: pod.metadata?.labels?.["openclaw.ai/tenant-id"] ?? "unknown",
      agentId: pod.metadata?.labels?.["openclaw.ai/agent-id"] ?? "unknown",
      state: stateMap[phase] ?? "failed",
      spec: {} as RuntimeSpec,
      createdAt: pod.metadata?.creationTimestamp ? new Date(pod.metadata.creationTimestamp) : new Date(),
      startedAt: pod.status?.startTime ? new Date(pod.status.startTime) : undefined,
    };
  }

  private async applyNetworkPolicy(
    podName: string,
    spec: RuntimeSpec,
    labels: Record<string, string>,
  ): Promise<void> {
    const policy = spec.networkPolicy!;
    const egressRules: k8s.V1NetworkPolicyEgressRule[] = [];

    if (policy.mode === "allowlist") {
      for (const rule of policy.rules.filter((r) => r.direction === "outbound" && r.action === "allow")) {
        egressRules.push({
          to: [{ ipBlock: { cidr: rule.host } }],
          ports: rule.port ? [{ port: rule.port, protocol: (rule.protocol ?? "TCP").toUpperCase() }] : undefined,
        });
      }
    }

    const netPolicy: k8s.V1NetworkPolicy = {
      metadata: { name: `np-${podName}` },
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ["Egress"],
        egress: egressRules.length > 0 ? egressRules : undefined,
      },
    };

    await this.networkApi.createNamespacedNetworkPolicy({
      namespace: this.namespace,
      body: netPolicy,
    });
  }
}
