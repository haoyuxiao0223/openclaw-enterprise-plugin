/**
 * IdentityProvider — pluggable authentication abstraction.
 *
 * PRD §5.1.1: Enterprise users implement this interface to integrate
 * their IdP (OIDC, SAML, LDAP). The existing token/password auth
 * is wrapped as TokenIdentityProvider for backward compatibility.
 */

export interface IdentityProvider {
  readonly type: string;

  initialize(config: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;

  authenticate(request: AuthRequest): Promise<AuthResult>;
  refreshToken?(refreshToken: string): Promise<AuthResult>;
  revokeToken?(token: string): Promise<void>;
}

export interface AuthRequest {
  headers: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  clientIp: string;
  method: string;
  path: string;
}

export interface AuthResult {
  authenticated: boolean;
  identity?: UserIdentity;
  error?: string;
  expiresAt?: Date;
  accessToken?: string;
  refreshToken?: string;
}

export interface UserIdentity {
  userId: string;
  tenantId: string;
  email?: string;
  displayName?: string;
  roles: string[];
  groups: string[];
  metadata?: Record<string, string>;
}
