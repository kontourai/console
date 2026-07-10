# Flow Agents Console Integration

Status: integration guidance draft

Flow Agents can emit local and hosted Console records without making Console the
authority for Flow-owned workflow semantics. Flow continues to own Flow
Definition gates, route-back behavior, typed `expects`, provider policy, skill
execution, and workflow-learning source records. Console displays, correlates,
and routes through those records.

## Local Emission

For local development, Flow Agents should keep using local file emission:

- emit control-plane Console handoff records through the Console emitter
- write local JSONL event streams and projections with `LocalFileSink`
- keep stable event ids across retry and fanout
- store task/session artifacts under `.kontourai/flow-agents`
- expose display metadata through `console.telemetry.json`

Local output must remain useful when hosted Console is unavailable.

## Hosted Emission

For hosted deployments, Flow Agents should add an authenticated hosted sink when
configured. The hosted sink is a transport adapter; it does not rewrite Flow
semantics.

Recommended headers for hosted emission:

```http
Authorization: Bearer ${CONSOLE_AUTH_TOKEN}
X-Console-Tenant-Id: ${CONSOLE_TENANT_ID}
X-Console-Producer: flow-agents
X-Console-Producer-Instance: ${FLOW_AGENTS_INSTANCE_ID}
```

The bearer token identifies a trusted producer. The tenant header scopes the
write. The producer headers are operational identity for audit, dedupe,
correlation, and support; they do not grant product authority by themselves.

## Descriptor Location

Console descriptor metadata should live in a product-owned
`console.telemetry.json` file in the Flow Agents repo or package bundle.
Configure Console with a generic product root rather than a Flow Agents-specific
path:

```sh
CONSOLE_TELEMETRY_PRODUCT_ROOTS=flow-agents:/path/to/flow-agents
```

Console then discovers `console.telemetry.json` at that product root. A hosted deployment
may mount descriptors and point Console at them with
`CONSOLE_TELEMETRY_DESCRIPTOR_PATHS`, including product-qualified entries such
as `product:flow-agents:console.telemetry.json`. The descriptor maps
product-owned fields into generic Console display attributes. It must not
redefine Flow Definition gates, typed `expects`, route-control semantics, or
learning authority.

Local, hosted, and user-hosted configurations use `telemetryProductRoots` or
`CONSOLE_TELEMETRY_PRODUCT_ROOTS` so multiple products can publish descriptors
side by side. The removed `telemetryFlowAgentsRoot` alias is not supported by
current versions; configure the Flow Agents repository root as a generic product
root instead.

## Control Plane Versus Telemetry Plane

Flow Agents should emit control-plane records for workflow state that Console
needs to display or route:

- task/session state
- handoff and acceptance artifacts
- gate-opened, gate-passed, gate-failed, and route-back records produced under
  Flow authority
- workflow-learning source refs or summaries
- inert action descriptors that route back to Flow-owned adapters

Flow Agents may emit telemetry-plane records for operation:

- emission latency
- sink delivery result
- retry count
- queue depth
- tool/runtime observation
- cost and usage observations
- health and readiness diagnostics

Telemetry records can reference control-plane ids for correlation. They must not
be treated as proof that a claim is true, a gate passed, or an action executed.

## Trusted Producer Identity

A hosted Console deployment should configure Flow Agents as a trusted producer
with:

- a producer id, usually `flow-agents`
- one or more bearer tokens from the secret manager
- an allowed tenant list
- optional instance ids for runtime-specific audit
- descriptor path or mounted descriptor content

Token rotation should allow overlap between old and new tokens. Revoking a token
should stop future hosted writes from that producer without rewriting historical
records.

## Sink Selection

Flow Agents should select sinks by config:

| Mode | Control-plane sink | Telemetry sink | Notes |
| --- | --- | --- | --- |
| Local | `LocalFileSink` | local diagnostics or none | Required baseline. |
| Hosted with local mirror | `CompositeSink(LocalFileSink, HttpApiSink)` | local plus hosted diagnostics | Preferred during rollout. |
| Hosted only | `HttpApiSink` | hosted diagnostics | Use only when local artifacts are intentionally disabled. |

Each sink returns its own delivery result. A hosted failure must not erase a
successful local write, and a local failure must not be hidden by hosted success.

## Boundary Rules

- Keep Flow Definition gate semantics and typed `expects` in Flow.
- Keep workflow-learning source schemas in Flow Agents.
- Keep Console descriptors focused on display grouping, facets, and generic
  attributes.
- Keep hosted tenant and token headers in deployment/runtime config.
- Keep action descriptors inert in generic sinks.
- Do not use Console telemetry as authority for Surface claims, Flow gates,
  Survey reviews, Veritas checks, product decisions, or action execution.

See also [Emitter, Sink, And Plane Contract](../specs/emitter-sink-plane-contract.md)
and [Console Telemetry Descriptor](../specs/telemetry-descriptor.md).
