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

import crypto from "node:crypto";

// jose is ESM-only; this module compiles to CommonJS, so load it via dynamic
// import (a static import would be a TS1479 error, and type-position imports of
// jose would require a resolution-mode attribute).
const josePromise = import("jose");

/** jose's key resolver (createRemoteJWKSet / createLocalJWKSet return value).
 *  `unknown` at the cache boundary (we can't type-position-import the ESM-only
 *  `jose`); narrowed with one cast only at the jwtVerify call site. */
type KeyResolver = unknown;

export interface ConsoleOAuthConfig {
  /** Authorization Server issuer (token `iss`), e.g. an OIDC provider domain. */
  issuer: string;
  /** Canonical resource identifier this console accepts tokens for — the token
   *  `aud` (RFC 8707 audience binding) and the RFC 9728 `resource` value. */
  audience: string;
  /** JWKS endpoint of the AS. Defaults to `${issuer}/.well-known/jwks.json`. */
  jwksUri: string;
  /** Ordered JWT claims that may carry the tenant/organization id; the first one
   *  present on the token wins. Provider-dependent and lets user tokens and
   *  machine (client-credentials / M2M) tokens use different claims under one
   *  config — e.g. `["org_id", "tenant_id"]`. Default `["org_id"]`. */
  tenantClaims: string[];
}

/** Build OAuth Resource-Server config from env, or undefined when not configured. */
export function resolveOAuthConfig(env: NodeJS.ProcessEnv): ConsoleOAuthConfig | undefined {
  const issuer = env.CONSOLE_OAUTH_ISSUER?.trim();
  const audience = env.CONSOLE_OAUTH_AUDIENCE?.trim();
  if (!issuer || !audience) return undefined;
  const jwksUri = env.CONSOLE_OAUTH_JWKS_URI?.trim() || `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
  const tenantClaims = (env.CONSOLE_OAUTH_TENANT_CLAIM?.trim() || "org_id")
    .split(",").map((claim) => claim.trim()).filter(Boolean);
  return { issuer, audience, jwksUri, tenantClaims };
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
  /** Verified token issuer (`iss`) — carried onto the principal for provenance. */
  issuer?: string;
  /** OAuth client that presented the token, from the `client_id`/`cid` claim.
   *  Present ⇒ a machine (client-credentials / M2M) principal. WorkOS and most
   *  providers stamp `client_id` on client-credentials tokens; some use `cid`. */
  clientId?: string;
  /** Whether this token was issued to a machine client (client-credentials/M2M)
   *  rather than a human. True when a `client_id`/`cid` claim is present. Downstream
   *  maps this to `ConsolePrincipal.kind` ("machine" vs "user"). */
  isMachine: boolean;
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
  const { payload } = await jwtVerify(token, (await jwksFor(config)) as any, {
    issuer: config.issuer,
    audience: config.audience
  });
  let tenantId: string | undefined;
  for (const claim of config.tenantClaims) {
    tenantId = readStringClaim(payload, claim);
    if (tenantId) break;
  }
  if (!tenantId) {
    throw new Error(`access token is missing a tenant claim (tried: ${config.tenantClaims.join(", ")})`);
  }
  // Machine (client-credentials / M2M) tokens carry a client identity claim. WorkOS
  // stamps `client_id`; some providers use `cid`. Its presence is what distinguishes
  // an M2M principal from a human OIDC user (who is identified by `sub` alone).
  const clientId = readStringClaim(payload, "client_id") ?? readStringClaim(payload, "cid");
  return {
    tenantId,
    subject: payload.sub,
    scopes: readScopes(payload),
    issuer: typeof payload.iss === "string" ? payload.iss : config.issuer,
    clientId,
    isMachine: Boolean(clientId)
  };
};

/** Map a JWS `alg` to the SHA variant used for OIDC `at_hash` (per OIDC Core). */
function shaForAlg(alg: string): "sha256" | "sha384" | "sha512" {
  if (alg.endsWith("384")) return "sha384";
  if (alg.endsWith("512")) return "sha512";
  return "sha256";
}

/**
 * Verify an OIDC `id_token` as the authentication assertion (OIDC Core §3.1.3.7):
 * JWKS signature, `iss`, `aud` = the client_id, `exp`, the `nonce` we issued, and
 * the `at_hash` binding to the access token (defends against access-token
 * substitution). Throws on any failure. Returns the validated claims.
 */
export async function verifyOidcIdToken(
  idToken: string,
  config: ConsoleOAuthConfig,
  opts: { audience: string; nonce: string; accessToken?: string }
): Promise<Record<string, unknown>> {
  const { jwtVerify } = await josePromise;
  const { payload, protectedHeader } = await jwtVerify(idToken, (await jwksFor(config)) as any, {
    issuer: config.issuer,
    audience: opts.audience
  });
  // nonce is required (anti-replay / browser binding) — never skipped.
  if (payload.nonce !== opts.nonce) {
    throw new Error("id_token nonce mismatch");
  }
  // at_hash is OPTIONAL for the authorization-code flow (OIDC Core §3.1.3.6): the
  // id_token and access token are returned together from the trusted back-channel
  // token endpoint (TLS + PKCE + client auth), so the access-token binding is only
  // mandatory for front-channel delivery (hybrid/implicit). Major providers omit it
  // in code flow (e.g. Auth0, Microsoft Entra), so requiring it would reject them.
  // Validate the binding when the provider supplies at_hash; do not require it.
  if (opts.accessToken && typeof payload.at_hash === "string") {
    const digest = crypto.createHash(shaForAlg(String(protectedHeader.alg || ""))).update(opts.accessToken, "ascii").digest();
    const expected = digest.subarray(0, digest.length / 2).toString("base64url");
    if (expected !== payload.at_hash) {
      throw new Error("id_token at_hash mismatch (access-token binding failed)");
    }
  }
  return payload as Record<string, unknown>;
}

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
    scopes_supported: ["telemetry:read", "telemetry:write", "records:read", "records:write", "pricing:read", "economics:read"]
  };
}
