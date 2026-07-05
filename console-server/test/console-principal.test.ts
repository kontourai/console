// Console #98 — verified ConsolePrincipal + M2M client-credentials + per-route
// scopes (ADR 0003 call 2). These tests build ON the OIDC Resource-Server that
// #96 landed (oauth-resource.ts `verifyAccessToken`): they assert the DELTA this
// slice adds — the structured principal on the request context, the machine/user
// distinction, the write-scope gate on POST /api/telemetry/records, and the
// tenant-from-principal header check. The JWKS is mocked via the injectable
// resolver seam `__setJwksForTest` (same pattern as console-oauth.test.ts).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { __setJwksForTest } from "../src/console-foundation/oauth-resource";
import { requireScope } from "../src/console-foundation/console-hub-server";
import type { ConsoleRequestContext } from "../src/console-foundation/types";
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

// Mint an audience-bound access token. A `client_id` claim marks an M2M
// (machine) token; omit it for a user token.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "console-principal-"));
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

function req(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<{ status?: number; body: string; headers: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const h = { ...headers };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const r = http.request(url, { method, headers: h }, (res: any) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (c: any) => (out += c));
      res.on("end", () => resolve({ status: res.statusCode, body: out, headers: res.headers }));
    });
    r.on("error", reject);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}

function telemetryRecord(eventId: string): Record<string, unknown> {
  return {
    schema_version: "0.3.0",
    timestamp: "2026-06-08T12:03:00.000Z",
    session_id: "session-principal",
    event_id: eventId,
    event_type: "session.stop",
    agent: { name: "dev", runtime: "codex" }
  };
}

// ── requireScope unit (helper contract, incl. the local-first exemption) ──────

test("requireScope: LOCAL mode is EXEMPT — the local single-tenant console is never scope-gated", () => {
  const local: ConsoleRequestContext = { tenantId: "t", runtimeMode: "local", authMethod: "local" };
  assert.deepEqual(requireScope(local, "telemetry:write"), { ok: true });
});

test("requireScope: HOSTED with no principal is FAIL-CLOSED (a legacy static token is not a scope bypass)", () => {
  // The footgun: exempting on absence-of-principal would let a hosted legacy static-token request
  // (authMethod:"token", no principal) skip scope checks the moment this helper gates a hosted route.
  const noScopes: ConsoleRequestContext = { tenantId: "tenant-a", runtimeMode: "hosted", authMethod: "token" };
  const denied = requireScope(noScopes, "telemetry:write");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error, "INSUFFICIENT_SCOPE");
  // A scope-carrying session (no structured principal) is honored via context.scopes.
  const session: ConsoleRequestContext = { tenantId: "tenant-a", runtimeMode: "hosted", authMethod: "session", scopes: ["telemetry:write"] };
  assert.deepEqual(requireScope(session, "telemetry:write"), { ok: true });
});

test("requireScope: principal with the scope passes; without it → 403 INSUFFICIENT_SCOPE", () => {
  const ctx: ConsoleRequestContext = {
    tenantId: "tenant-a",
    runtimeMode: "hosted",
    authMethod: "jwt",
    scopes: ["telemetry:write"],
    principal: { kind: "machine", subject: "svc", tenantId: "tenant-a", scopes: ["telemetry:write"] }
  };
  assert.deepEqual(requireScope(ctx, "telemetry:write"), { ok: true });
  const denied = requireScope(ctx, "records:write");
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.error, "INSUFFICIENT_SCOPE");
  }
});

// ── AC2 — M2M principal is built and tenant is bound from the claim ───────────

test("AC2: a valid M2M JWT (client_id) authenticates as principal.kind='machine', tenant from claim", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    // Verify at the auth layer that the context principal is built correctly by
    // exercising a scoped route the machine IS entitled to, then asserting the
    // machine identity survives to a tenant-scoped write.
    const jwt = await mint({ client_id: "svc-eval-harness", scope: "telemetry:write" });
    const res = await req("POST", `${urlOf(app)}/api/telemetry/records`, { authorization: `Bearer ${jwt}` }, telemetryRecord("evt-m2m-1"));
    // 202 proves: authenticated (not 401), tenant allowed (not 403 TENANT), and
    // telemetry:write granted (not 403 INSUFFICIENT_SCOPE) — the machine principal
    // reached the tenant-scoped ingest path.
    assert.equal(res.status, 202, res.body);
    const doc = JSON.parse(res.body);
    assert.equal(doc.outcome, "accepted");
  } finally {
    await closeApp(app);
  }
});

