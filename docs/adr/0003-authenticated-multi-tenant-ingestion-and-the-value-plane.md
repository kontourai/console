# ADR 0003: Authenticated Multi-Tenant Ingestion And The Value Plane

Date: 2026-07-05

## Status

Accepted (ratified by Brian Anderson, 2026-07-05)

## Context

Console is the suite management plane (ADR 0001): it aggregates, correlates, displays, and routes
product-owned records without becoming the authority for product semantics. It already separates the
**control plane** (product-owned events, projections, learnings, gates, claims, decisions) from the
**telemetry plane** (traces, metrics, usage/cost observations, delivery diagnostics), with authority
owned by the producing product (see `docs/specs/emitter-sink-plane-contract.md`, ADR 0002). Records
enter through a **sink ladder** — local files today, a hosted API and telemetry destinations later —
carrying `kontour.console.event` / `kontour.console.projection` shapes.

Three forces now converge that this ADR must resolve as one coherent architecture rather than as
separate features:

1. **Fleets.** Flow Agents' local-first coordination substrate (liveness ⋈ assignment) is being
   relayed to Console so multiple machines/owners see each other's holds (flow-agents #295 shipped
   the emit half; console #125 is the ingest + fleet projection). This makes Console receive records
   from **many, mutually-untrusting installations**.
