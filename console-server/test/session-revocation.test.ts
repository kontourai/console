import test from "node:test";
import assert from "node:assert/strict";
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
