# Kontour Console

Find blocked work, inspect producer-reported status and evidence, and see what needs to happen next. Console correlates related product records in one view; each producing product remains the authority for its own status and decisions.

- [Product Boundaries](product-boundaries.md): What Console owns, what the primitives own, and how suite-level authority is kept separate from product semantics.
- [Event & Projection Schema](specs/projection-schema.md): The v0.1 event envelope, projection envelope, local JSONL stream convention, replay rules, and cross-product refs.
- [Emitter & Sink Contract](specs/emitter-sink-plane-contract.md): Control-plane versus telemetry-plane records, local file output, multi-sink fanout, and inert action descriptors.
- [Product Capability Descriptor](specs/product-capability-descriptor.md): The versioned, offline discovery contract for safely routing to product-owned CLI capabilities without importing product kernels.
- [Kontour CLI Router](specs/kontour-cli-router.md): Explicit install and product-root usage, offline delegation, nested Flow/Flow Agents ownership, and legacy Console migration.
- [Intent Binding And Consent Policy](specs/intent-binding-consent.md): How a host binds console-ui component intents to product-owned execution authority, inert-when-unbound rendering, and the consent policy for a bound side-effecting intent.
- [Hosted Console](deployment/hosted-console.md): How a hosted deployment composes the base Console with deployment-owned infrastructure and environment mapping.
- [Flow Agents Integration](integrations/flow-agents-console.md): Local and hosted emission for Flow Agents: sink selection, descriptor location, trusted producer identity, and boundary rules.
- [Telemetry Descriptor](specs/telemetry-descriptor.md): Descriptor-driven analytics: facets, flows, record source mappings, and the `/api/telemetry` query contract.

## How Console composes the suite

Console reads product-owned records — Surface claims, Flow runs and gates, Survey review items, Veritas readiness checks, Flow Agents sessions — and presents the integrated operating state without redefining what any of them mean.

The primitives remain portable and useful without Console:

- **Surface** owns claim trust state: verified, stale, disputed, fresh.
- **Flow** owns process and gate semantics: runs, gates, route-backs, exceptions.
- **Survey** owns fact-review records: sources, candidates, review decisions.
- **Veritas** owns repo and change governance: standards, requirements, merge readiness.
- **Flow Agents** owns agent-facing runtime: modes, skills, adapters, workflow learning.

Console answers the suite-level questions: what is currently true, what is blocked, what proof supports this state, and what is the next action.

The [`@kontourai/cli` router](specs/kontour-cli-router.md) provides suite navigation while keeping Flow, Flow Agents, and Console commands in their product-owned executables. It never installs a missing product or treats descriptor confirmation metadata as permission.

The [`kontour init` workflow](specs/kontour-init.md) can inspect and plan onboarding with zero implicit kits, then recompute and apply the exact stdout-emitted plan id only with explicit consent. Product-owned setup and diagnostics remain delegated to Flow Agents.

## Local first

Console v0 runs locally without a hosted service. Producers write JSONL event streams and projection snapshots under `.kontourai/console/`. The `console-inspect` CLI reads them and prints a current operating state summary. `kontour serve` exposes the same state over a loopback SSE hub for the UI.

```sh
npx --yes --package @kontourai/console console-inspect
```

See the [Golden Demo](examples/golden-demo.md) for a full end-to-end example across Flow, Survey, and Surface.

## Architecture decisions

These numbered ADRs are frozen history. New decisions go to `docs/decisions/<slug>.md` in the [Corpus decision-record format](https://github.com/kontourai/corpus/blob/main/docs/decisions.md), citing an ADR as `adr` evidence; the [decision index](decisions/index.md) lists them.

- [ADR 0001: Console As Suite Management Plane](adr/0001-console-as-suite-management-plane.md)
- [ADR 0002: Learning Records Use Control Plane](adr/0002-learning-records-use-control-plane.md)
- [ADR 0003: Authenticated Multi-Tenant Ingestion And The Value Plane](adr/0003-authenticated-multi-tenant-ingestion-and-the-value-plane.md)
- [ADR 0004: Adopt Fastify For The Console HTTP API](adr/0004-console-http-framework.md)
- [ADR 0005: Two-Layer Telemetry — Neutral Contract + Flow-Agents-Owned Cost/Pricing](adr/0005-telemetry-pricing-layers.md)
- [ADR 0006: Console Multi-Tenant Authentication & MCP Authorization](adr/0006-console-multitenant-auth.md)
