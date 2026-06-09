# ADR 0002: Learning Records Use The Control Plane

Date: 2026-06-04

## Status

Accepted

## Context

Console needs to show learnings that come from product operation, reviews, workflow runs, agents, retrospectives, and product-specific improvement loops. Those learnings may explain why a process changed, why a future action is recommended, or what a product learned from an outcome.

Existing Console architecture already separates semantic control-plane records from operational telemetry-plane records. It also keeps source schemas and product truth owned by Surface, Flow, Survey, Veritas, Flow Agents, and vertical products.

## Decision

Learnings enter Console through the existing control plane as non-authoritative `learning.*` product-owned semantic records. Console will not introduce a separate third learning plane.

A learning record may be emitted as a Console event type such as `learning.recorded`, `learning.updated`, or another product-owned `learning.*` extension. It may also appear in projection payloads or product namespaced extensions when a producer needs a current read model. The producing product owns the source schema, lifecycle, meaning, and any product-local identifiers.

Console may aggregate, correlate, display, filter, and route learning records through product authority. It must not treat learning as authority to revoke, change, or override claims, gates, decisions, actions, product records, source facts, or product truth. If a learning causes a product-owned change, the owning product must emit the corresponding authoritative control-plane event, such as `claim.status.changed`, `gate.routed_back`, `decision.recorded`, or `action.requested`.

`decision.recorded` remains the event for a durable product-owned decision. A learning can explain, reference, or be derived from a decision, but it is not the decision itself unless the owning product also records a decision event.

Telemetry may describe the operation of learning pipelines, such as extraction latency, failure rate, token use, delivery status, or replay behavior. Telemetry is not authority for learning semantics and cannot promote an observation into product truth.

Flow Agents `workflow-learning` records remain Flow Agents-owned source records. Console handoff records can summarize or reference them as `learning.*` control-plane records, but they do not replace the `workflow-learning` schema or require other products to adopt it.

## Consequences

Positive:

- Learning becomes visible in the same operating plane as claims, gates, decisions, actions, evidence, and process state.
- Console keeps one semantic integration path instead of adding a third plane with unclear authority.
- Product-owned learning schemas can evolve independently.
- Operators can connect learnings to decisions, telemetry, workflow runs, evidence, and actions without making Console the source of truth.

Trade-offs:

- Consumers must distinguish explanatory learning records from authoritative product changes.
- Products that want learning-specific behavior need to emit explicit `learning.*` events or projection extensions.
- Cross-product learning views depend on refs, summaries, links, and product-specific extensions rather than one universal source shape.

## Alternatives Considered

### Create A Separate Learning Plane

Rejected for now. A learning plane would duplicate control-plane identity, refs, links, event ordering, projection, and delivery rules while making authority less clear. Learning records are semantic product records, not operational telemetry and not a new class of product truth.

### Define A Universal Learning Source Schema

Rejected. Learnings come from different products and workflows with different source records, review semantics, provenance, and lifecycle needs. A universal source schema would either erase product meaning or become a hidden product-kernel schema. Console handoff records should carry stable refs, summaries, links, payload data, and namespaced extensions while source schemas remain product-owned.

### Treat Learning As Telemetry

Rejected because telemetry describes operation and performance. A learning may be about product semantics, decisions, workflow outcomes, or domain observations. It belongs in the control plane when it is shown as semantic operating context, while telemetry may still describe how that learning was produced or delivered.
