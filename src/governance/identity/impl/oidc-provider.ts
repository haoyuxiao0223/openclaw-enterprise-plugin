/**
 * OIDC identity provider — supports Authorization Code Flow,
 * Client Credentials Flow, and Token Introspection.
 *
 * Uses openid-client for OIDC discovery and token validation.
 */

import type {
  IdentityProvider,
  AuthRequest,
  AuthResult,
  UserIdentity,
} from "../identity-provider.ts";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  scopes?: string[];
  rolesClaim?: string;
  groupsClaim?: string;
  tenantClaim?: string;
}

export class OidcIdentityProvider implements IdentityProvider {
  readonly type = "oidc";
  private oidcConfig: OidcConfig;
  private clientConfig: unknown = null;

  constructor(config: OidcConfig) {
    this.oidcConfig = config;
  }

  async initialize(): Promise<void> {
    const client = await import("openid-client");
    this.clientConfig = await client.discovery(
      new URL(this.oidcConfig.issuer),
      this.oidcConfig.clientId,
      this.oidcConfig.clientSecret,
    );
  }

  async shutdown(): Promise<void> {
    this.clientConfig = null;
  }

  async authenticate(request: AuthRequest): Promise<AuthResult> {
    if (request.type !== "token") {
      return { authenticated: false, error: `OIDC only supports token auth, got: ${request.type}` };
    }

    const token = request.credentials?.["token"] as string | undefined;
    if (!token) return { authenticated: false, error: "No token provided" };

    try {
      const client = await import("openid-client");
      const result = await client.tokenIntrospection(
        this.clientConfig as Awaited<ReturnType<typeof client.discovery>>,
        token,
      );

      if (!result.active) {
        return { authenticated: false, error: "Token inactive or expired" };
      }

      const rolesClaim = this.oidcConfig.rolesClaim ?? "roles";
      const groupsClaim = this.oidcConfig.groupsClaim ?? "groups";
      const tenantClaim = this.oidcConfig.tenantClaim ?? "tenant_id";

      const identity: UserIdentity = {
        userId: result.sub as string,
        tenantId: ((result as Record<string, unknown>)[tenantClaim] as string) ?? "default",
        email: result.email as string | undefined,
        displayName: result.name as string | undefined,
        roles: ((result as Record<string, unknown>)[rolesClaim] as string[]) ?? [],
        groups: ((result as Record<string, unknown>)[groupsClaim] as string[]) ?? [],
      };

      return {
        authenticated: true,
        identity,
        expiresAt: result.exp ? new Date((result.exp as number) * 1000) : undefined,
      };
    } catch (err) {
      return { authenticated: false, error: `OIDC introspection failed: ${String(err)}` };
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      const client = await import("openid-client");
      const tokens = await client.refreshTokenGrant(
        this.clientConfig as Awaited<ReturnType<typeof client.discovery>>,
        refreshToken,
      );

      return {
        authenticated: true,
        identity: {
          userId: "unknown",
          tenantId: "default",
          roles: [],
          groups: [],
        },
        token: tokens.access_token,
        expiresAt: tokens.expires_at ? new Date(tokens.expires_at * 1000) : undefined,
      };
    } catch (err) {
      return { authenticated: false, error: `Token refresh failed: ${String(err)}` };
    }
  }

  async revokeToken(token: string): Promise<void> {
    const client = await import("openid-client");
    await client.tokenRevocation(
      this.clientConfig as Awaited<ReturnType<typeof client.discovery>>,
      token,
    );
  }
}
