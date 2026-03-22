/**
 * EnvSecretBackend — environment-variable-based reference implementation.
 *
 * Reads secrets from process.env. Compatible with the existing
 * SecretRef "env" source mechanism. Write/delete are not supported.
 */

import type { TenantContext } from "../../kernel/tenant-context.ts";
import type { SecretBackend } from "../../kernel/secret.ts";

export class EnvSecretBackend implements SecretBackend {
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async getSecret(_ctx: TenantContext, path: string): Promise<string | null> {
    return process.env[path] ?? null;
  }
}

/**
 * MemorySecretBackend — in-memory secret store for testing.
 */
export class MemorySecretBackend implements SecretBackend {
  private store = new Map<string, Map<string, string>>();

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {
    this.store.clear();
  }

  private getTenantSecrets(tenantId: string): Map<string, string> {
    let secrets = this.store.get(tenantId);
    if (!secrets) {
      secrets = new Map();
      this.store.set(tenantId, secrets);
    }
    return secrets;
  }

  async getSecret(ctx: TenantContext, path: string): Promise<string | null> {
    return this.getTenantSecrets(ctx.tenantId).get(path) ?? null;
  }

  async setSecret(ctx: TenantContext, path: string, value: string): Promise<void> {
    this.getTenantSecrets(ctx.tenantId).set(path, value);
  }

  async deleteSecret(ctx: TenantContext, path: string): Promise<boolean> {
    return this.getTenantSecrets(ctx.tenantId).delete(path);
  }

  async listSecretPaths(ctx: TenantContext, prefix: string): Promise<string[]> {
    const secrets = this.getTenantSecrets(ctx.tenantId);
    return Array.from(secrets.keys()).filter((k) => k.startsWith(prefix));
  }
}
