/**
 * Enterprise Bootstrap — top-level entry that assembles all enterprise modules
 * and exposes start/stop lifecycle for the OpenClaw plugin service contract.
 *
 * All six dimensions are wired here:
 *   Governance → Audit → Collaboration → Embedding → Isolation → Reliability
 */

import type { EnterpriseConfig } from "./src/kernel/config.ts";
import type { EnterpriseModules } from "./src/registry.ts";
import type { KernelContext } from "./src/kernel/bootstrap.ts";
import { bootstrapKernel, shutdownKernel } from "./src/kernel/bootstrap.ts";
import { resolveDefaultEnterpriseConfig } from "./src/kernel/config.ts";

let activeModules: EnterpriseModules | null = null;

/**
 * Bootstrap the full enterprise subsystem from configuration.
 * Idempotent: calling twice returns the existing instance.
 */
export async function bootstrapEnterprise(
  rawConfig?: Partial<EnterpriseConfig>,
): Promise<EnterpriseModules | null> {
  if (activeModules) return activeModules;

  const config: EnterpriseConfig = {
    ...resolveDefaultEnterpriseConfig(),
    ...rawConfig,
    enabled: rawConfig?.enabled ?? false,
  };

  if (!config.enabled) return null;

  const kernel = await bootstrapKernel(config);

  const [governance, audit, collaboration, embedding, isolation, reliability] =
    await Promise.all([
      resolveGovernance(config, kernel),
      resolveAudit(config, kernel),
      resolveCollaboration(config, kernel),
      resolveEmbedding(config, kernel),
      resolveIsolation(config, kernel),
      resolveReliability(config, kernel),
    ]);

  activeModules = {
    kernel,
    governance,
    audit,
    collaboration,
    embedding,
    isolation,
    reliability,
  };

  return activeModules;
}

/**
 * Gracefully shut down the enterprise subsystem.
 */
export async function shutdownEnterprise(): Promise<void> {
  if (!activeModules) return;
  const modules = activeModules;
  activeModules = null;

  const shutdowns: Promise<void>[] = [];

  if (modules.collaboration?.workflowEngine)
    shutdowns.push(modules.collaboration.workflowEngine.shutdown());
  if (modules.collaboration?.handoffManager)
    shutdowns.push(modules.collaboration.handoffManager.shutdown());
  if (modules.collaboration?.knowledgeStore)
    shutdowns.push(modules.collaboration.knowledgeStore.shutdown());
  if (modules.embedding?.rateLimiter)
    shutdowns.push(modules.embedding.rateLimiter.shutdown());
  if (modules.embedding?.apiKeyManager)
    shutdowns.push(modules.embedding.apiKeyManager.shutdown());
  if (modules.isolation?.runtimeBackend)
    shutdowns.push(modules.isolation.runtimeBackend.shutdown());
  if (modules.reliability?.checkpointManager)
    shutdowns.push(modules.reliability.checkpointManager.shutdown());
  if (modules.governance?.quotaManager)
    shutdowns.push(modules.governance.quotaManager.shutdown());
  if (modules.governance?.identityProvider)
    shutdowns.push(modules.governance.identityProvider.shutdown());
  if (modules.governance?.policyEngine)
    shutdowns.push(modules.governance.policyEngine.shutdown());

  await Promise.allSettled(shutdowns);
  await shutdownKernel(modules.kernel);
}

