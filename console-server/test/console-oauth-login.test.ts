import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { __setJwksForTest } from "../src/console-foundation/oauth-resource";
const { createConsoleHubServer } = require("../src/console-foundation");

const ISSUER = "https://as.login.test";
const AUDIENCE = "https://console.kontourai.io";
const JWKS_URI = "https://as.login.test/jwks";
const REDIRECT = "https://console.kontourai.io/auth/callback";
const AUTHZ = "https://as.login.test/authorize";
const TOKEN_EP = "https://as.login.test/token";
const LOGIN_ENV = {
  CONSOLE_OAUTH_ISSUER: ISSUER,
  CONSOLE_OAUTH_AUDIENCE: AUDIENCE,
  CONSOLE_OAUTH_JWKS_URI: JWKS_URI,
  CONSOLE_OAUTH_TENANT_CLAIM: "org_id",
  CONSOLE_OAUTH_CLIENT_ID: "client-1",
  CONSOLE_OAUTH_CLIENT_SECRET: "secret-1",
  CONSOLE_OAUTH_REDIRECT_URI: REDIRECT,
  CONSOLE_OAUTH_AUTHORIZATION_ENDPOINT: AUTHZ,
  CONSOLE_OAUTH_TOKEN_ENDPOINT: TOKEN_EP,
  CONSOLE_OAUTH_STATE_SECRET: "test-state-secret-0123456789abcdef0123456789abcdef"
};
const SAVED: Record<string, string | undefined> = {};
let privateKey: CryptoKey;
let SignJWTCtor: any;
const origFetch = globalThis.fetch;

before(async () => {
  for (const k of Object.keys(LOGIN_ENV)) { SAVED[k] = process.env[k]; (process.env as any)[k] = (LOGIN_ENV as any)[k]; }
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await import("jose");
  SignJWTCtor = SignJWT;
  const kp = await generateKeyPair("RS256", { extractable: true });
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = "k1"; jwk.alg = "RS256"; jwk.use = "sig";
  __setJwksForTest(JWKS_URI, createLocalJWKSet({ keys: [jwk] }));
});

after(() => {
  for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = v; }
  globalThis.fetch = origFetch;
});

function mintAccess(orgId: string): Promise<string> {
  return new SignJWTCtor({ org_id: orgId, scope: "telemetry:read" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
}
function atHash(accessToken: string, alg = "RS256"): string {
  const sha = alg.endsWith("384") ? "sha384" : alg.endsWith("512") ? "sha512" : "sha256";
  const d = crypto.createHash(sha).update(accessToken, "ascii").digest();
  return d.subarray(0, d.length / 2).toString("base64url");
}
function mintIdToken(nonce: string, accessToken: string, over: { aud?: string; nonce?: string; atHash?: string } = {}): Promise<string> {
  return new SignJWTCtor({ nonce: over.nonce ?? nonce, at_hash: over.atHash ?? atHash(accessToken) })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience(over.aud ?? "client-1")
    .setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
}
function stubTokenEndpoint(accessToken: string, idToken?: string) {
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ access_token: accessToken, id_token: idToken, token_type: "Bearer" }) })) as any;
}
async function startLogin(base: string): Promise<{ state: string; nonce: string; stateCookie: string }> {
  const login = await req("GET", `${base}/auth/login`);
  const loc = new URL(String(login.headers["location"]));
  return {
    state: loc.searchParams.get("state")!,
    nonce: loc.searchParams.get("nonce")!,
    stateCookie: cookieFrom(login.headers["set-cookie"], "console_oauth_state")!
  };
}

