# Hosted Console Deployment

Status: deployment shape draft

This document describes how a hosted Console deployment composes the reusable
base Console with deployment-owned infrastructure. The base Console remains
generic: it provides event, projection, telemetry, descriptor, and local hub
contracts without knowing the public host, production database, tenant defaults,
or secret names for a specific operator.

## Base Versus Deployment Overlay

| Layer | Owns | Must not own |
| --- | --- | --- |
| Base Console packages | Generic server, UI, core contracts, local JSONL defaults, descriptor loading, emitter and sink contracts, typed options. | Public deployment domains, production secret names, tenant ids, product-specific database names, or hosted policy defaults. |
| Deployment overlay | Hostname, process manager, network policy, TLS, allowed origins, tenant bootstrap, database URL, migration order, secret source, readiness checks, rollback procedure. | Product semantics, Flow gate behavior, Surface trust behavior, or Console package source changes. |

A deployment overlay lives in a separate repository or config directory. Other operators can provide their own overlay without modifying `console-core`, `console-server`, or `console-ui`.

## console.example.com Composition

The Kontour hosted deployment at `console.example.com` should compose:

- the latest approved reusable Console package or source build
- a Kontour-owned Postgres database for hosted telemetry storage
- deployment-provided SQL client wiring and runtime dependency installation
- versioned migration execution before accepting production traffic
- TLS and routing at the platform edge
- `https://console.example.com` as the browser origin
- trusted producer tokens for Kontour primitives and Flow Agents
- tenant allowlist and bootstrap tenant mapping from deployment config
- health and readiness checks wired into the hosting platform

The base Console should be selected by version, package, container image, or
source revision. The deployment overlay should record that pin outside base
source, then inject environment variables at runtime.

## Environment Mapping

Use deployment-owned names for secret storage and map them to generic Console
runtime options. Do not add Kontour-specific names to base source.

| Deployment value | Generic Console meaning | Notes |
| --- | --- | --- |
| `CONSOLE_RUNTIME_MODE=hosted` | Select hosted mode. | Local development should remain `local` or unset. |
| `CONSOLE_HOST=0.0.0.0` | Bind address inside the deployment container or VM. | Edge routing owns the public hostname. |
| `CONSOLE_PORT=3000` | Server listen port. | Match platform service config. |
| `CONSOLE_PUBLIC_ORIGIN=https://console.example.com` | Canonical public origin. | Used for links, CORS, and operator docs. |
| `CONSOLE_ALLOWED_ORIGINS=https://console.example.com` | Browser origins allowed to call hosted API. | Comma-separated when staging origins exist. |
| `CONSOLE_TELEMETRY_STORAGE=postgres` | Hosted telemetry adapter selection. | The base local default remains `local-jsonl`. |
| `CONSOLE_DATABASE_URL` | Postgres connection string. | Secret. Store only in the secret manager. |
| `CONSOLE_TENANT_ID` | Default tenant id for single-tenant bootstrap auth. | Deployment-specific default. |
| `CONSOLE_AUTH_TOKEN` | Single bootstrap bearer token mapped to `CONSOLE_TENANT_ID`. | Secret. Use only for simple deployments. |
| `CONSOLE_AUTH_TOKENS_JSON` | Multi-token tenant mapping. | Secret JSON array of `{ "token", "tenantId", "label" }`. |
| `CONSOLE_TELEMETRY_PRODUCT_ROOTS` | Product id to mounted product root mappings. | Required when descriptors use `product:<id>:...` record sources. |
| `CONSOLE_TELEMETRY_DESCRIPTOR_PATHS` | Descriptor path override list, if not using default search paths. | Prefer product-qualified mounted descriptor files such as `product:flow-agents:console.telemetry.json`. |

