// WorkOS / OAuth 2.1 Resource-Server auth for the console (ADR 0003, Phase 1).
//
// Additive and config-gated: when no WorkOS config is present (resolveWorkosConfig
// returns undefined) none of this is exercised and the console authenticates
// exactly as before (opaque bearer tokens + signed session cookies). When WorkOS
// IS configured, a bearer credential that is structurally a JWT is verified as a
// WorkOS-issued OAuth 2.1 access token: JWKS signature + `iss` + audience-bound
// `aud` (RFC 8707), with the tenant resolved from the organization claim.
// jose is ESM-only; this module compiles to CommonJS, so load it via dynamic
// import (works from CJS on Node; a static import would be a TS1479 error, and
// type-position imports of jose would require a resolution-mode attribute).
const josePromise = import("jose");

/** jose's key resolver (createRemoteJWKSet / createLocalJWKSet return value).
 *  Typed loosely to avoid a type-position import of the ESM-only `jose`. */
type KeyResolver = any;

export interface ConsoleWorkosConfig {
  /** OAuth 2.1 Authorization Server issuer (token `iss`), e.g. an AuthKit domain. */
  issuer: string;
  /** Canonical resource identifier this console accepts tokens for — the token
   *  `aud` (RFC 8707 audience binding) and the RFC 9728 `resource` value. */
  audience: string;
  /** JWKS endpoint of the AS. Defaults to `${issuer}/.well-known/jwks.json`. */
  jwksUri: string;
  /** JWT claim carrying the tenant/organization id. Default `org_id`. */
  tenantClaim: string;
}

/** Build WorkOS config from env, or undefined when not configured (JWT path stays off). */
export function resolveWorkosConfig(env: NodeJS.ProcessEnv): ConsoleWorkosConfig | undefined {
  const issuer = env.CONSOLE_WORKOS_ISSUER?.trim();
  const audience = env.CONSOLE_WORKOS_AUDIENCE?.trim();
  if (!issuer || !audience) return undefined;
  const jwksUri = env.CONSOLE_WORKOS_JWKS_URI?.trim() || `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
  const tenantClaim = env.CONSOLE_WORKOS_TENANT_CLAIM?.trim() || "org_id";
  return { issuer, audience, jwksUri, tenantClaim };
}

/** Cheap structural check: a compact JWS has three non-empty base64url segments. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export interface WorkosVerifyResult {
  tenantId: string;
  subject?: string;
  scopes: string[];
}

// One JWKS resolver per jwksUri (createRemoteJWKSet caches keys + rotation internally).
const jwksCache = new Map<string, KeyResolver>();

/** Test seam: inject a key resolver (e.g. a local JWKS) for a jwksUri, bypassing the network. */
export function __setWorkosJwksForTest(jwksUri: string, getKey: KeyResolver): void {
  jwksCache.set(jwksUri, getKey);
}

async function jwksFor(config: ConsoleWorkosConfig): Promise<KeyResolver> {
  let getKey = jwksCache.get(config.jwksUri);
  if (!getKey) {
    const { createRemoteJWKSet } = await josePromise;
    getKey = createRemoteJWKSet(new URL(config.jwksUri));
    jwksCache.set(config.jwksUri, getKey);
  }
  return getKey;
}

/**
 * Verify a WorkOS-issued access token and resolve its tenant. Throws on any
 * failure (bad signature, wrong issuer/audience, expired, missing tenant claim) —
 * callers translate a throw into 401.
 */
export async function verifyWorkosToken(token: string, config: ConsoleWorkosConfig): Promise<WorkosVerifyResult> {
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
}

function readStringClaim(payload: Record<string, unknown>, claim: string): string | undefined {
  const value = (payload as Record<string, unknown>)[claim];
  return typeof value === "string" && value ? value : undefined;
}

function readScopes(payload: Record<string, unknown>): string[] {
  const raw = (payload as Record<string, unknown>).scope ?? (payload as Record<string, unknown>).scp;
  if (typeof raw === "string") return raw.split(" ").filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/** RFC 9728 Protected Resource Metadata document for this console. */
export function protectedResourceMetadata(config: ConsoleWorkosConfig): Record<string, unknown> {
  return {
    resource: config.audience,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["telemetry:read", "telemetry:write", "records:read", "pricing:read"]
  };
}