class FakeSql { async query(text: string) { return text.toLowerCase().includes("select 1") ? { rows: [{ ok: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 }; } }
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "console-login-"));
function makeHosted() {
  return createConsoleHubServer({
    rootDir: tempRoot(), port: 0, runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres", telemetryDatabaseUrl: "postgres://u:p@invalid/db",
    telemetrySqlClient: new FakeSql(), coreSqlClient: new FakeSql(),
    hostedTenantIds: ["tenant-a"], hostedAuthTokens: [{ token: "opaque-tok", tenantId: "tenant-a" }]
  });
}
const listen = (app: any) => new Promise((r: any) => app.listen({ port: 0 }, r));
const closeApp = (app: any) => new Promise((r: any, j: any) => app.close((e: any) => (e ? j(e) : r())));
const urlOf = (app: any) => `http://${app.server.address().address}:${app.server.address().port}`;
function req(method: string, url: string, headers: Record<string, string> = {}): Promise<{ status?: number; body: string; headers: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers }, (res: any) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (c: any) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    r.on("error", reject); r.end();
  });
}
const cookieFrom = (setCookie: any, name: string): string | undefined => {
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) { const m = String(c).match(new RegExp(`${name}=([^;]+)`)); if (m) return m[1]; }
  return undefined;
};

test("login: 302 to authorize endpoint with PKCE + state cookie", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const res = await req("GET", `${urlOf(app)}/auth/login`);
    assert.equal(res.status, 302);
    const loc = new URL(String(res.headers["location"]));
    assert.equal(loc.origin + loc.pathname, AUTHZ);
    assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
    assert.ok(loc.searchParams.get("code_challenge"));
    assert.ok(loc.searchParams.get("state"));
    assert.equal(loc.searchParams.get("resource"), AUDIENCE);
    assert.ok(cookieFrom(res.headers["set-cookie"], "console_oauth_state"), "state cookie set");
  } finally { await closeApp(app); }
});

test("login: 404 when login is not configured", async () => {
  const saved: Record<string, string | undefined> = {};
  for (const k of ["CONSOLE_OAUTH_CLIENT_ID", "CONSOLE_OAUTH_AUTHORIZATION_ENDPOINT", "CONSOLE_OAUTH_TOKEN_ENDPOINT", "CONSOLE_OAUTH_REDIRECT_URI"]) { saved[k] = process.env[k]; delete (process.env as any)[k]; }
  const app = makeHosted(); await listen(app);
  try {
    const res = await req("GET", `${urlOf(app)}/auth/login`);
    assert.equal(res.status, 404);
  } finally {
    await closeApp(app);
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) (process.env as any)[k] = v;
  }
});

test("callback: valid state + code issues a working session (round-trip)", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, nonce, stateCookie } = await startLogin(base);
    const access = await mintAccess("tenant-a");
    stubTokenEndpoint(access, await mintIdToken(nonce, access));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers["location"], "/");
    const session = cookieFrom(cb.headers["set-cookie"], "console_session");
    assert.ok(session, "session cookie issued");

    // The issued session must work through the real verify path.
    const check = await req("GET", `${base}/session`, { cookie: `console_session=${session}` });
    assert.equal(check.status, 200);
    assert.equal(JSON.parse(check.body).tenantId, "tenant-a");
  } finally { await closeApp(app); }
});

test("callback: OIDC session carries the token's scopes and is scope-enforced", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, nonce, stateCookie } = await startLogin(base);
    // access token granted only telemetry:read
    const access = await mintAccess("tenant-a");
    stubTokenEndpoint(access, await mintIdToken(nonce, access));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    const session = cookieFrom(cb.headers["set-cookie"], "console_session")!;
    // has telemetry:read -> allowed; lacks records:read -> 403 (NOT full access)
    const allowed = await req("GET", `${base}/api/telemetry`, { cookie: `console_session=${session}` });
    assert.notEqual(allowed.status, 403);
    const denied = await req("GET", `${base}/state`, { cookie: `console_session=${session}` });
    assert.equal(denied.status, 403);
    assert.match(denied.body, /INSUFFICIENT_SCOPE/);
  } finally { await closeApp(app); }
});

test("callback: missing state cookie → 400 (not a crash)", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const cb = await req("GET", `${urlOf(app)}/auth/callback?code=abc&state=xyz`); // no Cookie header
    assert.equal(cb.status, 400);
    assert.match(cb.body, /INVALID_STATE/);
  } finally { await closeApp(app); }
});

test("callback: missing code/state params → 400", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const cb = await req("GET", `${urlOf(app)}/auth/callback`);
    assert.equal(cb.status, 400);
    assert.match(cb.body, /INVALID_REQUEST/);
  } finally { await closeApp(app); }
});

