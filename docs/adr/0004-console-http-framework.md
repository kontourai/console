# ADR 0004: Adopt Fastify for the Console HTTP API (incremental)

Date: 2026-06-29

## Status

Proposed

## Context

The console HTTP server (`console-server/src/console-foundation/console-hub-server.ts`)
is a raw `node:http` server with hand-coded if-chain routing and hand-written request
validators. This was reasonable for a small surface, but the API has grown — multi-tenant
REST (telemetry + cost/usage analytics, records, pricing), SSE, an OAuth 2.1 Resource
Server (JWT/JWKS + per-route scopes, ADR 0003), an OIDC login flow, and an MCP (JSON-RPC)
server. The hand-rolled approach now has real costs:

- **Hand-rolled security is the largest risk.** The Phase-2c adversarial review found
  multiple bugs in hand-written auth/crypto: a constant-time compare that threw on
  malformed input (an oracle), a predictable secret fallback, and a scope-enforcement
  bypass. Vetted middleware shrinks this surface.
- **Validation ↔ types drift.** Every endpoint hand-validates; nothing binds validators to
  the TS types. (This drove the OpenAPI work below.)
- **No native API contract.** We built a lightweight in-code route registry + a
  `ts-json-schema-generator` step to emit OpenAPI 3.1 at `/openapi.json` (PR #108). It
  works and is drift-tested, but it re-declares routes and is machinery a framework
  provides natively.
- **Cross-cutting concerns reimplemented by hand** — CORS, cookies, body limits,
  content-type, error shapes — and **no rate limiting** (tracked as #106). No middleware
  pipeline, so auth/scope/tenant logic is inlined per route.
- Thinner observability; SSE hand-rolled; tests must spin the real server.

We want: first-class **OpenAPI 3.1** generation; **schema-first validation as a single
source of truth** (Zod) for runtime validation + TS types + the spec; vetted middleware
for auth/scope/tenant/rate-limit; good SSE; strong TS inference; **low migration friction**
from raw `node:http`; and good testing ergonomics.

**Hard constraint:** the package builds to **CommonJS** (tsc), and we have already paid a
real cost for ESM-only dependencies (`jose` required dynamic-import workarounds). A
framework being ESM-only is therefore a meaningful migration cost. Deployment is Docker on
Render/Fly.io (Node, not edge/serverless).

### Options considered (research, 2026; see Sources)

| Framework | OpenAPI 3.1 from Zod (single source) | CJS-consumable | Notes |
|---|---|---|---|
| **Fastify 5** | Yes — `@fastify/type-provider-zod` + `@fastify/swagger` | **Yes** | Node-native, mature, vetted plugins, `inject()` tests, SSE |
| **Hono** | Yes — `@hono/zod-openapi` (cleanest DX) | **ESM-first** | Multi-runtime; best if greenfield/edge/ESM |
| Express 5 | Bolt-on (`zod-to-openapi`) | Yes | OpenAPI not first-class |
| NestJS | `@nestjs/swagger` | Yes | Heavy (DI/decorators) — overkill |
| ts-rest / oRPC | Contract-first → OpenAPI | varies | Bigger paradigm shift |
| tRPC | No (TS↔TS, not REST/OpenAPI) | — | Wrong tool — clients are MCP/agents/CI/browsers |
| Elysia | Yes | — | Bun-bound; we are on Node |

The CJS constraint is decisive: Fastify is the only candidate that delivers OpenAPI 3.1 +
Zod single-source validation **without** forcing an ESM rewrite of the whole package, on
Node, with vetted middleware and incremental adoptability. Hono's Zod-OpenAPI DX is
arguably nicer but its ESM-first nature is exactly the friction we've already felt.

## Decision

Adopt **Fastify v5** as the console HTTP layer, **migrated incrementally**, with **Zod as
the single source of truth** (`@fastify/type-provider-zod`) and **`@fastify/swagger` for
OpenAPI 3.1**.

- Zod schemas drive **runtime validation + TS types + the OpenAPI spec** — replacing the
  hand validators, the bespoke route registry, and the `ts-json-schema-generator` step
  from PR #108.
- Auth/scope/tenant become Fastify **`preHandler` hooks** reusing the existing
  `verifyAccessToken` / session logic (no change to the verified security semantics).
- Adopt vetted plugins: `@fastify/cors`, `@fastify/rate-limit` (closes #106), cookie/body
  handling, replacing hand-rolled equivalents.
- The MCP JSON-RPC endpoint stays a POST route; the OAuth Resource Server stays a hook.

We do **not** choose Hono (ESM-first friction with our CJS build), Express (OpenAPI
bolt-on), NestJS (too heavy), tRPC (not REST/OpenAPI), or Elysia (Bun).

### Migration approach (incremental, mount-alongside)

1. Stand up Fastify as the request handler; **delegate not-yet-migrated paths to the
   existing `routeRequest`** so old and new coexist (no big-bang).
2. Migrate **route-by-route**: define the Zod schema → Fastify route (validation + types +
   OpenAPI come for free); move auth/scope to `preHandler`. Re-run the full test suite
   (215 tests today) per route.
3. Once all routes are migrated, **retire** the hand validators, the route registry +
   generator (#108), and the hand-rolled CORS/cookie/error plumbing.

## Consequences

**Positive**
- One schema → validation + types + spec (the single-source goal, natively).
- Vetted security/util middleware (CORS, rate-limit, cookies) replaces hand-rolled code —
  directly reduces the bug class the adversarial review found; closes #106.
- Middleware composition (auth/scope/tenant once, not per-route); `inject()` testing;
  better observability hooks.
- Stays on Node + CJS — no ESM rewrite; lower migration friction than the alternatives.

**Negative / risks**
- New framework dependency + a real (if incremental) migration effort.
- Known `zod.transform()` → OpenAPI quirk in the Fastify-Zod plugin (response fields can
  render as empty) — verify/avoid transforms in response schemas.
- SSE must be re-implemented on Fastify; OAuth/OIDC/MCP behavior must be preserved
  (guarded by re-running the existing suite per route).
- Some lock-in to Fastify's plugin model (mitigated: it's Node-standard and widely used).

**Not now.** This is a deliberate, larger effort, best done when next doing meaningful API
work — not bundled into unrelated changes. The tracked **hardening** (#104 dedicated
session secret + revocation, #105 id_token/at_hash/nonce, #106 rate limiting) proceeds on
the **current** server in the meantime; it is valuable regardless of this migration, and
#106 is partly subsumed once Fastify lands.

**Revisit if** we move to edge/multi-runtime (Hono becomes more attractive), flip the
package to ESM for other reasons (re-opens Hono), or decide a contract-first model
(ts-rest/oRPC) better fits cross-product type sharing.

## Sources

- Fastify Type Providers — https://fastify.dev/docs/latest/Reference/Type-Providers/
- fastify-zod-openapi (OpenAPI 3.1) — https://github.com/samchungy/fastify-zod-openapi · `@fastify/type-provider-zod` — https://github.com/turkerdev/fastify-type-provider-zod
- OpenAPI with Fastify / Hono (Speakeasy) — https://www.speakeasy.com/openapi/frameworks/fastify · https://www.speakeasy.com/openapi/frameworks/hono
- `@hono/zod-openapi` — https://www.npmjs.com/package/@hono/zod-openapi
- Hono vs Fastify (Better Stack) — https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/