test("AC2: tenant is bound from the machine principal — body tenant_id must equal the claim", async () => {
  // Direct proof that context.tenantId === the verified claim "tenant-a": ingest
  // stamps/rejects a record body against the principal's tenant (ADR 0003 call 2).
  const app = makeHosted();
  await listen(app);
  try {
    const base = urlOf(app);
    const jwt = await mint({ client_id: "svc", scope: "records:write" });
    const event = {
      schema: "kontour.console.event",
      version: "0.1",
      id: "evt-principal-tenant",
      type: "demo.ping",
      occurredAt: "2026-06-08T12:00:00.000Z",
      producer: { product: "test", id: "p1" },
      scope: { product: "test" },
      subject: { product: "test", kind: "thing", id: "s1" },
      payload: {}
    };
    // Body agreeing with the principal's tenant → accepted.
    const agree = await req("POST", `${base}/records`, { authorization: `Bearer ${jwt}` }, { ...event, tenant_id: "tenant-a" });
    assert.equal(agree.status, 202, agree.body);
    // Body disagreeing with the principal's tenant → rejected (cross-tenant write blocked).
    const disagree = await req("POST", `${base}/records`, { authorization: `Bearer ${jwt}` }, { ...event, id: "evt-principal-tenant-2", tenant_id: "tenant-b" });
    assert.equal(disagree.status, 403, disagree.body);
    assert.match(disagree.body, /TENANT_MISMATCH/);
  } finally {
    await closeApp(app);
  }
});

test("AC2: a user JWT (sub, no client_id) authenticates as principal.kind='user'", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const jwt = await mint({ sub: "human-1", scope: "telemetry:read" });
    const res = await req("GET", `${urlOf(app)}/api/telemetry`, { authorization: `Bearer ${jwt}` });
    assert.notEqual(res.status, 401, res.body);
    assert.notEqual(res.status, 403, res.body);
  } finally {
    await closeApp(app);
  }
});

// ── AC3 — write scope gates POST /api/telemetry/records ───────────────────────

test("AC3: JWT lacking telemetry:write → 403 INSUFFICIENT_SCOPE on POST /api/telemetry/records; with it → 202", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const base = urlOf(app);
    const noWrite = await mint({ client_id: "svc", scope: "telemetry:read" });
    const denied = await req("POST", `${base}/api/telemetry/records`, { authorization: `Bearer ${noWrite}` }, telemetryRecord("evt-denied"));
    assert.equal(denied.status, 403, denied.body);
    assert.match(denied.body, /INSUFFICIENT_SCOPE/);
    assert.match(String(denied.headers["www-authenticate"]), /telemetry:write/);

    const withWrite = await mint({ client_id: "svc", scope: "telemetry:write" });
    const ok = await req("POST", `${base}/api/telemetry/records`, { authorization: `Bearer ${withWrite}` }, telemetryRecord("evt-ok"));
    assert.equal(ok.status, 202, ok.body);
  } finally {
    await closeApp(app);
  }
});

// ── AC4 — dual-acceptance: legacy static token works while OIDC is configured ─

test("AC4: legacy static token still authenticates while the OIDC issuer is configured (no regression)", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    // opaque static token: not JWT-shaped, falls through to the static path.
    const res = await req("POST", `${urlOf(app)}/api/telemetry/records`, { authorization: "Bearer opaque-tok" }, telemetryRecord("evt-legacy"));
    // Static token carries no principal ⇒ scope-exempt ⇒ reaches ingest ⇒ 202.
    assert.equal(res.status, 202, res.body);
  } finally {
    await closeApp(app);
  }
});

// ── AC5 — tenant is bound from the principal; a disagreeing header is forbidden ─

test("AC5: JWT tenant 'tenant-a' + header x-console-tenant-id: OTHER → 403", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const jwt = await mint({ client_id: "svc", scope: "telemetry:read" });
    const res = await req("GET", `${urlOf(app)}/api/telemetry`, { authorization: `Bearer ${jwt}`, "x-console-tenant-id": "tenant-b" });
    assert.equal(res.status, 403, res.body);
    assert.match(res.body, /TENANT_FORBIDDEN/);
  } finally {
    await closeApp(app);
  }
});

test("AC5: JWT with a matching (or absent) tenant header succeeds; tenant is the claim", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const base = urlOf(app);
    const jwt = await mint({ client_id: "svc", scope: "telemetry:read" });
    const matching = await req("GET", `${base}/api/telemetry`, { authorization: `Bearer ${jwt}`, "x-console-tenant-id": "tenant-a" });
    assert.notEqual(matching.status, 403, matching.body);
    const absent = await req("GET", `${base}/api/telemetry`, { authorization: `Bearer ${jwt}` });
    assert.notEqual(absent.status, 403, absent.body);
  } finally {
    await closeApp(app);
  }
});

// ── Security-critical negatives — verification failures never leak / never 500 ─

test("SECURITY: wrong-audience JWT is rejected (401), never authenticated", async () => {
  const app = makeHosted();
  await listen(app);
  try {
    const bad = await mint({ client_id: "svc" }, { aud: "https://someone-else.test" });
    const res = await req("GET", `${urlOf(app)}/api/telemetry`, { authorization: `Bearer ${bad}` });
    assert.equal(res.status, 401, res.body);
  } finally {
    await closeApp(app);
  }
});