test("callback: RFC 9207 issuer mismatch → 400", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const cb = await req("GET", `${urlOf(app)}/auth/callback?code=abc&state=xyz&iss=https://evil.test`);
    assert.equal(cb.status, 400);
    assert.match(cb.body, /INVALID_ISS/);
  } finally { await closeApp(app); }
});

test("callback: state mismatch → 400", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const login = await req("GET", `${base}/auth/login`);
    const stateCookie = cookieFrom(login.headers["set-cookie"], "console_oauth_state")!;
    stubTokenEndpoint(await mintAccess("tenant-a"));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=WRONG`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 400);
    assert.match(cb.body, /INVALID_STATE/);
  } finally { await closeApp(app); }
});

test("callback: tenant without a hosted token → 403", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, nonce, stateCookie } = await startLogin(base);
    const access = await mintAccess("tenant-x"); // not provisioned
    stubTokenEndpoint(access, await mintIdToken(nonce, access));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 403);
  } finally { await closeApp(app); }
});

test("callback: missing id_token (openid requested) → 401", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, stateCookie } = await startLogin(base);
    stubTokenEndpoint(await mintAccess("tenant-a")); // no id_token
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 401);
  } finally { await closeApp(app); }
});

test("callback: id_token nonce mismatch → 401", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, stateCookie } = await startLogin(base);
    const access = await mintAccess("tenant-a");
    stubTokenEndpoint(access, await mintIdToken("ignored", access, { nonce: "WRONG-NONCE" }));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 401);
  } finally { await closeApp(app); }
});

test("callback: id_token at_hash mismatch → 401 (access-token substitution blocked)", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, nonce, stateCookie } = await startLogin(base);
    const access = await mintAccess("tenant-a");
    // id_token's at_hash binds to a DIFFERENT access token than the one returned
    stubTokenEndpoint(access, await mintIdToken(nonce, access, { atHash: atHash(await mintAccess("attacker")) }));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 401);
  } finally { await closeApp(app); }
});

// #104: a dedicated session secret decouples session signing from per-tenant tokens,
// so OIDC sessions no longer require the tenant to have a hosted auth token.
function makeHostedSecret() {
  return createConsoleHubServer({
    rootDir: tempRoot(), port: 0, runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres", telemetryDatabaseUrl: "postgres://u:p@invalid/db",
    telemetrySqlClient: new FakeSql(), coreSqlClient: new FakeSql(),
    sessionSecret: "console-session-secret-test-0123456789abcdef",
    hostedTenantIds: ["tenant-a", "tenant-secret"],
    hostedAuthTokens: [{ token: "opaque-tok", tenantId: "tenant-a" }] // note: no token for tenant-secret
  });
}

test("#104 OIDC with session secret: tenant without a hosted token gets a working session", async () => {
  const app = makeHostedSecret(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, nonce, stateCookie } = await startLogin(base);
    const access = await mintAccess("tenant-secret"); // no hosted token for this tenant
    stubTokenEndpoint(access, await mintIdToken(nonce, access));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 302);
    const session = cookieFrom(cb.headers["set-cookie"], "console_session")!;
    assert.ok(session, "session issued without a hosted token");
    const check = await req("GET", `${base}/session`, { cookie: `console_session=${session}` });
    assert.equal(check.status, 200);
    assert.equal(JSON.parse(check.body).tenantId, "tenant-secret");
  } finally { await closeApp(app); }
});

test("#104 OIDC with session secret: tenant outside the allowlist is rejected (403)", async () => {
  const app = makeHostedSecret(); await listen(app);
  try {
    const base = urlOf(app);
    const { state, nonce, stateCookie } = await startLogin(base);
    const access = await mintAccess("tenant-unknown"); // not in hostedTenantIds
    stubTokenEndpoint(access, await mintIdToken(nonce, access));
    const cb = await req("GET", `${base}/auth/callback?code=abc&state=${encodeURIComponent(state)}`, { cookie: `console_oauth_state=${stateCookie}` });
    assert.equal(cb.status, 403);
  } finally { await closeApp(app); }
});
