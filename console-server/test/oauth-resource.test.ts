import test, { before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  resolveOAuthConfig,
  looksLikeJwt,
  verifyAccessToken,
  verifyOidcIdToken,
  protectedResourceMetadata,
  __setJwksForTest,
  type ConsoleOAuthConfig
} from "../src/console-foundation/oauth-resource";

const ISSUER = "https://auth.console.test";
const AUDIENCE = "https://console.kontourai.io";
const CONFIG: ConsoleOAuthConfig = { issuer: ISSUER, audience: AUDIENCE, jwksUri: "https://auth.console.test/jwks", tenantClaims: ["org_id"] };

// Local signing key + JWKS injected as the verifier (no network). Set up in a
// hook because top-level await isn't available under the CJS test transpile.
let privateKey: CryptoKey;
let SignJWTCtor: any;
before(async () => {
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await import("jose");
  SignJWTCtor = SignJWT;
  const kp = await generateKeyPair("RS256", { extractable: true });
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  __setJwksForTest(CONFIG.jwksUri, createLocalJWKSet({ keys: [jwk] }));
});

function mint(claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: string | number } = {}): Promise<string> {
  return new SignJWTCtor({ org_id: "tenant-a", scope: "telemetry:write records:read", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(privateKey);
}

const CLIENT_ID = "client-xyz";
function atHash(accessToken: string): string {
  const d = crypto.createHash("sha256").update(accessToken, "ascii").digest();
  return d.subarray(0, d.length / 2).toString("base64url");
}
function mintId(claims: Record<string, unknown> = {}, opts: { aud?: string } = {}): Promise<string> {
  return new SignJWTCtor({ sub: "user-1", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

test("verifyOidcIdToken accepts a valid id_token (aud=client, nonce, at_hash)", async () => {
  const access = await mint();
  const idToken = await mintId({ nonce: "n1", at_hash: atHash(access) });
  const payload = await verifyOidcIdToken(idToken, CONFIG, { audience: CLIENT_ID, nonce: "n1", accessToken: access });
  assert.equal(payload.sub, "user-1");
});

test("verifyOidcIdToken rejects wrong audience (not the client_id)", async () => {
  const idToken = await mintId({ nonce: "n1" }, { aud: "some-other-client" });
  await assert.rejects(() => verifyOidcIdToken(idToken, CONFIG, { audience: CLIENT_ID, nonce: "n1" }));
});

test("verifyOidcIdToken rejects nonce mismatch", async () => {
  const idToken = await mintId({ nonce: "n1" });
  await assert.rejects(() => verifyOidcIdToken(idToken, CONFIG, { audience: CLIENT_ID, nonce: "DIFFERENT" }), /nonce mismatch/);
});

test("verifyOidcIdToken allows a missing at_hash in the code flow (OIDC Core 3.1.3.6: optional)", async () => {
  const access = await mint();
  const idToken = await mintId({ nonce: "n1" }); // no at_hash — legal for code flow; some providers (Auth0/Entra) omit it
  const payload = await verifyOidcIdToken(idToken, CONFIG, { audience: CLIENT_ID, nonce: "n1", accessToken: access });
  assert.equal(payload.sub, "user-1");
});

test("verifyOidcIdToken rejects at_hash mismatch (access-token substitution)", async () => {
  const access = await mint();
  const other = await mint({ org_id: "attacker" });
  const idToken = await mintId({ nonce: "n1", at_hash: atHash(other) }); // bound to a different token
  await assert.rejects(() => verifyOidcIdToken(idToken, CONFIG, { audience: CLIENT_ID, nonce: "n1", accessToken: access }), /at_hash mismatch/);
});

test("verifyAccessToken accepts a valid token and resolves tenant + scopes", async () => {
  const result = await verifyAccessToken(await mint(), CONFIG);
  assert.equal(result.tenantId, "tenant-a");
  assert.deepEqual(result.scopes, ["telemetry:write", "records:read"]);
});

test("verifyAccessToken: a user token (sub, no client_id) is not a machine", async () => {
  const result = await verifyAccessToken(await mint({ sub: "user-42" }), CONFIG);
  assert.equal(result.isMachine, false);
  assert.equal(result.subject, "user-42");
  assert.equal(result.clientId, undefined);
  assert.equal(result.issuer, ISSUER);
});

test("verifyAccessToken: a client_id claim marks a machine (M2M) principal", async () => {
  const result = await verifyAccessToken(await mint({ client_id: "svc-eval-harness" }), CONFIG);
  assert.equal(result.isMachine, true);
  assert.equal(result.clientId, "svc-eval-harness");
});

test("verifyAccessToken: a `cid` claim is accepted as the client id (provider variant)", async () => {
  const result = await verifyAccessToken(await mint({ cid: "svc-ci" }), CONFIG);
  assert.equal(result.isMachine, true);
  assert.equal(result.clientId, "svc-ci");
});

test("verifyAccessToken rejects wrong audience (RFC 8707 binding)", async () => {
  const token = await mint({}, { aud: "https://someone-else.test" });
  await assert.rejects(() => verifyAccessToken(token, CONFIG));
});

test("verifyAccessToken rejects wrong issuer", async () => {
  const token = await mint({}, { iss: "https://evil.test" });
  await assert.rejects(() => verifyAccessToken(token, CONFIG));
});

test("verifyAccessToken rejects expired token", async () => {
  const token = await mint({}, { exp: Math.floor(Date.now() / 1000) - 60 });
  await assert.rejects(() => verifyAccessToken(token, CONFIG));
});

test("verifyAccessToken rejects token missing the tenant claim", async () => {
  const token = await mint({ org_id: undefined });
  await assert.rejects(() => verifyAccessToken(token, CONFIG), /missing a tenant claim/);
});

test("verifyAccessToken honors a custom tenant claim", async () => {
  const cfg = { ...CONFIG, tenantClaims: ["tenant"] };
  const result = await verifyAccessToken(await mint({ org_id: undefined, tenant: "tenant-z" }), cfg);
  assert.equal(result.tenantId, "tenant-z");
});

test("verifyAccessToken resolves tenant from an ordered claim list (user vs M2M)", async () => {
  const cfg = { ...CONFIG, tenantClaims: ["org_id", "tenant_id"] };
  // user token: org_id present
  assert.equal((await verifyAccessToken(await mint({ org_id: "tenant-u" }), cfg)).tenantId, "tenant-u");
  // M2M token: no org_id, tenant carried in tenant_id (the fallback claim)
  assert.equal((await verifyAccessToken(await mint({ org_id: undefined, tenant_id: "tenant-m" }), cfg)).tenantId, "tenant-m");
  // precedence: first present claim wins
  assert.equal((await verifyAccessToken(await mint({ org_id: "tenant-a", tenant_id: "tenant-b" }), cfg)).tenantId, "tenant-a");
  // neither present -> rejected
  const none = await mint({ org_id: undefined });
  await assert.rejects(() => verifyAccessToken(none, cfg), /missing a tenant claim/);
});

test("looksLikeJwt distinguishes JWTs from opaque tokens", () => {
  assert.equal(looksLikeJwt("aaa.bbb.ccc"), true);
  assert.equal(looksLikeJwt("opaque-random-token"), false);
  assert.equal(looksLikeJwt("two.parts"), false);
  assert.equal(looksLikeJwt("a..c"), false);
});

test("resolveOAuthConfig is off without env, parses + derives defaults with env", () => {
  assert.equal(resolveOAuthConfig({}), undefined);
  assert.equal(resolveOAuthConfig({ CONSOLE_OAUTH_ISSUER: ISSUER } as NodeJS.ProcessEnv), undefined); // audience required

  const cfg = resolveOAuthConfig({ CONSOLE_OAUTH_ISSUER: ISSUER + "/", CONSOLE_OAUTH_AUDIENCE: AUDIENCE } as NodeJS.ProcessEnv);
  assert.ok(cfg);
  assert.equal(cfg!.issuer, ISSUER + "/");
  assert.equal(cfg!.audience, AUDIENCE);
  assert.equal(cfg!.jwksUri, `${ISSUER}/.well-known/jwks.json`); // trailing slash trimmed in default
  assert.deepEqual(cfg!.tenantClaims, ["org_id"]);

  const explicit = resolveOAuthConfig({
    CONSOLE_OAUTH_ISSUER: ISSUER,
    CONSOLE_OAUTH_AUDIENCE: AUDIENCE,
    CONSOLE_OAUTH_JWKS_URI: "https://custom/jwks",
    CONSOLE_OAUTH_TENANT_CLAIM: "org_id, tenant_id" // comma-separated, trimmed → ordered list
  } as NodeJS.ProcessEnv);
  assert.equal(explicit!.jwksUri, "https://custom/jwks");
  assert.deepEqual(explicit!.tenantClaims, ["org_id", "tenant_id"]);
});

test("protectedResourceMetadata returns an RFC 9728 document", () => {
  const doc = protectedResourceMetadata(CONFIG);
  assert.equal(doc.resource, AUDIENCE);
  assert.deepEqual(doc.authorization_servers, [ISSUER]);
  assert.deepEqual(doc.bearer_methods_supported, ["header"]);
  const scopes = doc.scopes_supported as string[];
  assert.ok(Array.isArray(scopes));
  // Every scope the server enforces must be discoverable here (else clients
  // following RFC 9728 can never request it → silent 403). Phase 2a enforces these:
  for (const s of ["telemetry:read", "telemetry:write", "records:read", "records:write", "pricing:read"]) {
    assert.ok(scopes.includes(s), `scopes_supported missing ${s}`);
  }
});
