## Story / Outcome

As a Kontour product implementer, I want a transport-neutral emitter/sink contract, so that products can emit control and telemetry records once while preserving local-first operation and preparing for hosted Console ingestion.

## Problem

Kontour products need to produce events/projections for local Console use today and hosted/org Console use later. Direct filesystem writes alone will create migration friction. Treating telemetry and control state as the same kind of event will blur authority boundaries.

## Scope

- Document `KontourEmitter` responsibilities.
- Define control-plane record categories: semantic events, projection snapshots, evidence refs, identity links, action descriptors.
- Define telemetry-plane record categories: traces/spans, metrics, logs, usage/cost, operational events.
- Define sink semantics: local file sink, future HTTP/API sink, future telemetry/Otel sink, composite sink.
- Define fanout semantics: same semantic record id, per-sink delivery results, at-least-once delivery, dedupe by id, local-first fallback.
- Define non-execution rule for action descriptors.

## Non-goals

- Implement hosted API.
- Implement real HTTP or OTLP network calls.
- Integrate Campfit, Surface, Flow, Survey, Veritas, or Flow Agents.
- Build UI or dashboards.
- Define retry daemon/outbox beyond minimal contract language.

## Requirements

- R1: The contract MUST distinguish control-plane records from telemetry-plane records.
- R2: The contract MUST keep local file output as a required first-class sink.
- R3: The contract MUST support multi-sink fanout from one semantic source record.
- R4: The contract MUST define per-sink delivery results and at-least-once/dedupe expectations.
- R5: The contract MUST state that sinks adapt delivery format, not product domain meaning.
- R6: The contract MUST state that action descriptors remain inert and are never executed by generic sinks.

## Acceptance Criteria

- AC1: Docs define control-plane vs telemetry-plane data types and authority boundaries.
- AC2: Docs define `KontourEmitter`, `LocalFileSink`, `CompositeSink`, future `HttpApiSink`, and future telemetry/Otel sink roles.
- AC3: Docs define multi-output fanout with stable event/projection ids and independent per-sink results.
- AC4: Docs define local-first fallback and at-least-once/dedupe semantics.
- AC5: Docs explicitly state no generic sink executes action descriptors, opens URLs, or mutates product state.

## Verification Expectation

- Doc inspection for R1-R6 and AC1-AC5.
- Security review for action descriptor, URL, and network-boundary language.
- Scope review confirming no hosted API/client implementation was added.

## Milestone / Delivery Outcome

`Kontour Console Producer Contract`

## Dependencies / Blockers

None.

## Source Artifact

`.agents/flow-agents/kontour-emitter-sink-boundary/kontour-emitter-sink-boundary--idea-to-backlog.md`

## Priority Rationale

This is the foundation that keeps products from coupling directly to filesystem-only output while preserving local-first operation and setting up hosted/org Console ingestion later.

## Expected Size

Small.

## Thinnest Meaningful Slice

Docs/spec only: define the planes, emitter, sink roles, fanout semantics, and read-only/action authority boundaries without implementing network or hosted behavior.
