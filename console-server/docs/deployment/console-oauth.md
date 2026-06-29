# Console OAuth / OIDC deployment runbook

How to turn on the console's OAuth 2.1 / OIDC auth (ADR 0003). Everything here is
**config-gated**: with none of these env vars set, the console behaves exactly as
before (opaque bearer tokens + signed session cookies). It is **vendor-neutral** —
point it at any OIDC-compliant provider (WorkOS, Auth0/Okta, Zitadel, Keycloak,
Ory Hydra, Cognito); WorkOS is the recommendation but not a dependency.

## Environment variables

### Resource Server (Phase 1–2: accept JWTs, scopes, discovery)

| Var | Required | Example | Notes |
|---|---|---|---|
| `CONSOLE_OAUTH_ISSUER` | to enable JWT auth | `https://your-tenant.authkit.app` | Token `iss`; also the AS in PRM |
| `CONSOLE_OAUTH_AUDIENCE` | to enable JWT auth | `https://console.kontourai.io` | Token `aud` (RFC 8707) + PRM `resource` |
| `CONSOLE_OAUTH_JWKS_URI` | optional | `…/.well-known/jwks.json` | Defaults to `${issuer}/.well-known/jwks.json`; set explicitly if your provider differs (WorkOS uses a per-client JWKS URL) |
| `CONSOLE_OAUTH_TENANT_CLAIM` | optional | `org_id,tenant_id` | Ordered, comma-separated; first present wins. User tokens often use `org_id`; M2M tokens may use a custom claim. Default `org_id` |

Setting `CONSOLE_OAUTH_ISSUER` + `CONSOLE_OAUTH_AUDIENCE` activates: JWT verification
(dual-accept alongside opaque tokens), per-route **scope** enforcement for JWT clients,
and `GET /.well-known/oauth-protected-resource` (RFC 9728).

### Login (Phase 2c: OIDC Authorization-Code + PKCE for the console UI)

| Var | Required | Example |
|---|---|---|
| `CONSOLE_OAUTH_CLIENT_ID` | to enable login | `client_01H…` |
| `CONSOLE_OAUTH_CLIENT_SECRET` | confidential clients | `sk_…` (omit for public/PKCE-only) |
| `CONSOLE_OAUTH_REDIRECT_URI` | to enable login | `https://console.kontourai.io/auth/callback` |
| `CONSOLE_OAUTH_AUTHORIZATION_ENDPOINT` | to enable login | `${issuer}/oauth2/authorize` (from the provider's `/.well-known/openid-configuration`) |
| `CONSOLE_OAUTH_TOKEN_ENDPOINT` | to enable login | `${issuer}/oauth2/token` |
| `CONSOLE_OAUTH_STATE_SECRET` | **required for login** | 32+ random bytes (e.g. `openssl rand -base64 32`) |
| `CONSOLE_OAUTH_LOGIN_SCOPES` | optional | `openid profile email` (default) |

Setting all of CLIENT_ID + REDIRECT_URI + AUTHORIZATION_ENDPOINT + TOKEN_ENDPOINT +
**STATE_SECRET** activates `GET /auth/login` and `GET /auth/callback`. Get the endpoint
URLs from the provider's OIDC discovery document. Login stays disabled (and config
validation warns) if `CONSOLE_OAUTH_STATE_SECRET` is missing — it is a dedicated,
high-entropy HMAC key for the login-state cookie and is never derived from auth tokens.
Authorization/token endpoints must be **https** (http allowed only for localhost in dev).

> **Login token validation.** When `openid` is in `CONSOLE_OAUTH_LOGIN_SCOPES` (the
> default), the callback validates the **`id_token`** as the authentication assertion
> (OIDC Core): JWKS signature, `iss`, `aud = CONSOLE_OAUTH_CLIENT_ID`, `exp`, the
> **`nonce`** we issued, and the **`at_hash`** binding to the access token (blocks
> access-token substitution). It then verifies the **access token** (signature via JWKS,
> `iss`, audience-bound `aud` per RFC 8707, `exp`) and reads the tenant claim from it —
> the console acts as a combined Relying Party + Resource Server. Configure the provider
> to mint **JWT** access tokens with `aud = CONSOLE_OAUTH_AUDIENCE`; an opaque access
> token fails login with a logged 401.

## MCP server (Phase 3)

When OAuth is configured, the console serves an authenticated **MCP server** at
`POST /mcp` (JSON-RPC 2.0) behind the Resource-Server auth, requiring the
`telemetry:read` scope. MCP clients present a `Bearer <jwt>` and can call:

- `get_usage_summary` — tenant-scoped token-usage + estimated-cost analytics
  (totals + breakdowns by model / project / agent / runtime).

Discovery is via the RFC 9728 metadata at `/.well-known/oauth-protected-resource`.
Standard methods: `initialize`, `tools/list`, `tools/call`, `ping`. Tools are
tenant-isolated through the authenticated request context.

## Scopes the console enforces

Advertised in the RFC 9728 metadata and enforced for JWT clients (legacy opaque/session
tokens are not scope-gated):

`telemetry:read`, `telemetry:write`, `records:read`, `records:write`, `pricing:read`

## Setup with WorkOS (recommended)

1. Create a free WorkOS account; create an **AuthKit** application.
2. Add `https://console.kontourai.io/auth/callback` as a redirect URI.
3. Copy the Client ID + API key (client secret) and the AuthKit domain (the issuer).
4. From `${issuer}/.well-known/openid-configuration`, copy `authorization_endpoint`,
   `token_endpoint`, and `jwks_uri`.
5. Set `CONSOLE_OAUTH_AUDIENCE` to the console's canonical URL and configure WorkOS to
   mint access tokens with that audience.
6. Set the env vars above; deploy. Visit `/auth/login` to verify the round-trip; check
   `/.well-known/oauth-protected-resource` returns the metadata.

## Machine-to-machine (agents / CI posting telemetry)

- Create an M2M client (client-credentials) in the provider, granted `telemetry:write`.
- Ensure its tokens carry the tenant in one of `CONSOLE_OAUTH_TENANT_CLAIM`'s claims and
  `aud` = `CONSOLE_OAUTH_AUDIENCE`.
- Posters present `Authorization: Bearer <jwt>`; the console scopes + tenant-isolates them.

## Migration (opaque tokens → OAuth), cutover-safe

1. Deploy with `CONSOLE_OAUTH_*` set — JWTs are accepted **alongside** existing opaque
   `hostedAuthTokens` and session cookies (no break).
2. Move human login to `/auth/login`; move agents/CI to M2M client-credential JWTs.
3. Once all posters use JWTs, remove the static `hostedAuthTokens` (and unset
   `CONSOLE_AUTH_TOKENS_JSON`). Rollback = restore them / unset `CONSOLE_OAUTH_*`.

> Note: OIDC-issued UI sessions currently reuse the existing signed session cookie and
> therefore require the resolved tenant to have a provisioned `hostedAuthToken` (the
> session signing anchor). Keep at least one hosted token per tenant until a dedicated
> session secret is introduced.

## Production checklist

- Serve over HTTPS (cookies are `Secure`); terminate TLS at the edge.
- Set `CONSOLE_ALLOWED_ORIGINS` for the console UI origin(s).
- Confirm `aud` binding: the provider must mint access tokens scoped to `CONSOLE_OAUTH_AUDIENCE`.