For local SQL-backed testing, use `CONSOLE_TELEMETRY_STORAGE=sqlite` with
`CONSOLE_DATABASE_URL` pointing at a `.sqlite` file. Hosted mode intentionally
continues to require `postgres`; Supabase should be wired through its Postgres
connection string plus the hosted auth and tenant configuration above.

If the hosted telemetry adapter needs `pg` or another SQL client, the deployment
must install and wire that dependency explicitly. This repo should not claim the
`pg` package is available until it is actually declared in the relevant package
manifest and verified by tests.

## Secret Placeholders

Use placeholders in examples and docs:

```dotenv
CONSOLE_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
CONSOLE_AUTH_TOKEN=replace-with-secret-manager-reference
CONSOLE_AUTH_TOKENS_JSON=replace-with-secret-manager-reference
```

Never commit real passwords, bearer tokens, private keys, production database
hosts with embedded credentials, or provider-specific secret payloads.

## Migration Order

1. Build or fetch the approved base Console artifact.
2. Provision or verify the hosted Postgres database.
3. Inject the hosted env file from non-secret config plus secret manager values.
4. Run versioned Console database migrations against the target database:
   `npm --workspace @kontourai/console run db:migrate`.
5. Start the hosted Console process with `CONSOLE_RUNTIME_MODE=hosted`.
6. Verify `/healthz` for process health.
7. Verify `/readyz` for dependency readiness, including database and migration
   state once those checks exist in base server code.
8. Route traffic from `console.example.com`.
9. Confirm producer emission from one trusted local or staging producer before
   enabling wider producer traffic.

Migration execution must happen before new code handles production writes. Use
`npm --workspace @kontourai/console run db:migrate -- --dry-run` to inspect
the migration set without connecting to a database.

## Health And Readiness

`/healthz` should answer whether the server process is alive and able to return
a minimal response. It must not report product truth.

`/readyz` should answer whether hosted dependencies are ready for traffic. For a
Postgres-backed deployment, readiness should eventually include database
connectivity and migration state. It should redact secrets and avoid returning
raw backend errors.

Health and readiness are operational telemetry. They do not prove Surface
claims, Flow gates, Survey reviews, Veritas checks, or Flow Agents runtime
state.

## Data Durability

As of this version both core event records and telemetry records are persisted
in Postgres.  The Render (and similar) free-tier ephemeral filesystem no longer
causes data loss on redeploy.

| Table | Purpose | Survives redeploy |
| --- | --- | --- |
| `console_telemetry_events` | Agent and runtime telemetry records | Yes — Postgres |
| `console_core_records` | Core console event records (gates, claims, processes, learnings, actions) | Yes — Postgres |

A single `npm --workspace @kontourai/console run db:migrate` run covers all
tables.  Re-running it on upgrade is safe and idempotent — already-applied
migrations are skipped.

The `/state` endpoint and SSE late-join state are both rebuilt from the
Postgres-loaded in-memory record set on startup, so the operating plane
state reflects full history across redeploys.

## Rollback Notes

- Roll back the routing target or artifact pin before changing database state.
- Prefer backward-compatible migrations. A newly deployed server should tolerate
  the previous migration state until the migration step completes.
- If a migration is not backward compatible, write a paired rollback plan before
  production rollout.
- Keep producer tokens stable during application rollback unless the incident is
  credential-related.
- Do not delete local JSONL or hosted telemetry records during rollback. Treat
  duplicate delivery as possible and rely on stable semantic record ids for
  dedupe.
- If hosted telemetry storage fails, report delivery failures explicitly. Do not
  silently fall back from `postgres` to local JSONL in hosted mode.

## Boundary Checks

Kontour-specific literals such as `console.example.com` should appear only in
deployment, config, docs, or scripts. They should not appear in base package
source:

```sh
rg -n "console\\.kontourai\\.io|kontourai.*tenant|KONTOUR_PROD|prod-db" console-server console-core console-ui
```

Run the content boundary check after editing deployment docs:

```sh
npm run check:content-boundary
```