2. **True multi-tenancy.** Tenancy is strong at the infrastructure layer (Postgres PK per tenant,
   per-tenant hubs/SSE) but weak at the schema layer (records do not self-identify a tenant). With
   many installations posting, this gap is now a correctness and isolation risk, not a nicety
   (flow-agents #394 / console #123).
3. **Value legibility.** The hosted tier's value proposition is not "we show your activity and cost"
   — it is "the scaffolding pays for itself," most sharply "a **smaller, cheaper model + the kits**
   matches a larger model alone, at a fraction of the cost" (flow-agents #349/#350/#409, console
   #117). Console must be the surface where that value is legible, which requires a *counterfactual*,
   not just observation.

The risk of solving these piecemeal is a proliferation of ingest endpoints, a tenant field that is
trusted from the payload (spoofable across tenants), a bespoke store per feature, and a "value" view
that is circular (measuring the scaffolding by its own gates). This ADR fixes the load-bearing calls.

## Decision

Six calls, each extending the existing plane/sink model rather than replacing it.

### 1. One authenticated ingress: the ApiSink, with versioned record *kinds*

All producers — local Builder/Knowledge kit installations, CI, and the eval harness (call 4) —
deliver through a **single authenticated `ApiSink`** (the hosted rung of the existing sink ladder;
console #73). It accepts `POST /records` with a small, versioned, discriminated set of record kinds:
the existing `kontour.console.event` and `kontour.console.projection` (control plane), plus the
telemetry-plane kinds `telemetry`, `kontour.console.liveness` (#295/#125), and
`kontour.console.economics` (#349). New signals are **additional kinds on one pipe**, never new
endpoints. The ApiSink is the one place that authenticates, rate-limits, validates shape, and stamps
tenancy (call 2); it then routes each record to its plane and projection.

### 2. Tenant is bound from the verified principal, not trusted from the payload

The **authoritative tenant is the tenant claim on the authenticated principal** (an OIDC human user
or an M2M client credential — console #98), resolved at the ApiSink. A record MAY carry a `tenant_id`
for self-description and debugging, but ingest **stamps** the tenant from the principal and **rejects
a record whose body `tenant_id` disagrees** with the principal's tenant. The body tenant is never the
source of truth. Every downstream projection and query is therefore tenant-scoped *by construction*,
on top of the existing Postgres-PK-per-tenant isolation. Each local kit installation authenticates as
its **own M2M principal, scoped to one tenant**; a human authenticates via OIDC. This closes the
schema-weak multi-tenancy gap the correct way — isolation is enforced at the trust boundary from a
verified identity, not asserted by a mutable field a hostile or buggy producer controls.

### 3. Event-sourced core per tenant; fleet, economics, and value are rebuildable projections

Extend the existing `OperatingState` projection model uniformly: the **immutable, tenant-stamped
record stream is the source of truth; the fleet view, the economics rollups, and the value comparison
are derived read-models that can be dropped and rebuilt.** Do not build a bespoke store per feature.
Liveness is a projection-with-TTL; economics is an aggregate; "value" (call 4) is an analytical query
grouped by experiment dimensions. This preserves ADR 0001's stance — Console renders and correlates,
it is not the authority — and keeps every new surface cheap and reconstructible.

### 4. Value is a controlled counterfactual, produced by a separate eval harness against an independent oracle

"Value" is **not** a telemetry projection over live usage — it is a controlled experiment, and its
honesty depends entirely on an **acceptance oracle that is independent of the kits**. Using the kits'
own gates as the oracle is circular (kit runs pass the kit's gates by construction). Therefore:

- A dedicated **`kontourai/evals` repository** owns a **task corpus with objectively-checkable
  outcomes** (tests pass / known-good diff / graded rubric) and the graders. This is the keystone; it
  is a distinct lifecycle from any single product and MUST be its own repo, not a subtree.
- A **baseline harness** (flow-agents #350) runs the matrix `{small, large model} × {bare, +kit}`
  over that corpus and, for each run, emits a `kontour.console.economics` record **tagged with
  `{model_tier, kit_condition, task_id, acceptance_label, iterations, defects_caught, cost}`** through
  the same ApiSink (call 1) as any other producer.
- The **value view** (console #117) is a projection over those tagged records: acceptance rate,
  iterations-to-accept, defects caught by gates, and **$ / acceptable-outcome**, grouped by
  `(model_tier, kit_condition)`. The headline cell is **`small+kit` vs `large-bare`** (flow-agents
  #409).

The harness *measures* the value; Console *renders* it; the independent oracle makes it *honest*.

### 5. The feedback loop is advisory, evidence-backed, and human-ratified — Console never writes back

Economics and value projections may emit **proposals** ("gate X fires often and catches nothing →
candidate to relax"; "small+kit underperforms on task-class Y → strengthen the plan gate there").
Console surfaces them; it does **not** change a kit, a gate, or a claim. Per ADR 0002, a proposal that
should cause a product-owned change is realized only when the **owning product emits the authoritative
control-plane event** through its own deliver loop after a human ratifies it (flow-agents
learning-review, #352/#252). Console publishes advisory data the local learning-review *pulls*; it
never pushes a command into a local installation. This preserves both trust and tenant data
sovereignty.

### 6. Local-first and never-authority are invariants; one binary self-hosts or runs hosted

Every capability above degrades to fully-functional-local: the console relay is opt-in and best-effort
(flow-agents #295), and Console is never the authority for a gate, claim, evidence, or coordination
decision — even the coordination "source of truth" mode remains a projection the owning substrate can
run without. The **same console binary** self-hosts single-tenant or runs the hosted multi-tenant
deployment (`console-deploy`); the owner's dogfood is **a tenant, not a fork**.

## Consequences

- **Multi-tenancy becomes correct, not just isolated.** Cross-tenant spoofing by editing a payload
  field is impossible; isolation is enforced from a verified identity at one boundary. This makes
  #98 (auth: principals) a hard prerequisite for opening the hosted ingress to more than one owner,
  and reframes the epic's "validate the body tenant_id" as "stamp from the principal, reject a
  mismatch."
- **One ingress, many kinds** keeps the surface small: liveness (#125), economics (#349), and future
  signals are additive kinds routed to projections, not new endpoints or new auth paths.
- **The value proof gets an owner.** The keystone is the independent oracle + task corpus in
  `kontourai/evals`, not a dashboard. The dashboard (#117) is downstream and easy once the tagged
  economics records exist. This makes the `kontourai/evals` repo decision (flow-agents #350/#409) a
  prerequisite, and it makes "is small+kit ≥ large-bare, and by how much" a falsifiable number.
- **The feedback loop stays trustworthy.** No silent self-modification; every kit/gate change still
  travels the normal evidence-backed deliver loop. Console is a lens and an advisor, not a controller.
- **Cost of change is bounded.** Because fleet/economics/value are rebuildable projections over an
  immutable per-tenant stream, schema and rollup evolution is a re-projection, not a migration of
  authority.
- **Dogfood and product are the same system.** The owner's "see my value" loop (flow-agents #410) is
  the hosted architecture exercised as a single tenant — no throwaway path.

Supersedes nothing; extends ADR 0001 (Console as management plane) and ADR 0002 (learnings are
non-authoritative control-plane records), and the emitter/sink/plane contract. Companion trackers:
console #123 / flow-agents #394 (fleet + tenancy), console #117 / flow-agents #349/#350/#409 (value),
flow-agents #352/#252 (feedback), flow-agents #410 (owner dogfood loop).
