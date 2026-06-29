import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { __setJwksForTest } from "../src/console-foundation/oauth-resource";
const { createConsoleHubServer } = require("../src/console-foundation");

const ISSUER = "https://auth.console.test";
const AUDIENCE = "https://console.kontourai.io";
const JWKS_URI = "https://auth.console.test/jwks";
const SAVED: Record<string, string | undefined> = {};
let privateKey: CryptoKey;
let SignJWTCtor: any;

before(async () => {
  for (const k of ["CONSOLE_OAUTH_ISSUER", "CONSOLE_OAUTH_AUDIENCE", "CONSOLE_OAUTH_JWKS_URI", "CONSOLE_OAUTH_TENANT_CLAIM"]) SAVED[k] = process.env[k];
  process.env.CONSOLE_OAUTH_ISSUER = ISSUER;
  process.env.CONSOLE_OAUTH_AUDIENCE = AUDIENCE;
  process.env.CONSOLE_OAUTH_JWKS_URI = JWKS_URI;
  process.env.CONSOLE_OAUTH_TENANT_CLAIM = "org_id";
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await import("jose");
  SignJWTCtor = SignJWT;
  const kp = await generateKeyPair("RS256", { extractable: true });
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  __setJwksForTest(JWKS_URI, createLocalJWKSet({ keys: [jwk] }));
});

after(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function mint(claims: Record<string, unknown> = {}, opts: { aud?: string } = {}): Promise<string> {
  return new SignJWTCtor({ org_id: "tenant-a", scope: "telemetry:read", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

class FakeSql {
  async query(text: string) {
    const n = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (n.startsWith("select 1")) return { rows: [{ ok: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "console-oauth-"));
}
function makeHosted() {
  return createConsoleHubServer({
    rootDir: tempRoot(),
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://user:pass@example.invalid/console",
    telemetrySqlClient: new FakeSql(),
    coreSqlClient: new FakeSql(),
    hostedTenantIds: ["tenant-a"],
    hostedAuthTokens: [{ token: "opaque-tok", tenantId: "tenant-a" }]
  });
}
const listen = (app: any) => new Promise((r: any) => app.listen({ port: 0 }, r));
const closeApp = (app: any) => new Promise((r: any, j: any) => app.close((e: any) => (e ? j(e) : r())));
const urlOf = (app: any) => `http://${app.server.address().address}:${app.server.address().port}`;
function req(method: string, url: string, headers: Record<string, string> = {}): Promise<{ status?: number; body: string; headers: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers }, (res: any) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: any) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
}

test("PRM: serves RFC 9728 metadata when OIDC is configured", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const res = await req("GET", `${urlOf(app)}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 200);
    const doc = JSON.parse(res.body);
    assert.equal(doc.resource, AUDIENCE);
    assert.deepEqual(doc.authorization_servers, [ISSUER]);
  } finally {
    await closeApp(app);
  }
});

test("JWT path: valid OIDC JWT authenticates; opaque token still works (dual-accept)", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const base = urlOf(app);
    const jwt = await mint();
    const viaJwt = await req("GET", `${base}/api/telemetry`, { authorization: `Bearer ${jwt}` });
    const viaOpaque = await req("GET", `${base}/api/telemetry`, { authorization: "Bearer opaque-tok" });
    // Both authenticate (would be 401/403 if rejected).
    assert.notEqual(viaJwt.status, 401, `jwt rejected: ${viaJwt.body}`);
    assert.notEqual(viaJwt.status, 403, `jwt forbidden: ${viaJwt.body}`);
    assert.notEqual(viaOpaque.status, 401);
    assert.notEqual(viaOpaque.status, 403);
  } finally {
    await closeApp(app);
  }
});

test("JWT path: wrong-audience token is rejected (401)", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const bad = await mint({}, { aud: "https://someone-else.test" });
    const res = await req("GET", `${urlOf(app)}/api/telemetry`, { authorization: `Bearer ${bad}` });
    assert.equal(res.status, 401);
  } finally {
    await closeApp(app);
  }
});

test("JWT path: tenant header mismatch is forbidden (403)", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const jwt = await mint();
    const res = await req("GET", `${urlOf(app)}/api/telemetry`, { authorization: `Bearer ${jwt}`, "x-console-tenant-id": "tenant-b" });
    assert.equal(res.status, 403);
  } finally {
    await closeApp(app);
  }
});

test("scope: JWT allowed with the required scope; rejected (403 + WWW-Authenticate) without it", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const base = urlOf(app);
    const ok = await req("GET", `${base}/api/telemetry`, { authorization: `Bearer ${await mint({ scope: "telemetry:read" })}` });
    assert.notEqual(ok.status, 403);

    const denied = await req("GET", `${base}/api/telemetry`, { authorization: `Bearer ${await mint({ scope: "pricing:read" })}` });
    assert.equal(denied.status, 403);
    assert.match(denied.body, /INSUFFICIENT_SCOPE/);
    assert.match(String(denied.headers["www-authenticate"]), /insufficient_scope/);
    assert.match(String(denied.headers["www-authenticate"]), /telemetry:read/);
  } finally {
    await closeApp(app);
  }
});

test("scope: legacy opaque token is not scope-gated (back-compat)", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    // opaque token carries no scopes; legacy auth must still reach the route.
    const res = await req("GET", `${urlOf(app)}/api/telemetry`, { authorization: "Bearer opaque-tok" });
    assert.notEqual(res.status, 403);
  } finally {
    await closeApp(app);
  }
});

test("PRM: 404 when OIDC is not configured", async () => {
  const saved = { i: process.env.CONSOLE_OAUTH_ISSUER, a: process.env.CONSOLE_OAUTH_AUDIENCE };
  delete process.env.CONSOLE_OAUTH_ISSUER;
  delete process.env.CONSOLE_OAUTH_AUDIENCE;
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0 });
  await listen(app);
  try {
    const res = await req("GET", `${urlOf(app)}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 404);
  } finally {
    await closeApp(app);
    process.env.CONSOLE_OAUTH_ISSUER = saved.i;
    process.env.CONSOLE_OAUTH_AUDIENCE = saved.a;
  }
});
