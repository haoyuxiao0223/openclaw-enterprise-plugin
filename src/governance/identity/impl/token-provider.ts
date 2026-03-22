/**
 * Token/Password identity provider — wraps existing auth.ts logic.
 *
 * Default Phase 0-1 implementation. When no OIDC is configured,
 * authentication behaves identically to pre-upgrade.
 */

import type {
  IdentityProvider,
  AuthRequest,
  AuthResult,
  UserIdentity,
} from "../identity-provider.ts";

export interface TokenProviderConfig {
  mode: "none" | "token" | "password";
  token?: string;
  password?: string;
}

export class TokenIdentityProvider implements IdentityProvider {
  readonly type = "token";
  private config: TokenProviderConfig;

  constructor(config: TokenProviderConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async authenticate(request: AuthRequest): Promise<AuthResult> {
    if (this.config.mode === "none") {
      return { authenticated: true, identity: this.defaultIdentity() };
    }

    if (request.type === "token") {
      const token = request.credentials?.["token"] as string | undefined;
      if (!token) return { authenticated: false, error: "No token provided" };

      if (this.config.mode === "token" && token === this.config.token) {
        return { authenticated: true, identity: this.defaultIdentity() };
      }
      return { authenticated: false, error: "Invalid token" };
    }

    if (request.type === "password") {
      const password = request.credentials?.["password"] as string | undefined;
      if (!password) return { authenticated: false, error: "No password provided" };

      if (this.config.mode === "password" && password === this.config.password) {
        return { authenticated: true, identity: this.defaultIdentity() };
      }
      return { authenticated: false, error: "Invalid password" };
    }

    return { authenticated: false, error: `Unsupported auth type: ${request.type}` };
  }

  async refreshToken(_refreshToken: string): Promise<AuthResult> {
    return { authenticated: false, error: "Token refresh not supported in token mode" };
  }

  async revokeToken(_token: string): Promise<void> {}

  private defaultIdentity(): UserIdentity {
    return {
      userId: "owner",
      tenantId: "default",
      roles: ["admin"],
      groups: [],
    };
  }
}
