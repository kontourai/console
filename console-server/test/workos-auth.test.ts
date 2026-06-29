import test, { before } from "node:test";
import assert from "node:assert/strict";
import {
  resolveWorkosConfig,
  looksLikeJwt,
  verifyWorkosToken,
  protectedResourceMetadata,
  __setWorkosJwksForTest,
  type ConsoleWorkosConfig
} from "../src/console-foundation/workos-auth";

const ISSUER = "https://auth.console.test";
const AUDIENCE = "https://console.kontourai.io";
const CONFIG: ConsoleWorkosConfig = { issuer: ISSUER, audience: AUDIENCE, jwksUri: "https://auth.console.test/jwks", tenantClaim: "org_id" };

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
  __setWorkosJwksForTest(CONFIG.jwksUri, createLocalJWKSet({ keys: [jwk] }));
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

test("verifyWorkosToken accepts a valid token and resolves tenant + scopes", async () => {
  const result = await verifyWorkosToken(await mint(), CONFIG);
  assert.equal(result.tenantId, "tenant-a");
  assert.deepEqual(result.scopes, ["telemetry:write", "records:read"]);
});

test("verifyWorkosToken rejects wrong audience (RFC 8707 binding)", async () => {
  const token = await mint({}, { aud: "https://someone-else.test" });
  await assert.rejects(() => verifyWorkosToken(token, CONFIG));
});

test("verifyWorkosToken rejects wrong issuer", async () => {
  const token = await mint({}, { iss: "https://evil.test" });
  await assert.rejects(() => verifyWorkosToken(token, CONFIG));
});

test("verifyWorkosToken rejects expired token", async () => {
  const token = await mint({}, { exp: Math.floor(Date.now() / 1000) - 60 });
  await assert.rejects(() => verifyWorkosToken(token, CONFIG));
});

test("verifyWorkosToken rejects token missing the tenant claim", async () => {
  const token = await mint({ org_id: undefined });
  await assert.rejects(() => verifyWorkosToken(token, CONFIG), /missing tenant claim/);
});

test("verifyWorkosToken honors a custom tenant claim", async () => {
  const cfg = { ...CONFIG, tenantClaim: "tenant" };
  const result = await verifyWorkosToken(await mint({ org_id: undefined, tenant: "tenant-z" }), cfg);
  assert.equal(result.tenantId, "tenant-z");
});

test("looksLikeJwt distinguishes JWTs from opaque tokens", () => {
  assert.equal(looksLikeJwt("aaa.bbb.ccc"), true);
  assert.equal(looksLikeJwt("opaque-random-token"), false);
  assert.equal(looksLikeJwt("two.parts"), false);
  assert.equal(looksLikeJwt("a..c"), false);
});

test("resolveWorkosConfig is off without env, parses + derives defaults with env", () => {
  assert.equal(resolveWorkosConfig({}), undefined);
  assert.equal(resolveWorkosConfig({ CONSOLE_WORKOS_ISSUER: ISSUER } as NodeJS.ProcessEnv), undefined); // audience required

  const cfg = resolveWorkosConfig({ CONSOLE_WORKOS_ISSUER: ISSUER + "/", CONSOLE_WORKOS_AUDIENCE: AUDIENCE } as NodeJS.ProcessEnv);
  assert.ok(cfg);
  assert.equal(cfg!.issuer, ISSUER + "/");
  assert.equal(cfg!.audience, AUDIENCE);
  assert.equal(cfg!.jwksUri, `${ISSUER}/.well-known/jwks.json`); // trailing slash trimmed in default
  assert.equal(cfg!.tenantClaim, "org_id");

  const explicit = resolveWorkosConfig({
    CONSOLE_WORKOS_ISSUER: ISSUER,
    CONSOLE_WORKOS_AUDIENCE: AUDIENCE,
    CONSOLE_WORKOS_JWKS_URI: "https://custom/jwks",
    CONSOLE_WORKOS_TENANT_CLAIM: "tenant"
  } as NodeJS.ProcessEnv);
  assert.equal(explicit!.jwksUri, "https://custom/jwks");
  assert.equal(explicit!.tenantClaim, "tenant");
});

test("protectedResourceMetadata returns an RFC 9728 document", () => {
  const doc = protectedResourceMetadata(CONFIG);
  assert.equal(doc.resource, AUDIENCE);
  assert.deepEqual(doc.authorization_servers, [ISSUER]);
  assert.deepEqual(doc.bearer_methods_supported, ["header"]);
  assert.ok(Array.isArray(doc.scopes_supported));
});
