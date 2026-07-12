import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { __setJwksForTest } from "../src/console-foundation/oauth-resource";
const { createConsoleHubServer } = require("../src/console-foundation");

const ISSUER = "https://as.mcp.test";
const AUDIENCE = "https://console.kontourai.io";
const JWKS_URI = "https://as.mcp.test/jwks";
const ENV = { CONSOLE_OAUTH_ISSUER: ISSUER, CONSOLE_OAUTH_AUDIENCE: AUDIENCE, CONSOLE_OAUTH_JWKS_URI: JWKS_URI, CONSOLE_OAUTH_TENANT_CLAIM: "org_id" };
const SAVED: Record<string, string | undefined> = {};
let privateKey: CryptoKey;
let SignJWTCtor: any;

before(async () => {
  for (const k of Object.keys(ENV)) { SAVED[k] = process.env[k]; (process.env as any)[k] = (ENV as any)[k]; }
  const { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } = await import("jose");
  SignJWTCtor = SignJWT;
  const kp = await generateKeyPair("RS256", { extractable: true });
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = "k1"; jwk.alg = "RS256"; jwk.use = "sig";
  __setJwksForTest(JWKS_URI, createLocalJWKSet({ keys: [jwk] }));
});
after(() => { for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = v; } });

function mint(scope: string): Promise<string> {
  return new SignJWTCtor({ org_id: "tenant-a", scope })
    .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
}
class FakeSql { async query(text: string) { return text.toLowerCase().includes("select 1") ? { rows: [{ ok: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 }; } }
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "console-mcp-"));
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
function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status?: number; body: string }> {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers } }, (res: any) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c: any) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    r.on("error", reject); r.write(data); r.end();
  });
}

test("POST /mcp with telemetry:read: initialize + tools/list + tools/call work", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const base = urlOf(app);
    const auth = { authorization: `Bearer ${await mint("telemetry:read")}` };

    const init = await post(`${base}/mcp`, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, auth);
    assert.equal(init.status, 200);
    assert.ok(JSON.parse(init.body).result.protocolVersion);

    const list = await post(`${base}/mcp`, { jsonrpc: "2.0", id: 2, method: "tools/list" }, auth);
    assert.ok(JSON.parse(list.body).result.tools.some((t: any) => t.name === "get_usage_summary"));

    const call = await post(`${base}/mcp`, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_usage_summary", arguments: {} } }, auth);
    assert.equal(call.status, 200);
    const result = JSON.parse(call.body).result;
    assert.equal(result.isError, false);
    const payload = JSON.parse(result.content[0].text);
    assert.ok("analytics" in payload && "totals" in payload);
  } finally { await closeApp(app); }
});

test("POST /mcp without telemetry:read scope -> 403", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const res = await post(`${urlOf(app)}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${await mint("records:read")}` });
    assert.equal(res.status, 403);
    assert.match(res.body, /INSUFFICIENT_SCOPE/);
  } finally { await closeApp(app); }
});

test("POST /mcp without auth -> 401", async () => {
  const app = makeHosted(); await listen(app);
  try {
    const res = await post(`${urlOf(app)}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(res.status, 401);
  } finally { await closeApp(app); }
});
