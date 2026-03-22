/**
 * Enterprise Bootstrap — top-level entry that assembles all enterprise modules
 * and exposes start/stop lifecycle for the OpenClaw plugin service contract.
 */

import type { EnterpriseConfig } from "./src/kernel/config.ts";
import type { EnterpriseModules } from "./src/registry.ts";
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
      resolveEmbedding(config),
      resolveIsolation(config),
      resolveReliability(config),
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
  await shutdownKernel(modules.kernel);
}

/** Returns the active enterprise modules (null if not bootstrapped). */
export function getEnterpriseModules(): EnterpriseModules | null {
  return activeModules;
}

async function resolveGovernance(
  config: EnterpriseConfig,
  kernel: EnterpriseModules["kernel"],
): Promise<EnterpriseModules["governance"]> {
  if (!config.governance) return null;

  const { TokenIdentityProvider } = await import(
    "./src/governance/identity/impl/token-provider.ts"
  );
  const { ScopePolicyEngine } = await import(
    "./src/governance/authorization/impl/scope-policy.ts"
  );

  return {
    identityProvider: new TokenIdentityProvider(kernel.secret),
    policyEngine: new ScopePolicyEngine(),
  };
}

async function resolveAudit(
  config: EnterpriseConfig,
  kernel: EnterpriseModules["kernel"],
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

  return { pipeline: new MemoryAuditPipeline(sinks) };
}

async function resolveCollaboration(
  _config: EnterpriseConfig,
  _kernel: EnterpriseModules["kernel"],
): Promise<EnterpriseModules["collaboration"]> {
  return null;
}

async function resolveEmbedding(
  _config: EnterpriseConfig,
): Promise<EnterpriseModules["embedding"]> {
  return null;
}

async function resolveIsolation(
  _config: EnterpriseConfig,
): Promise<EnterpriseModules["isolation"]> {
  return null;
}

async function resolveReliability(
  config: EnterpriseConfig,
): Promise<EnterpriseModules["reliability"]> {
  if (!config.reliability?.metrics) return null;

  const { HealthCheckerImpl } = await import(
    "./src/reliability/health/health-checker.ts"
  );

  return {
    checkpointManager: undefined,
    healthChecker: new HealthCheckerImpl(),
    metricsProvider: undefined,
  };
}
