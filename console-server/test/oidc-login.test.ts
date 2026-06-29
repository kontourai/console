import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  resolveOAuthLoginConfig,
  createPkce,
  buildAuthorizeRedirect,
  exchangeCodeForToken,
  signLoginState,
  verifyLoginState,
  isSecureOrLoopbackUrl,
  type ConsoleOAuthLoginConfig
} from "../src/console-foundation/oidc-login";
import type { ConsoleOAuthConfig } from "../src/console-foundation/oauth-resource";

const OAUTH: ConsoleOAuthConfig = { issuer: "https://as.test", audience: "https://console.test", jwksUri: "https://as.test/jwks", tenantClaims: ["org_id"] };
const LOGIN: ConsoleOAuthLoginConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://console.test/auth/callback",
  authorizationEndpoint: "https://as.test/authorize",
  tokenEndpoint: "https://as.test/token",
  scopes: ["openid", "profile"],
  stateSecret: "unit-test-state-secret"
};

test("createPkce produces a valid S256 verifier/challenge", () => {
  const { verifier, challenge } = createPkce();
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
  assert.ok(verifier.length >= 43);
});

test("buildAuthorizeRedirect sets code flow + PKCE + RFC 8707 resource", () => {
  const r = buildAuthorizeRedirect(LOGIN, OAUTH);
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, "https://as.test/authorize");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "client-1");
  assert.equal(u.searchParams.get("redirect_uri"), LOGIN.redirectUri);
  assert.equal(u.searchParams.get("scope"), "openid profile");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), r.state);
  assert.equal(u.searchParams.get("nonce"), r.nonce);
  assert.ok(r.nonce && r.nonce.length >= 16);
  assert.equal(u.searchParams.get("resource"), OAUTH.audience);
  assert.equal(u.searchParams.get("code_challenge"), crypto.createHash("sha256").update(r.codeVerifier).digest("base64url"));
});

test("resolveOAuthLoginConfig requires core fields + state secret, and parses scopes", () => {
  assert.equal(resolveOAuthLoginConfig({} as NodeJS.ProcessEnv), undefined);
  const core = {
    CONSOLE_OAUTH_CLIENT_ID: "c",
    CONSOLE_OAUTH_REDIRECT_URI: "https://x/cb",
    CONSOLE_OAUTH_AUTHORIZATION_ENDPOINT: "https://as/authorize",
    CONSOLE_OAUTH_TOKEN_ENDPOINT: "https://as/token",
    CONSOLE_OAUTH_CLIENT_SECRET: "s",
    CONSOLE_OAUTH_LOGIN_SCOPES: "openid, email profile"
  };
  // Missing state secret -> login stays disabled (fail-closed, no predictable fallback).
  assert.equal(resolveOAuthLoginConfig(core as NodeJS.ProcessEnv), undefined);
  const cfg = resolveOAuthLoginConfig({ ...core, CONSOLE_OAUTH_STATE_SECRET: "secret" } as NodeJS.ProcessEnv);
  assert.ok(cfg);
  assert.deepEqual(cfg!.scopes, ["openid", "email", "profile"]);
  assert.equal(cfg!.clientSecret, "s");
  assert.equal(cfg!.stateSecret, "secret");
});

test("isSecureOrLoopbackUrl: https ok, http loopback ok, other http rejected", () => {
  assert.equal(isSecureOrLoopbackUrl("https://as.example/authorize"), true);
  assert.equal(isSecureOrLoopbackUrl("http://localhost:9999/authorize"), true);
  assert.equal(isSecureOrLoopbackUrl("http://127.0.0.1/token"), true);
  assert.equal(isSecureOrLoopbackUrl("http://as.example/authorize"), false);
  assert.equal(isSecureOrLoopbackUrl("not-a-url"), false);
});

test("exchangeCodeForToken posts the code-grant body and returns tokens", async () => {
  let captured: { url?: string; body?: string } = {};
  const fakeFetch = async (url: string, init: Record<string, unknown>) => {
    captured = { url, body: init.body as string };
    return { ok: true, status: 200, json: async () => ({ access_token: "AT", token_type: "Bearer" }) };
  };
  const tok = await exchangeCodeForToken(LOGIN, "the-code", "the-verifier", OAUTH, fakeFetch);
  assert.equal(tok.access_token, "AT");
  assert.equal(captured.url, LOGIN.tokenEndpoint);
  const body = new URLSearchParams(captured.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "the-code");
  assert.equal(body.get("code_verifier"), "the-verifier");
  assert.equal(body.get("client_id"), "client-1");
  assert.equal(body.get("client_secret"), "secret-1");
  assert.equal(body.get("resource"), OAUTH.audience);
});

test("exchangeCodeForToken throws on non-ok and on missing access_token", async () => {
  await assert.rejects(() => exchangeCodeForToken(LOGIN, "c", "v", OAUTH, async () => ({ ok: false, status: 400, json: async () => ({}) })));
  await assert.rejects(() => exchangeCodeForToken(LOGIN, "c", "v", OAUTH, async () => ({ ok: true, status: 200, json: async () => ({}) })));
});

test("signLoginState/verifyLoginState round-trips and rejects tamper + expiry + wrong secret", () => {
  const secret = "secret-key";
  const now = 1_000_000;
  const cookie = signLoginState("state-1", "verifier-1", "nonce-1", secret, now);
  assert.deepEqual(verifyLoginState(cookie, secret, now + 1000), { state: "state-1", codeVerifier: "verifier-1", nonce: "nonce-1" });
  assert.equal(verifyLoginState(cookie, "other-secret", now + 1000), null);
  assert.equal(verifyLoginState("x" + cookie, secret, now + 1000), null);
  assert.equal(verifyLoginState(cookie, secret, now + 10_000_000), null); // expired (>10m default ttl)
});
