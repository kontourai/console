# ADR 0005: Two-Layer Telemetry — Neutral Contract + Flow-Agents-Owned Cost/Pricing

Date: 2026-06-29

## Status

Accepted, with amendment (see below).

## Amendment (2026-07, post-implementation) — the "shared contract" premise did not hold

Implementing this ADR revealed that its central framing is wrong, and the honest boundary is
**simpler** than "a neutral package consumed by both producers and console":

- **flow-agents never consumed the package's *shapes* — only its cost math.** Once the cost
  math moved in-house (kontourai/flow-agents#557 reverted #243), flow-agents consumes
  **nothing** from `@kontourai/telemetry`. It defines its own telemetry event shapes and
  computes cost internally across bash/Python/TS (golden-vector-verified).
- **`@kontourai/telemetry` is therefore console-only** — the only importer, in any repo, is the
  console. It is console's telemetry/cost library with a neutral name, **not** a shared
  contract.
- **The real producer↔consumer contract is the wire format** (the JSONL telemetry event
  structure), not a shared code package.

Corrected boundary (supersedes the "two layers / shared package" model below):

- **flow-agents owns its telemetry end-to-end** (shapes + cost + pricing), fully self-contained,
  with **zero** console/`@kontourai/*` telemetry dependency. This — not a renamed shared
  package — is what actually solves the original boundary concern (a portable primitive
  depending on a console-*branded* package).
- **console keeps its own telemetry/cost lib** (`@kontourai/telemetry`, neutrally named).
- The two agree on the **wire format**, documented as data, not shared as code.

Consequences of the amendment:

- The neutral **rename** (#163) is retained (a neutral name is harmless and avoids the branded
  smell) but is **cosmetic** — it did not create a shared contract.
- The npm **publish** was not strictly necessary (a console-only package need not be published);
  it is harmless and left in place. `@kontourai/telemetry` could equally be console-internal.
- **Dropped:** the original step "flow-agents depends on `@kontourai/telemetry` for shapes." It
  would re-introduce a pointless flow-agents→console-lib dependency to satisfy a contract that
  is really just the wire format. Do not do this.
- **Not yet done (and now optional):** the console-side "read *stamped* cost instead of
  recompute" change. The console still recomputes cost from its own registry; that is fine —
  it is a local implementation detail, not a boundary violation, now that flow-agents owns and
  stamps cost independently.

The original decision text is retained below for history; where it conflicts with this
amendment, the amendment governs.

## Context

Telemetry/cost handling currently lives in a single published package,
`@kontourai/console-telemetry`, which bundles four distinct things:

1. **Telemetry shapes** — the event/usage record schema (`session.usage`, `by_model`,
   token counts) that producers emit and the console aggregates.
2. **OTel mapping** — GenAI semconv (`gen_ai.*`) translation, with `kontour.*` extensions
   for cache/cost.
3. **Cost math** — `costForModel(model, tokens, registry)`, a pure function.
4. **Pricing data** — a bundled `default-registry` snapshot of model rates, copied from
   `flow-agents/scripts/telemetry/pricing.json`, plus a file/URL loader.

A boundary review surfaced two problems with this shape:

- **A console-branded package is a hard dependency of a portable primitive.** flow-agents
  (a runtime that must be useful *without* a suite-level console, per ADR 0001 and
  `product-boundaries.md`) imports `@kontourai/console-telemetry` for its own emit-time
  cost math. That inverts the intended direction — it reads as "flow-agents depends on the
  console."
- **Pricing authority is duplicated and console-served.** The package bundles a *copy* of
  flow-agents' rates (so the console can originate prices offline), and the console exposes
  a `GET /api/telemetry/pricing` endpoint plus a cost-*recompute* path. Both place model
  pricing — an agent/model concern — inside the suite-level management plane.

A long design discussion converged on a cleaner separation. The realization that collapsed
the design: **once the console reads *stamped* cost off each record instead of recomputing,
cost/pricing has exactly one consumer (flow-agents itself)** — so it needs no shared package
at all, and the console needs no pricing.

## Decision

Split telemetry into two layers with distinct owners.

### Layer 1 — `@kontourai/telemetry` (neutral, published)

The shared **contract only**: telemetry event/usage **shapes** + **OTel mapping**. No cost
math, no pricing data. It is product-neutral because it has two+ parties — producers
(flow-agents today; other products later) emit it, and the console ingests/aggregates it.
This is the only published shared package. `@kontourai/console-telemetry` is renamed to this
and deprecated.

### Layer 2 — flow-agents (cost + pricing, internal; **not** a package)

flow-agents owns the **cost math** and the **pricing data** (`pricing.json`) as internal
code — kept consistent across its bash/Python/TS runtimes by the existing golden vectors.
flow-agents **computes cost at emit time and stamps `estimated_cost_usd` + `pricing_version`
onto each telemetry record** (it already does this). Because cost/pricing has a single
consumer, it is *not* extracted into a separate published package.

**Pricing stays dynamic without a server.** flow-agents has no running server, so pricing is
distributed as a **static, versioned, fetchable artifact** — the git-reviewed `pricing.json`
served as a static file (e.g. a GitHub raw URL on `main`, or a CDN/Pages path). Runtimes
load it with the precedence the loader already implements:

```
local file override  →  remote static URL (cached, TTL)  →  bundled snapshot fallback
```

So a price change is: edit `pricing.json` on `main` (reviewed) → it is served as a static
URL → runtimes pick it up within the cache TTL. **Reviewed in git** (authorship/control) and
**dynamic at runtime** (fetched static file) are the same artifact at two stages — there is
no server and no console pricing API.

### Console — Layer 1 consumer only

The console depends on `@kontourai/telemetry` for shapes, ingests telemetry whose cost is
**already stamped**, and **aggregates the stamped numbers**. It does **not**:

- serve a pricing endpoint (`GET /api/telemetry/pricing` is removed),
- recompute cost from rates (the recompute path is removed),
- depend on any pricing data or the cost math.

Retroactive re-pricing (apply updated rates to historical records) moves to flow-agents,
which owns pricing and has `tokens` + `pricing_version` on every record — the correct home
for a reprocessing job.

## Consequences

**Positive**

- The console is a neutral management/aggregation plane again (ADR 0001): it never owns,
  serves, or computes model pricing.
- "flow-agents authors pricing, console distributes" is enforced by the dependency graph, not
  just comments — and pricing has exactly one home.
- No portable primitive depends on a console-branded package; the shared dependency is a
  neutral *telemetry contract*, which is principled.
- Pricing is dynamic (static-URL fetch + TTL) yet reviewed in git, with no server.

**Negative / cost**

- This **partially reverts #243**: the strands-TS sink computes cost from flow-agents-internal
  code again rather than importing the package; it consumes only Layer-1 shapes.
- The console loses *live* cost-recompute. This was the boundary violation; reprocessing with
  updated pricing belongs in flow-agents (it has `tokens` + `pricing_version`).
- A new scoped package (`@kontourai/telemetry`) requires a one-time npm bootstrap by an org
  admin (CI/automation cannot create a new scoped package), as with the prior package.

**Migration (sequenced; the publish is the cross-repo gate)**

1. Create `@kontourai/telemetry` = shapes + OTel (extracted from `@kontourai/console-telemetry`,
   pricing/cost removed). **Org admin publishes it once** (`npm publish --access public`).
2. flow-agents: move cost math + pricing fully internal; point the pricing loader at the
   static `pricing.json` URL; depend on `@kontourai/telemetry` only for shapes.
3. console: depend on `@kontourai/telemetry`; read stamped cost; remove `/api/telemetry/pricing`
   and the recompute path.
4. Deprecate `@kontourai/console-telemetry` (`npm deprecate`).

## Related

- ADR 0001 — Console as suite-management plane (product neutrality).
- ADR 0003 — Console multi-tenant auth & MCP authorization (telemetry plane ownership).
- `docs/product-boundaries.md` — primitives usable without a suite-level console.
- Supersedes the implicit "console distributes pricing via an API + recompute" design and the
  bundled `default-registry` pricing snapshot.
