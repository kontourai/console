import test from "node:test";
import assert from "node:assert/strict";
const { signSessionCookie, verifySessionCookieValue } = require("../src/console-foundation/console-hub-server");

const cfg = (over: Record<string, unknown> = {}): any => ({
  mode: "hosted",
  allowedOrigins: [],
  defaultTenantId: "t",
  hostedTenantIds: ["t"],
  hostedAuthTokens: [{ token: "tok-v1", tenantId: "t" }],
  telemetryStorageAdapter: "postgres",
  validation: [],
  ...over
});

test("#104 session secret: sign/verify works and is DECOUPLED from the tenant token", () => {
  const withSecret = cfg({ sessionSecret: "super-secret-key" });
  const cookie = signSessionCookie("t", withSecret);
  assert.equal(verifySessionCookieValue(cookie, withSecret)?.tenantId, "t");

  // Rotating the tenant's hosted auth token must NOT invalidate the session.
  const rotated = cfg({ sessionSecret: "super-secret-key", hostedAuthTokens: [{ token: "tok-v2", tenantId: "t" }] });
  assert.equal(verifySessionCookieValue(cookie, rotated)?.tenantId, "t", "session survives token rotation");

  // Changing the session secret IS the way to invalidate (the secret is the key).
  const otherSecret = cfg({ sessionSecret: "different-secret" });
  assert.equal(verifySessionCookieValue(cookie, otherSecret), null);
});

test("#104 session secret: a tenant with NO hosted token can hold a session", () => {
  const noToken = cfg({ sessionSecret: "S", hostedAuthTokens: [] });
  const cookie = signSessionCookie("t", noToken);
  assert.equal(verifySessionCookieValue(cookie, noToken)?.tenantId, "t");
});

test("#104 without a session secret: falls back to the per-token key (back-compat, coupled)", () => {
  const perToken = cfg(); // no sessionSecret
  const cookie = signSessionCookie("t", perToken);
  assert.equal(verifySessionCookieValue(cookie, perToken)?.tenantId, "t");
  // Coupled: rotating the token invalidates the session (the old, documented behavior).
  const rotated = cfg({ hostedAuthTokens: [{ token: "tok-v2", tenantId: "t" }] });
  assert.equal(verifySessionCookieValue(cookie, rotated), null);
});

test("#104 signSessionCookie throws when no key source is available", () => {
  const none = cfg({ hostedAuthTokens: [] }); // no secret, no token
  assert.throws(() => signSessionCookie("t", none), /no session signing key/);
});

test("#104 scoped (OIDC) sessions still carry scopes under the session secret", () => {
  const withSecret = cfg({ sessionSecret: "S" });
  const cookie = signSessionCookie("t", withSecret, ["telemetry:read"]);
  const result = verifySessionCookieValue(cookie, withSecret);
  assert.equal(result?.tenantId, "t");
  assert.deepEqual(result?.scopes, ["telemetry:read"]);
  assert.ok(result?.sid && typeof result.sid === "string", "carries a session id (#104)");
});
