# Console

Console is the suite-level management and visibility product for Kontour. It brings portable state from the foundational primitives (Surface, Flow, Survey) and the products built on them (Veritas, Flow Agents) into one operating plane, with vertical products extending those primitive consoles rather than depending on Console directly.

## Language

**Console**:
The comprehensive cross-product workspace for understanding what is true, what is in progress, what is stale, what is blocked, what proof exists, what decisions were made, and what should happen next across Kontour products.
_Avoid_: Shared component library only, product-specific admin screen, required hosted service for primitives

**Primitive**:
A foundational, portable Kontour building block that other products and producers build on and that stays useful without Console. The foundational primitives are Surface (claim trust state), Flow (process transparency and gates), and Survey (producer fact-review records).
_Avoid_: Console-only data, proprietary backend dependency, hidden hosted requirement, treating a product built on primitives (Veritas, Flow Agents) as a primitive

**Product (built on primitives)**:
An off-the-shelf Kontour product an end user adopts directly, built on the foundational primitives. Veritas (repo/change governance, built on Surface) and Flow Agents (an agent-facing runtime that applies Flow and Veritas discipline) are products. Products still expose portable, Console-readable state.
_Avoid_: Treating a product as a primitive, hiding the underlying primitive, requiring Console to use the product

**Management Plane**:
The suite-level layer that aggregates, correlates, filters, routes, and manages cross-product state. The management plane may host collaboration and monitoring, but it must not own the core semantics of the products it observes.
_Avoid_: Product kernel, replacement for Surface or Flow, hidden workflow authority

**Console Projection**:
A product-owned read model shaped for console display and action. Surface, Flow, and Survey publish primitive projections, and the products built on them (Veritas, Flow Agents) publish product projections; vertical products may contribute extension metadata through the primitive they build on. Console composes projections without redefining their core meaning. Projections are cached views; product event streams are the durable integration contract when available.
_Avoid_: New source of truth, arbitrary BI model, direct database dependency

**Product Event Stream**:
An append-only stream of product-owned events describing meaningful state changes, decisions, actions, proof attachment, freshness changes, process progress, review updates, and exceptions. Console consumes event streams to build or refresh projections without becoming the authority for the events.
_Avoid_: Console-only audit log, mutable snapshot, hidden product database

**Portable Product Record**:
A product-owned durable record with consistent resource identity, status, and proof shape that remains meaningful outside Console. Console events and projections may carry, reference, or derive from Portable Product Records, but they do not replace the product-owned record.
_Avoid_: Console record, shared database row, generic telemetry event

**Cross-Product Identity Link**:
A portable reference connecting related objects across products, using product, kind, and id as the minimum stable identity. When the referenced object is a Portable Product Record, the link may also carry resource identity such as apiVersion, name, and uid.
_Avoid_: UI-only join, implicit path convention, lossy correlation, unrelated ref systems

**Unified Work Queue**:
A suite-level queue that brings together stale claims, evidence gaps, open Flow gates, Survey Review Items, producer reverification requests, Veritas readiness gaps, Survey candidate reviews, Flow Agents continuation needs, unsupported-gap inquiries, and pending mapping proposals.
_Avoid_: Replacing product-owned queues, generic task board, hiding product authority

**Survey Console Extension**:
A vertical product extension of Survey's review console surface. A vertical product can provide domain labels, subject refs, field renderers, and admin action context while Survey owns review item, candidate, source, observation, decision, and publication semantics.
_Avoid_: vertical products depending on `.kontour`, vertical products redefining Survey review semantics, Console becoming the admin review source of truth

**Suite-Level Action**:
A cross-product action exposed by Console, such as refresh a claim, request producer reverification, approve a Review Item, resume a Flow Run, route a gate back, attach proof, or open a product-native detail view. The product that owns the action remains the authority.
_Avoid_: Console bypass, unaudited mutation, action without product authority

**Surface Drill-Through**:
A Console path from an operating view into Surface-backed claim, evidence, freshness, and trust-gap detail. Console may embed enough Surface data for immediate context, while deeper inspection routes to Surface Console or product-native Surface data when available.
_Avoid_: Reimplementing Surface Console, hiding Surface provenance, link-only context

**Current Operating State**:
The cross-product view of claim status, process status, freshness, proof, gates, decisions, exceptions, and next actions at a point in time.
_Avoid_: Final truth, run-only status, single score

## Product Promise

Kontour primitives make transparency portable. Console makes transparency operable.

Users can adopt Surface, Flow, Survey, Veritas, or Flow Agents without Console. Console is the suite-level product that makes the primitives and the products built on them easier to manage together: one place for claim state, workflow state, proof, queues, decisions, freshness, exceptions, and next actions.

## Boundary

Console owns:

- suite-level navigation and workspace structure
- cross-product aggregation and correlation
- unified queues and action routing
- operator and producer management views
- hosted collaboration and monitoring, when present
- identity links across product objects
- extension composition across primitive consoles and verticals

Console does not own:

- Surface trust derivation
- Flow gate or transition semantics
- Survey fact-review record semantics
- Veritas repo/change governance policy
- Flow Agents runtime adapter behavior
- vertical product domain truth or admin UX semantics
- a requirement that primitives depend on hosted infrastructure

## Implementation Stance

Start with contracts and composition before a shared UI package:

- product event streams
- projection/read-model boundaries
- identity links
- queue and action vocabulary
- extension metadata
- route conventions
- refresh and reverification semantics

A shared shell or component package can emerge after Surface Console, Flow Console, and Survey Console prove which primitives are truly common. Survey Console is the expected primitive review surface; vertical products should extend it for admin review UX rather than integrating with Console as a requirement.
