/**
 * SecretBackend — pluggable credential / sensitive-config abstraction.
 *
 * PRD §4.4: Upgrades the existing SecretRef (env/file/exec) mechanism into
 * a unified interface that supports tenant-scoped secrets, optional write,
 * and rotation notifications.
 *
 * Reference implementations:
 *  - SecretRefBackend (wraps existing SecretRef, backward-compat)
 *  - EnvBackend       (pure environment variables, lightweight)
 *  - VaultBackend     (HashiCorp Vault, enterprise)
 */

import type { TenantContext } from "./tenant-context.ts";
import type { BackendLifecycle } from "./types.ts";

export interface SecretBackend extends BackendLifecycle {
  getSecret(ctx: TenantContext, path: string): Promise<string | null>;

  /** Write a secret. Not all backends support writes. */
  setSecret?(ctx: TenantContext, path: string, value: string): Promise<void>;

  deleteSecret?(ctx: TenantContext, path: string): Promise<boolean>;

  /** List secret paths (values are never returned by this method). */
  listSecretPaths?(ctx: TenantContext, prefix: string): Promise<string[]>;

  /** Subscribe to secret rotation events. */
  onRotation?(handler: (path: string) => void): void;
}
