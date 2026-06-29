// Vendor-neutral OIDC Authorization-Code + PKCE login for the console UI
// (ADR 0003, Phase 2c). Config-gated and provider-agnostic: it drives the
// standard OIDC code flow against any AS (WorkOS AuthKit, Auth0, Zitadel, …)
// whose endpoints come from configuration / discovery. Inert unless the login
// env (CONSOLE_OAUTH_CLIENT_ID + redirect + endpoints) is set.
import crypto from "node:crypto";
import type { ConsoleOAuthConfig } from "./oauth-resource";

export interface ConsoleOAuthLoginConfig {
  clientId: string;
  /** Confidential-client secret; "" for public clients (PKCE-only). */
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Scopes requested at login (space/comma separated in env). */
  scopes: string[];
}

/** Build login config from env, or undefined when not configured (login route 404s). */
export function resolveOAuthLoginConfig(env: NodeJS.ProcessEnv): ConsoleOAuthLoginConfig | undefined {
  const clientId = env.CONSOLE_OAUTH_CLIENT_ID?.trim();
  const redirectUri = env.CONSOLE_OAUTH_REDIRECT_URI?.trim();
  const authorizationEndpoint = env.CONSOLE_OAUTH_AUTHORIZATION_ENDPOINT?.trim();
  const tokenEndpoint = env.CONSOLE_OAUTH_TOKEN_ENDPOINT?.trim();
  if (!clientId || !redirectUri || !authorizationEndpoint || !tokenEndpoint) return undefined;
  const clientSecret = env.CONSOLE_OAUTH_CLIENT_SECRET?.trim() || "";
  const scopes = (env.CONSOLE_OAUTH_LOGIN_SCOPES?.trim() || "openid profile email")
    .split(/[\s,]+/).filter(Boolean);
  return { clientId, clientSecret, redirectUri, authorizationEndpoint, tokenEndpoint, scopes };
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

/** PKCE (RFC 7636) S256 verifier + challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export interface AuthorizeRedirect {
  url: string;
  state: string;
  codeVerifier: string;
}

/** Build the authorization-endpoint redirect (code flow + PKCE + RFC 8707 resource). */
export function buildAuthorizeRedirect(login: ConsoleOAuthLoginConfig, oauth: ConsoleOAuthConfig): AuthorizeRedirect {
  const state = b64url(crypto.randomBytes(16));
  const { verifier, challenge } = createPkce();
  const url = new URL(login.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", login.clientId);
  url.searchParams.set("redirect_uri", login.redirectUri);
  url.searchParams.set("scope", login.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", oauth.audience); // RFC 8707 audience binding
  return { url: url.toString(), state, codeVerifier: verifier };
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface OidcTokenResponse {
  access_token: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

/** Exchange an authorization code for tokens at the token endpoint. fetchImpl is
 *  injectable for tests. */
export async function exchangeCodeForToken(
  login: ConsoleOAuthLoginConfig,
  code: string,
  codeVerifier: string,
  oauth: ConsoleOAuthConfig,
  fetchImpl?: FetchLike
): Promise<OidcTokenResponse> {
  const doFetch = (fetchImpl || (globalThis.fetch as unknown as FetchLike));
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: login.redirectUri,
    client_id: login.clientId,
    code_verifier: codeVerifier,
    resource: oauth.audience
  });
  if (login.clientSecret) body.set("client_secret", login.clientSecret);
  const res = await doFetch(login.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString()
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const json = await res.json();
  if (!json || typeof json.access_token !== "string") throw new Error("token exchange returned no access_token");
  return json as OidcTokenResponse;
}

// --- signed, short-lived state cookie (state + PKCE verifier across the redirect) ---

interface LoginState { state: string; codeVerifier: string; exp: number }

/** Sign {state, codeVerifier} into an opaque cookie value (HMAC-SHA256). */
export function signLoginState(state: string, codeVerifier: string, secret: string, nowMs: number, ttlMs = 600_000): string {
  const payload: LoginState = { state, codeVerifier, exp: nowMs + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${mac}`;
}

/** Verify + decode the state cookie. Returns null if tampered or expired. */
export function verifyLoginState(cookieValue: string, secret: string, nowMs: number): { state: string; codeVerifier: string } | null {
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LoginState;
    if (!parsed || typeof parsed.state !== "string" || typeof parsed.codeVerifier !== "string") return null;
    if (typeof parsed.exp !== "number" || parsed.exp < nowMs) return null;
    return { state: parsed.state, codeVerifier: parsed.codeVerifier };
  } catch {
    return null;
  }
}
