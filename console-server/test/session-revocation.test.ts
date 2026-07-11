import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  InMemoryRevocationStore,
  newSessionId,
  createRevocationStore
} from "../src/console-foundation/session-revocation";
const { signSessionCookie, verifySessionCookieValue } = require("../src/console-foundation/console-hub-server");

const cfg = (over: Record<string, unknown> = {}): any => ({
  mode: "hosted",
  allowedOrigins: [],
  defaultTenantId: "t",
  hostedTenantIds: ["t"],
  hostedAuthTokens: [{ token: "tok", tenantId: "t" }],
  sessionSecret: "session-secret-for-revocation-tests-0001",
  telemetryStorageAdapter: "postgres",
  validation: [],
  ...over
});

test("#104 newSessionId produces distinct, non-empty ids", () => {
  const a = newSessionId();
  const b = newSessionId();
  assert.ok(a && b && a !== b);
});

test("#104 session cookies carry a sid and each signing yields a fresh one", () => {
  const c = cfg();
  const cookieA = signSessionCookie("t", c);
  const cookieB = signSessionCookie("t", c);
  const a = verifySessionCookieValue(cookieA, c);
  const b = verifySessionCookieValue(cookieB, c);
  assert.equal(a?.tenantId, "t");
  assert.ok(a?.sid && b?.sid, "both carry a sid");
  assert.notEqual(a!.sid, b!.sid, "each session gets a distinct sid");
});

test("#104 InMemoryRevocationStore: revoke -> isRevoked; unknown -> not revoked", async () => {
  const store = new InMemoryRevocationStore();
  assert.equal(await store.isRevoked("sid-unknown"), false);
  await store.revoke("sid-1", "t", Date.now() + 60_000);
  assert.equal(await store.isRevoked("sid-1"), true);
  assert.equal(await store.isRevoked("sid-2"), false);
});

test("#104 InMemoryRevocationStore: an expired revocation is no longer revoked", async () => {
  const store = new InMemoryRevocationStore();
  await store.revoke("sid-x", "t", Date.now() - 1); // already expired
  assert.equal(await store.isRevoked("sid-x"), false);
});

test("#104 createRevocationStore defaults to in-memory when no SQL client", () => {
  const store = createRevocationStore(undefined);
  assert.ok(store instanceof InMemoryRevocationStore);
});

test("#104 SECURITY: pre-#104 cookies (no v2 marker) are rejected — no silent full-access upgrade", () => {
  const c = cfg();
  const secret = c.sessionSecret as string;
  const key = crypto.createHash("sha256").update(`console-session-secret-v1:${secret}`).digest();
  const tenantPart = Buffer.from("t", "utf8").toString("base64url");
  const ts = String(Date.now());
  // Pre-#104 SCOPED format: tenant.ts.scope.sig (4 parts) — this is the one that used to
  // collide with the new 4-part full-access shape and grant unscoped access. It MUST NOT verify.
  const scopePart = Buffer.from("telemetry:read", "utf8").toString("base64url");
  const oldScopedSig = crypto.createHmac("sha256", key).update(`${tenantPart}.${ts}.${scopePart}`).digest("hex");
  assert.equal(verifySessionCookieValue(`${tenantPart}.${ts}.${scopePart}.${oldScopedSig}`, c), null, "old scoped cookie must be rejected");
  // Pre-#104 full-access format: tenant.ts.sig (3 parts) — also rejected.
  const oldFullSig = crypto.createHmac("sha256", key).update(`${tenantPart}.${ts}`).digest("hex");
  assert.equal(verifySessionCookieValue(`${tenantPart}.${ts}.${oldFullSig}`, c), null, "old full-access cookie must be rejected");
  // A current v2 cookie still verifies (sanity).
  assert.equal(verifySessionCookieValue(signSessionCookie("t", c), c)?.tenantId, "t");
});
