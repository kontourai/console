// Vendor-neutral OAuth 2.1 / OIDC Resource-Server verification (ADR 0003).
//
// This is plain OIDC: a JWT validated against an issuer + audience using the
// authorization server's JWKS. It is NOT tied to any one provider — point
// CONSOLE_OAUTH_ISSUER at ANY OIDC-compliant authorization server (WorkOS,
// Auth0/Okta, Zitadel, Keycloak, Ory Hydra, AWS Cognito, …) and it works. The
// provider is pure configuration; the only provider-dependent value is which
// claim carries the tenant/organization id (CONSOLE_OAUTH_TENANT_CLAIM).
//
// Additive + config-gated: when no OAuth config is present (resolveOAuthConfig
// returns undefined) none of this runs and the console authenticates exactly as
// before (opaque bearer tokens + signed session cookies).
//
// Extension point: providers that issue OPAQUE access tokens (no JWT) use RFC
// 7662 token introspection instead of JWKS. That can be added later as an
// alternative AccessTokenVerifier without changing call sites — verifyAccessToken
// is the seam.

// jose is ESM-only; this module compiles to CommonJS, so load it via dynamic
// import (a static import would be a TS1479 error, and type-position imports of
// jose would require a resolution-mode attribute).
const josePromise = import("jose");

/** jose's key resolver (createRemoteJWKSet / createLocalJWKSet return value).
 *  Typed loosely to avoid a type-position import of the ESM-only `jose`. */
type KeyResolver = any;

export interface ConsoleOAuthConfig {
  /** Authorization Server issuer (token `iss`), e.g. an OIDC provider domain. */
  issuer: string;
  /** Canonical resource identifier this console accepts tokens for — the token
   *  `aud` (RFC 8707 audience binding) and the RFC 9728 `resource` value. */
  audience: string;
  /** JWKS endpoint of the AS. Defaults to `${issuer}/.well-known/jwks.json`. */
  jwksUri: string;
  /** JWT claim carrying the tenant/organization id (provider-dependent; e.g.
   *  WorkOS/Auth0 use `org_id`). Default `org_id`. */
  tenantClaim: string;
}

/** Build OAuth Resource-Server config from env, or undefined when not configured. */
export function resolveOAuthConfig(env: NodeJS.ProcessEnv): ConsoleOAuthConfig | undefined {
  const issuer = env.CONSOLE_OAUTH_ISSUER?.trim();
  const audience = env.CONSOLE_OAUTH_AUDIENCE?.trim();
  if (!issuer || !audience) return undefined;
  const jwksUri = env.CONSOLE_OAUTH_JWKS_URI?.trim() || `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
  const tenantClaim = env.CONSOLE_OAUTH_TENANT_CLAIM?.trim() || "org_id";
  return { issuer, audience, jwksUri, tenantClaim };
}

/** Cheap structural check: a compact JWS has three non-empty base64url segments. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export interface VerifiedAccessToken {
  tenantId: string;
  subject?: string;
  scopes: string[];
}

/** A pluggable access-token verifier (JWKS today; introspection could be added). */
export type AccessTokenVerifier = (token: string, config: ConsoleOAuthConfig) => Promise<VerifiedAccessToken>;

// One JWKS resolver per jwksUri (createRemoteJWKSet caches keys + rotation internally).
const jwksCache = new Map<string, KeyResolver>();

/** Test seam: inject a key resolver (e.g. a local JWKS) for a jwksUri, bypassing the network. */
export function __setJwksForTest(jwksUri: string, getKey: KeyResolver): void {
  jwksCache.set(jwksUri, getKey);
}

async function jwksFor(config: ConsoleOAuthConfig): Promise<KeyResolver> {
  let getKey = jwksCache.get(config.jwksUri);
  if (!getKey) {
    const { createRemoteJWKSet } = await josePromise;
    getKey = createRemoteJWKSet(new URL(config.jwksUri));
    jwksCache.set(config.jwksUri, getKey);
  }
  return getKey;
}

/**
 * Verify an OIDC access token (JWT) and resolve its tenant. Throws on any failure
 * (bad signature, wrong issuer/audience, expired, missing tenant claim) — callers
 * translate a throw into 401. This is the default {@link AccessTokenVerifier}.
 */
export const verifyAccessToken: AccessTokenVerifier = async (token, config) => {
  const { jwtVerify } = await josePromise;
  const { payload } = await jwtVerify(token, await jwksFor(config), {
    issuer: config.issuer,
    audience: config.audience
  });
  const tenantId = readStringClaim(payload, config.tenantClaim);
  if (!tenantId) {
    throw new Error(`access token is missing tenant claim '${config.tenantClaim}'`);
  }
  return { tenantId, subject: payload.sub, scopes: readScopes(payload) };
};

function readStringClaim(payload: Record<string, unknown>, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" && value ? value : undefined;
}

function readScopes(payload: Record<string, unknown>): string[] {
  const raw = payload.scope ?? payload.scp;
  if (typeof raw === "string") return raw.split(" ").filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/** RFC 9728 Protected Resource Metadata document for this console. */
export function protectedResourceMetadata(config: ConsoleOAuthConfig): Record<string, unknown> {
  return {
    resource: config.audience,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["telemetry:read", "telemetry:write", "records:read", "records:write", "pricing:read"]
  };
}
