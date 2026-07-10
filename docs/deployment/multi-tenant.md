# Multi-tenant auth and isolation

The hosted Console isolates every tenant's data by construction: each tenant gets
its own hub, stores, and projections, and every persisted record carries a
`(tenant_id, record_id)` primary key stamped from the **authenticated principal**,
never the request body. This document covers what that guarantees, how the default
single-token deployment differs from a real multi-tenant one, and how to enable
the multi-tenant / scoped-auth paths.

## What is enforced (all deployments)

- **Authentication is required.** No token or an unrecognized token → `401`.
- **The tenant boundary cannot be crossed.** A valid token with an
  `x-console-tenant-id` header that disagrees with the token's bound tenant →
  `403 TENANT_FORBIDDEN` (reads and writes).
- **The request body cannot smuggle a tenant.** A record whose body `tenant_id`
  disagrees with the authenticated principal → `403 TENANT_MISMATCH`
  (`stampTenantFromPrincipal`). A record with no body tenant, or a matching one,
  is stamped to the authoritative tenant.
- **Per-tenant data partitioning.** Core records, liveness, and economics each
  persist under `(tenant_id, record_id)` and load per tenant; one tenant's reads
  (`/state`, `/api/economics`, `/api/economics/value`) never surface another's
  rows.

These properties are covered by HTTP-level tests in
`console-server/test/console-hub-server.test.ts` (search `partitions core hub
records by tenant`, `partitions liveness actors by tenant`, and the `#159`
two-token isolation test spanning economics + liveness + the mismatch boundary).

## Default deployment: single static token (owner dogfood)

The reference deployment (`console-deploy`) sets a single `CONSOLE_AUTH_TOKEN`,
which maps to one tenant (`CONSOLE_TENANT_ID`, e.g. `kontour`). Characteristics:

- **Effectively single-tenant** — one token authenticates as one tenant. The
  isolation machinery is present but there is only one tenant to isolate.
- **The static token is scope-exempt** — it has full read+write within its
  tenant. Per-route least-privilege scopes (`records:write`, `economics:read`,
  `telemetry:write`, `pricing:read`, …) are enforced **only** for verified
  JWT / M2M principals (see below). This is deliberate: a static operator token
  is an admin credential for its own tenant.

This posture is appropriate for a single-owner instance. It is **not**
appropriate for hosting multiple customers — for that, enable one of the
multi-tenant paths.

## Enabling real multi-tenant auth

Set `CONSOLE_TENANT_ALLOWLIST` (comma-separated tenant ids) in every case — a
token or login whose tenant is not on the allowlist is rejected.

### Option A — multiple static tokens (`CONSOLE_AUTH_TOKENS_JSON`)

A JSON array mapping tokens to tenants:

```json
[
  { "token": "…", "tenantId": "acme",   "label": "acme-ingest" },
  { "token": "…", "tenantId": "globex", "label": "globex-ingest" }
]
```

Each token is bound to its `tenantId`; the boundary and body-mismatch rules above
apply per token. Static tokens remain scope-exempt (full access within their
tenant). Simplest path to more than one tenant; still coarse-grained per tenant.

### Option B — OIDC login + M2M client-credentials (scoped)

Set `CONSOLE_SESSION_SECRET` and the OIDC/OAuth config
(`console-hub-server` `runtimeConfig.oauth` / `oauthLogin`). Then:

- **Human users** log in via OIDC; the session cookie carries the verified
  `tenantId` and the granted scopes.
- **Machines** present a client-credentials JWT; the principal's `tenantId`
  (authoritative claim) and `scopes` come from the verified token.

With a verified principal, **per-route scope enforcement activates**: a request
missing the route's required scope → `403 INSUFFICIENT_SCOPE` with a
`WWW-Authenticate: Bearer error="insufficient_scope"` header. Route → scope map
lives in `requiredScopeForRoute` (mirrors the RFC 9728 `scopes_supported`
metadata at `/.well-known/oauth-protected-resource`).

> With an empty `CONSOLE_TENANT_ALLOWLIST`, OIDC logins are denied until the
> allowlist names the tenants — fail-closed by design.

## Verifying isolation before onboarding a second tenant

The `#159` test proves isolation against the in-repo fake SQL client. Before
serving a real second tenant, run a staging smoke against real Postgres:

1. Configure two tenants (Option A or B) with `CONSOLE_TENANT_ALLOWLIST`.
2. As tenant B, POST a tagged economics record and a liveness claim.
3. As tenant A, confirm `GET /api/economics/value` shows `taggedRunCount: 0`
   and `/state` `actors[]` excludes B's actor.
4. Confirm a cross-tenant header and a mismatching body `tenant_id` are both
   rejected (`403`).

Enabling multi-tenant / scoped auth on the hosted deployment is an
owner-gated operations change (secrets + `render.yaml` env), not a code change.
