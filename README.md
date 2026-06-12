# Kontour Console

[![CI](https://github.com/kontourai/console/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/console/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**One operating plane for the whole suite: claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions.**

The primitives remain portable — Console never becomes the authority for any of them:

- [Surface](https://kontourai.io/surface) owns claim trust state.
- [Flow](https://kontourai.io/flow) owns process transparency and gate control.
- [Survey](https://kontourai.io/survey) owns fact-review records.
- [Veritas](https://kontourai.io/veritas) owns repo/change governance.
- [Flow Agents](https://kontourai.io/flow-agents) owns agent-facing runtime distribution.

This repo ships local-first Console foundation code alongside the product context and architecture decisions. It includes fixture inspection, local file sinks, deterministic replay, and a loopback-only development server; it is not a hosted production service.

![Console local operating plane showing a replayed process flow with passed and waiting gates, claims, and an active process](docs/assets/console-operating-plane.png)

## Install / npx

Requires Node.js 22 or newer.

Run the inspector against any directory without installing anything:

```sh
npx @kontourai/console console-inspect
```

Or install globally and run directly:

```sh
npm install -g @kontourai/console
console-inspect            # inspect the current directory
kontour serve              # start the local hub on 127.0.0.1:3737
kontour-flow-bridge --help # bridge local Flow runs into the hub
```

`console-inspect` reads `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json` in the current directory, validates the records, and prints event counts plus current claim, process, gate, review, action, and link summaries. It exits 0 on success and 1 if validation errors are found. No network access; no mutations.

## Published packages

- `@kontourai/console` — the installable/npx entry point; ships the local hub (event ingestion, projections, telemetry, SSE) and the bundled React UI, plus compiled `kontour`, `console-inspect`, and `kontour-flow-bridge` bins.
- `@kontourai/console-core` — shared record and process-flow shapes.

The React UI (`console-ui`) is built into the package at `console-ui/dist` and served by `kontour serve` at the hub origin. It is not published as a separate npm package.

## Bridge a real Flow run

`kontour-flow-bridge` derives Console events from local [Flow](https://kontourai.io/flow) run files and delivers them to a hub — read-only over Flow's files, deterministic event ids, idempotent re-runs:

```sh
npx --package @kontourai/console kontour serve          # hub on 127.0.0.1:3737
npx --package @kontourai/console kontour-flow-bridge \
  --flow-root .flow --watch                                  # follow live runs
```

Point the Console UI at the hub and the operating plane follows your actual gated work — current step, advances, route-backs — with no demo scripting.

## See it locally

Start the hub and the UI, then replay the bundled cross-product example streams into it.

When using `npx @kontourai/console kontour serve`, the UI is served automatically at `http://127.0.0.1:3737/` — no separate terminal needed. For development inside this repo, use `npm run dev:local` to run the Vite dev server and hub together:

```sh
# terminal 1: loopback hub + UI together (dev mode with HMR)
npm run dev:local

# terminal 2: replay the example streams into the hub
for f in docs/examples/event-streams/*.jsonl; do
  while IFS= read -r line; do
    [ -n "$line" ] && curl -s -X POST -H "content-type: application/json" \
      --data "$line" http://127.0.0.1:3737/records >/dev/null
  done < "$f"
done
```

Open the UI, hit Reconnect, and the operating plane renders the replayed state: a Flow run waiting on a required-fields coverage gate, Surface claim freshness, and a Survey field review — the suite story in one screen.

## Package Layout

The Console prototype is split into TypeScript workspaces with clear ownership:

- `console-core` owns shared TypeScript record and process-flow shapes used across packages.
- `console-server` owns local file sinks, fixture/local inspection, current-state projection, and the loopback SSE hub.
- `console-ui` owns the React/Vite UI that renders hub state and live events.

Root commands delegate into those workspaces so a fresh checkout can still use `npm test`, `npm run typecheck`, `npm run inspect:fixtures`, and `npm run serve` from this directory.

## Contributor Hook Tooling

This repo includes optional local contributor tooling for Git hooks. To opt in, run:

```sh
npm run setup:repo-hooks
```

That command sets only this repository's local `core.hooksPath` to `.githooks`. It does not change global or system Git config. The tracked `.githooks/pre-push` hook runs the bounded existing Console lane:

```sh
npm test
```

Validate the hook wiring and drift checks with:

```sh
npm run validate:repo-hooks
```

For local/private boundary checks, set `CONSOLE_BOUNDARY_DENYLIST` to a comma- or newline-separated list before running validation.

Hook setup is not required for a fresh checkout to run package verification; `npm test` remains the direct verification command. These hooks are local contributor tooling, not Console event, projection, or control-plane semantics. The hook docs use generic suite products and producers language because product boundaries remain owned by suite primitives. When a push must intentionally skip local hooks, use Git's standard `--no-verify` mechanism.

## Local Fixture Inspection

Run the read-only fixture inspector from the repo root:

```sh
npm run inspect:fixtures
```

The command reads checked-in files under `docs/examples/event-streams/` and `docs/examples/projections/`, validates the local v0 envelopes, and prints event counts plus current claim, process, gate, review, action, and link summaries. Actions are shown as inert descriptors only; the inspector does not execute product commands, follow URLs, or mutate product-owned state.

## Local Console Producer Emission

A Console producer is the Kontour product or product runtime that emits control-plane records for Console. Surface, Flow, Survey, Veritas, and Flow Agents are the primary Console producers. Vertical products usually contribute through those primitives as extension metadata and refs, rather than depending on `.kontour` or Console directly. This is separate from any product-native "producer" concept inside those products, such as a crawler, verifier, importer, workflow runner, or agent.

Products can write local control-plane records without dependencies or hosted infrastructure. `LocalFileSink` writes under a configured `.kontour` root, appending events below `.kontour/events/` and writing current projection snapshots below `.kontour/projections/`.

The published `@kontourai/console` package ships compiled CommonJS in `dist`. Programmatic examples below use `require('@kontourai/console')` directly against the compiled output. When working inside this repo, `node --import tsx` also works.

```ts
const {
  KontourEmitter,
  LocalFileSink,
  CompositeSink,
  InMemorySink
} = require("@kontourai/console");

const memory = new InMemorySink();
const emitter = new KontourEmitter({
  sink: new CompositeSink([
    new LocalFileSink({ root: ".kontour" }),
    memory
  ])
});

const result = await emitter.emitEvent({
  schema: "kontour.console.event",
  version: "0.1",
  id: "event-provider-directory-updated",
  type: "claim.updated",
  occurredAt: "2026-06-01T16:00:00Z",
  producer: { product: "surface", id: "surface-console-producer" },
  scope: { product: "surface", kind: "tenant", id: "acme" },
  subject: { product: "surface", kind: "claim", id: "claim-provider-directory-current" },
  payload: {}
});

console.log(result.children.map((child) => ({
  sinkId: child.sinkId,
  outcome: child.outcome,
  recordId: child.recordId
})));
```

After a producer writes local records, inspect the generated `.kontour` tree without copying files into `docs/examples`:

```sh
node --import tsx console-server/bin/console-inspect.ts local
```

The same local read path is exported for programmatic consumers:

```ts
const { inspectLocalKontour } = require("@kontourai/console");

const report = inspectLocalKontour({ rootDir: process.cwd() });
console.log(report.eventStreams.length, report.projections.length);
```

`inspectLocalKontour` recursively reads `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json`, labels records as `local`, and treats action descriptors as read-only data. `npm run inspect:fixtures` remains fixture-only for checked-in examples under `docs/examples`.

`CompositeSink` returns one child result per sink, so a local `accepted` result can remain visible even when another sink fails. A future hosted API sink can be added as another child sink role in this fanout model, but this package does not implement an API, network transport, background retries, or remote ingestion.

## Local Hub Server

Run the local development hub from the repo root:

```sh
npm run serve
```

The `kontour serve` command binds to `127.0.0.1:3737` by default and serves the operating-plane UI at the hub URL as well as the API endpoints:

- `GET /` — Console UI (React SPA; index.html fallback for all unknown non-API paths)
- `POST /records`
- `GET /state`
- `GET /inspect`
- `GET /stream`
- `GET /events`

Open `http://127.0.0.1:3737/` in a browser after starting the hub to use the operating plane. The UI is bundled in the published package and served directly by the hub — no separate UI server process required.

To serve the hub API only, without the UI (API-only deployments or CI):

```sh
kontour serve --no-ui
# or
CONSOLE_SERVE_UI=0 kontour serve
```

`GET /stream` is the canonical server-sent event stream. It sends an initial `ready` event, an initial `state` event, and a `record.accepted` event after an accepted `POST /records`. `GET /events` returns local event stream JSON by default and remains an SSE compatibility path for `Accept: text/event-stream` clients. Browser-origin access is limited to loopback origins unless explicitly configured. Non-loopback local requests require the configured console token (`telemetryToken`, `CONSOLE_AUTH_TOKEN`, or `CONSOLE_TELEMETRY_TOKEN`) through `Authorization: Bearer ...` or `x-console-api-token`. The local hub persists through `.kontour` files and does not add a remote execution channel, product API fetcher, or action executor.

### Surface Claim Status/Freshness Producer Helper

`surfaceClaimStateToProjection()` and `surfaceFreshnessTransitionToEvent()` are the first Surface Console producer pattern in this package. They are dependency-free helper/example functions for mapping caller-owned Surface claim state into local Console records; they are not live Surface integration.

```ts
const {
  KontourEmitter,
  LocalFileSink,
  surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent
} = require("@kontourai/console");

const emitter = new KontourEmitter({
  sink: new LocalFileSink({ root: ".kontour" })
});

await emitter.emitProjection(surfaceClaimStateToProjection({
  claimId: "claim-provider-directory-current",
  status: "verified",
  freshness: { status: "fresh", asOf: "2026-06-01T16:05:00Z" },
  validFrom: "2026-06-01T16:00:00Z",
  validUntil: "2026-06-30T16:00:00Z",
  lastUpdatedAt: "2026-06-01T16:05:00Z",
  generatedAt: "2026-06-01T16:06:00Z",
  evidenceRefs: [{ product: "surface", kind: "evidence", id: "evidence-directory-crawl" }],
  actionRefs: [{ product: "surface", kind: "action", id: "action-refresh-directory" }]
}));

await emitter.emitEvent(surfaceFreshnessTransitionToEvent({
  claimId: "claim-provider-directory-current",
  occurredAt: "2026-06-01T16:10:00Z",
  before: { status: "stale" },
  after: { status: "fresh" }
}));
```

Optional action descriptors supplied to the helper are persisted as inert projection data only. The helper does not fetch Surface data, start Flow, execute commands, dereference URLs, or mutate product state.

### Other producer helpers

The same `emitProjection` + `emitEvent` pattern applies to the Flow and Survey helpers. Import the relevant pair for your product:

- `flowProcessStateToProjection` / `flowGateTransitionToEvent` — map caller-owned Flow process and gate state into Console records.
- `inspectLocalKontour` / `getFlowProcessStatus` — read back the local `.kontour` tree and query process projections.

All helpers are dependency-free and treat action descriptors as inert, read-only metadata — no product commands are executed.

## Telemetry Storage

Console server telemetry uses a named storage adapter. The default is
`local-jsonl`, which preserves local behavior and writes accepted records to
`.kontour/telemetry/records.jsonl`.

Adapter selection can be configured through `ConsoleHubServerOptions`:

```ts
createConsoleHubServer({
  telemetryStorageAdapter: "sqlite",
  telemetryDatabaseUrl: ".kontour/telemetry/console.sqlite"
});
```

The same selection is available through explicit environment variables:

- `CONSOLE_TELEMETRY_STORAGE=local-jsonl|sqlite|postgres|sql`
- `CONSOLE_TELEMETRY_DATABASE_URL=...`
- `CONSOLE_DATABASE_URL=...`

Use `sqlite` for local SQL-backed testing without adding a package; it writes to
`CONSOLE_DATABASE_URL` / `CONSOLE_TELEMETRY_DATABASE_URL`, or defaults to
`.kontour/telemetry/console.sqlite`. Relative SQLite paths resolve under the
repo root; absolute paths and `file:` URLs are trusted local operator
configuration. Use `postgres` for hosted deployments such as Supabase. Console
does not fall back to local JSONL when a SQL adapter is selected; writes fail
safely if the selected adapter cannot be opened.

## Docs

[**kontourai.github.io/console**](https://kontourai.github.io/console/) — the published docs site.

- [Product Boundaries](docs/product-boundaries.md)
- [Event And Projection Schema](docs/specs/projection-schema.md)
- [Emitter, Sink, And Plane Contract](docs/specs/emitter-sink-plane-contract.md)
- [Telemetry Descriptor](docs/specs/telemetry-descriptor.md)
- [Example event streams](docs/examples/event-streams/)
- [ADR 0001: Console As Suite Management Plane](docs/adr/0001-console-as-suite-management-plane.md)

## License

[Apache-2.0](LICENSE) © Kontour AI