/** Returns the active enterprise modules (null if not bootstrapped). */
export function getEnterpriseModules(): EnterpriseModules | null {
  return activeModules;
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------
async function resolveGovernance(
  config: EnterpriseConfig,
  kernel: KernelContext,
): Promise<EnterpriseModules["governance"]> {
  if (!config.governance) return null;

  const identityCfg = config.governance.identity;
  let identityProvider;

  if (identityCfg?.provider === "oidc") {
    const { OidcIdentityProvider } = await import(
      "./src/governance/identity/impl/oidc-provider.ts"
    );
    const oidcCfg = identityCfg as {
      provider: string;
      issuer: string;
      clientId: string;
      clientSecret: string;
      [k: string]: unknown;
    };
    identityProvider = new OidcIdentityProvider({
      issuer: oidcCfg.issuer,
      clientId: oidcCfg.clientId,
      clientSecret: oidcCfg.clientSecret,
      redirectUri: oidcCfg["redirectUri"] as string | undefined,
      scopes: oidcCfg["scopes"] as string[] | undefined,
      rolesClaim: oidcCfg["rolesClaim"] as string | undefined,
      groupsClaim: oidcCfg["groupsClaim"] as string | undefined,
      tenantClaim: oidcCfg["tenantClaim"] as string | undefined,
    });
    await identityProvider.initialize();
  } else {
    const { TokenIdentityProvider } = await import(
      "./src/governance/identity/impl/token-provider.ts"
    );
    identityProvider = new TokenIdentityProvider({ mode: identityCfg?.provider === "token" ? "token" : "none" });
    await identityProvider.initialize();
  }

  const authzCfg = config.governance.authorization;
  let policyEngine;

  if (authzCfg?.engine === "rbac") {
    const { RbacPolicyEngine } = await import(
      "./src/governance/authorization/impl/rbac-policy.ts"
    );
    policyEngine = new RbacPolicyEngine({ storage: kernel.storage });
    await policyEngine.initialize();
  } else {
    const { ScopePolicyEngine } = await import(
      "./src/governance/authorization/impl/scope-policy.ts"
    );
    policyEngine = new ScopePolicyEngine();
    await policyEngine.initialize();
  }

  let contentFilter;
  if (config.governance.dataProtection?.filters?.length) {
    const { RegexClassifier } = await import(
      "./src/governance/data-protection/impl/regex-classifier.ts"
    );
    contentFilter = new RegexClassifier([], "both");
  }

  let quotaManager;
  if (config.governance.quota?.enabled) {
    const { TokenQuotaManager } = await import(
      "./src/governance/quota/impl/token-quota.ts"
    );
    const quotaDefaults = config.governance.quota!.defaultLimits ?? {};
    quotaManager = new TokenQuotaManager({
      storage: kernel.storage,
      cache: kernel.cache,
      windowMs: (quotaDefaults["windowMs"] as number) ?? 3_600_000,
      defaultLimit: (quotaDefaults["defaultLimit"] as number) ?? 100_000,
    });
    await quotaManager.initialize();
  }

  return { identityProvider, policyEngine, contentFilter, quotaManager };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
async function resolveAudit(
  config: EnterpriseConfig,
  kernel: KernelContext,
): Promise<EnterpriseModules["audit"]> {
  if (!config.audit?.sinks?.length) return null;

  const { MemoryAuditPipeline } = await import(
    "./src/audit/impl/memory-pipeline.ts"
  );
  const { LogAuditSink } = await import("./src/audit/impl/log-sink.ts");
  const { StorageAuditSink } = await import(
    "./src/audit/impl/storage-sink.ts"
  );

  const sinks = config.audit.sinks.map((s) => {
    switch (s.type) {
      case "storage":
        return new StorageAuditSink(kernel.storage);
      default:
        return new LogAuditSink();
    }
  });

  const pipeline = new MemoryAuditPipeline();
  for (const sink of sinks) {
    pipeline.registerSink(sink);
  }
  return { pipeline };
}

// ---------------------------------------------------------------------------
// Collaboration (previously returned null)
// ---------------------------------------------------------------------------
async function resolveCollaboration(
  _config: EnterpriseConfig,
  kernel: KernelContext,
): Promise<EnterpriseModules["collaboration"]> {
  const { SimpleWorkflowEngine } = await import(
    "./src/collaboration/workflow/impl/simple-workflow.ts"
  );
  const { StorageHandoffManager } = await import(
    "./src/collaboration/handoff/impl/storage-handoff.ts"
  );
  const { StorageKnowledgeStore } = await import(
    "./src/collaboration/knowledge/impl/storage-knowledge.ts"
  );

  const workflowEngine = new SimpleWorkflowEngine({
    storage: kernel.storage,
    eventBus: kernel.eventBus,
  });
  await workflowEngine.initialize();

  const handoffManager = new StorageHandoffManager(kernel.storage, kernel.eventBus);
  await handoffManager.initialize();

  const knowledgeStore = new StorageKnowledgeStore(kernel.storage);
  await knowledgeStore.initialize();

  return { workflowEngine, handoffManager, knowledgeStore };
}

// ---------------------------------------------------------------------------
// Embedding (previously returned null)
// ---------------------------------------------------------------------------
async function resolveEmbedding(
  config: EnterpriseConfig,
  kernel: KernelContext,
): Promise<EnterpriseModules["embedding"]> {
  const { MemoryRateLimiter } = await import(
    "./src/embedding/rate-limiter/impl/memory-limiter.ts"
  );
  const { StorageApiKeyManager } = await import(
    "./src/embedding/api-key/impl/storage-api-key.ts"
  );

  const defaultWindowMs = 60_000;
  const defaultLimit = 120;

  const rateLimiter = new MemoryRateLimiter(defaultLimit, defaultWindowMs);
  await rateLimiter.initialize();

  const apiKeyManager = new StorageApiKeyManager(kernel.storage);
  await apiKeyManager.initialize();

  return { rateLimiter, apiKeyManager };
}

// ---------------------------------------------------------------------------
// Isolation (previously returned null)
// ---------------------------------------------------------------------------
async function resolveIsolation(
  config: EnterpriseConfig,
  kernel: KernelContext,
): Promise<EnterpriseModules["isolation"]> {
  const runtimeCfg = config.isolation?.runtime;
  let runtimeBackend;

  if (runtimeCfg?.backend === "docker") {
    const { DockerRuntime } = await import(
      "./src/isolation/runtime/impl/docker-runtime.ts"
    );
    runtimeBackend = new DockerRuntime();
    await runtimeBackend.initialize();
  } else if (runtimeCfg?.backend === "kubernetes") {
    const { KubernetesRuntime } = await import(
      "./src/isolation/runtime/impl/k8s-runtime.ts"
    );
    runtimeBackend = new KubernetesRuntime({
      namespace: (runtimeCfg as Record<string, unknown>)["namespace"] as string ?? "openclaw",
    });
    await runtimeBackend.initialize();
  } else {
    const { InProcessRuntime } = await import(
      "./src/isolation/runtime/impl/inprocess-runtime.ts"
    );
    runtimeBackend = new InProcessRuntime();
    await runtimeBackend.initialize();
  }

  return { runtimeBackend };
}

// ---------------------------------------------------------------------------
// Reliability (previously only health checker)
// ---------------------------------------------------------------------------
async function resolveReliability(
  config: EnterpriseConfig,
  kernel: KernelContext,
): Promise<EnterpriseModules["reliability"]> {
  const { HealthCheckerImpl } = await import(
    "./src/reliability/health/health-checker-impl.ts"
  );
  const { StorageCheckpointManager } = await import(
    "./src/reliability/checkpoint/impl/storage-checkpoint.ts"
  );

  const healthChecker = new HealthCheckerImpl();

  healthChecker.registerProbe("storage", {
    name: "storage",
    check: async () => kernel.storage.healthCheck(),
  });

  const checkpointManager = new StorageCheckpointManager(kernel.storage);
  await checkpointManager.initialize();

  let metricsProvider: unknown;
  if (config.reliability?.metrics?.provider === "prometheus") {
    const { NoopMetricsProvider } = await import(
      "./src/reliability/health/metrics-provider.ts"
    );
    metricsProvider = new NoopMetricsProvider();
  }

  return { checkpointManager, healthChecker, metricsProvider };
}
