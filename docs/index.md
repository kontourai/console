---
title: Kontour Console
description: Suite-level operating plane for Kontour. Claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions.
---

# Kontour Console

<p class="home-lede">One operating plane for the whole suite. Console surfaces what is true, what is stale, what is blocked, and what comes next — without becoming the authority for any primitive.</p>

<div class="doc-grid">
  <a class="doc-card" href="product-boundaries.html">
    <strong>Product Boundaries</strong>
    <span>What Console owns, what the primitives own, and how suite-level authority is kept separate from product semantics.</span>
  </a>
  <a class="doc-card" href="specs/projection-schema.html">
    <strong>Event &amp; Projection Schema</strong>
    <span>The v0.1 event envelope, projection envelope, local JSONL stream convention, replay rules, and cross-product refs.</span>
  </a>
  <a class="doc-card" href="specs/emitter-sink-plane-contract.html">
    <strong>Emitter &amp; Sink Contract</strong>
    <span>Control-plane versus telemetry-plane records, local file output, multi-sink fanout, and inert action descriptors.</span>
  </a>
  <a class="doc-card" href="specs/product-capability-descriptor.html">
    <strong>Product Capability Descriptor</strong>
    <span>The versioned, offline discovery contract for safely routing to product-owned CLI capabilities without importing product kernels.</span>
  </a>
  <a class="doc-card" href="specs/kontour-cli-router.html">
    <strong>Kontour CLI Router</strong>
    <span>Explicit install and product-root usage, offline delegation, nested Flow/Flow Agents ownership, and legacy Console migration.</span>
  </a>
  <a class="doc-card" href="specs/intent-binding-consent.html">
    <strong>Intent Binding And Consent Policy</strong>
    <span>How a host binds console-ui component intents to product-owned execution authority, inert-when-unbound rendering, and the consent policy for a bound side-effecting intent.</span>
  </a>
  <a class="doc-card" href="deployment/hosted-console.html">
    <strong>Hosted Console</strong>
    <span>How a hosted deployment composes the base Console with deployment-owned infrastructure and environment mapping.</span>
  </a>
  <a class="doc-card" href="integrations/flow-agents-console.html">
    <strong>Flow Agents Integration</strong>
    <span>Local and hosted emission for Flow Agents: sink selection, descriptor location, trusted producer identity, and boundary rules.</span>
  </a>
  <a class="doc-card" href="specs/telemetry-descriptor.html">
    <strong>Telemetry Descriptor</strong>
    <span>Descriptor-driven analytics: facets, flows, record source mappings, and the <code>/api/telemetry</code> query contract.</span>
  </a>
</div>

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
npx @kontourai/console console-inspect
```

See the [Golden Demo](examples/golden-demo.html) for a full end-to-end example across Flow, Survey, and Surface.

## Architecture decisions

- [ADR 0001: Console As Suite Management Plane](adr/0001-console-as-suite-management-plane.html)
- [ADR 0002: Learning Records Use Control Plane](adr/0002-learning-records-use-control-plane.html)
- [ADR 0003: Authenticated Multi-Tenant Ingestion And The Value Plane](adr/0003-authenticated-multi-tenant-ingestion-and-the-value-plane.html)
- [ADR 0004: Adopt Fastify For The Console HTTP API](adr/0004-console-http-framework.html)
- [ADR 0005: Two-Layer Telemetry — Neutral Contract + Flow-Agents-Owned Cost/Pricing](adr/0005-telemetry-pricing-layers.html)
- [ADR 0006: Console Multi-Tenant Authentication & MCP Authorization](adr/0006-console-multitenant-auth.html)
