# Running the full Kontour stack locally (with auth)

This brings up the **entire console stack on your machine, including the auth paths**
(OAuth Resource Server, OIDC Authorization-Code+PKCE login, MCP) — using a real
Postgres and a **mock OIDC provider**, with the console running from current source.

> Just want the telemetry→cost loop without auth? You don't need any of this — run
> `npm run dev:local` (console in local mode, loopback auth, `local-jsonl`, no Postgres)
> and point flow-agents at it. This guide is for exercising the **hosted/auth** surface.

## Why the console runs on the host (not in compose)

Compose runs only the **backing services** (Postgres + mock OIDC). The console runs on
the host via `npm run serve`, because:

- it reflects your **current source** (the published image lags `main`);
- fast edit/restart loop;
- it reaches the mock OIDC at the **same `localhost:8080` the browser uses**, so the
  token `iss` is consistent — containerizing the console reintroduces the classic
  OIDC container-vs-browser split-horizon.

## Prerequisites

- Docker Desktop running
- Node 22+ and a built console: `npm ci && npm run build`

## 1. Start the backing services

```bash
docker compose -f docker-compose.dev.yml up -d
# wait for postgres healthy + mock-oidc discovery to answer:
curl -s http://localhost:8080/default/.well-known/openid-configuration | head -c 200
```

## 2. Apply database migrations

```bash
CONSOLE_DATABASE_URL=postgres://console:console@localhost:5432/console npx console-db-migrate
```

## 3. Run the console (hosted mode)

```bash
set -a; source dev/.env.fullstack.example; set +a
npm run serve -- --host 127.0.0.1 --port 3000
```

Smoke-check the surface:

```bash
curl -s http://localhost:3000/healthz
curl -s http://localhost:3000/openapi.json | head -c 200
curl -s http://localhost:3000/.well-known/oauth-protected-resource
```

## 4. Log in through the mock OIDC

Open <http://localhost:3000/auth/login>. You'll be redirected to the mock provider's
login page (`localhost:8080`); submit any subject. The mock issues tokens carrying
`org_id=kontour` (the tenant) and `aud=console-web`; the console validates the
`id_token` (nonce + at_hash) and the access token, then issues a session for tenant
`kontour`. You land back on the console authenticated.

## 5. Emit telemetry from flow-agents

```bash
# in the flow-agents repo:
export CONSOLE_TELEMETRY_URL=http://localhost:3000
export CONSOLE_TELEMETRY_TOKEN=dev-local-token   # matches CONSOLE_AUTH_TOKENS_JSON
# run a flow with the telemetry sink, then:
flow-agents telemetry-doctor
```

Watch it land in the console: `GET /api/telemetry` (or the UI).

## 6. MCP

```bash
# obtain an access token from the mock (client-credentials or the login flow), then:
curl -s -X POST http://localhost:3000/mcp \
  -H "authorization: Bearer <access-token>" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Teardown

```bash
docker compose -f docker-compose.dev.yml down        # keep data
docker compose -f docker-compose.dev.yml down -v      # wipe Postgres volume
```

## Notes / gotchas

- **`client_id == audience == http://localhost:3000`** is a local-only simplification: the
  RFC 8707 `resource` parameter must be an absolute URI, and making the client_id equal the
  audience keeps every token's `aud` a single consistent value. In production these are
  distinct (the audience is the RS identifier).
- **`at_hash`**: the console validates `at_hash` *if the provider supplies it*; it does not
  require it (OIDC Core §3.1.3.6 — `at_hash` is optional for the authorization-code flow).
  mock-oauth2-server omits it, which is fine. Real providers that omit it in code flow
  (e.g. Auth0, Microsoft Entra) work too.
- The mock's token claims (`org_id` tenant claim, `aud`, scopes) come from
  `dev/mock-oidc.json` via a `grant_type`-matched token callback.
- All secrets here are throwaway dev values — never reuse them.
