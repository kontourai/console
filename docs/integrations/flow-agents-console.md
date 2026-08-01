# Flow Agents Console Integration

Status: integration guidance draft

Flow Agents can emit local and hosted Console records without making Console the
authority for Flow-owned workflow semantics. Flow continues to own Flow
Definition gates, route-back behavior, typed `expects`, provider policy, skill
execution, and workflow-learning source records. Console displays, correlates,
and routes through those records.

## Kit observability contribution host

Console's first Kit-host slice consumes the public Flow Agents package surfaces
`@kontourai/flow-agents/kit-observability-contract` and
`@kontourai/flow-agents/kit-observability-conformance`. It does not inspect Kit
private files or branch on Builder, Knowledge, or third-party Kit identifiers.

The authenticated routes are:

- `POST /api/kits/contributions` to register or quarantine a descriptor;
- `POST /api/kits/records` to validate a descriptor-bound record and its
  tenant/source provenance;
- `GET /api/kits/workspace` for generic standard-view registry, aggregate, run,
  and quarantine data;
- `GET /api/kits/runs/{runId}` to trace an aggregate to exact producer-owned
  source references.

Writes require `records:write`; reads require `records:read`. The authenticated
tenant is authoritative. A payload tenant and every source reference tenant must
match it. Invalid bindings, unsupported versions, cross-tenant references,
control bytes, and redaction canaries are quarantined without stopping valid
records.

Observational real-run evidence and controlled evaluation evidence remain
separate aggregate series. Console does not compute a causal-lift field or infer
acceptance, defects, gates, claims, or learning decisions. Producer data is
untrusted text in the standard-view model; the supplied text renderer escapes
markup and never executes the optional MCP Apps resource.

This draft is stacked on Flow Agents PR #1122 at commit
`32c0939ab2a4e81ac7514cd51c91d682907fab58`. The exact Git dependency does not
ship generated `build/` output, so `postinstall` runs
`scripts/prepare-stacked-kit-contract.mjs`. Before making this Console PR ready,
replace the Git pin with the released semver containing that commit, remove the
temporary postinstall/prepare script, run `npm ci`, and rerun the public
conformance test.

Production installs that omit development dependencies skip the temporary
build step. In that shape the optional peer is absent and Kit routes fail closed
with `503 KIT_HOST_UNAVAILABLE`; the rest of Console remains available.

The first slice explicitly reports these limitations in every workspace read:

- `in_memory_not_durable`: hosted persistence/replay is not yet verified;
- `causal_lift_not_computed`: modes cannot be collapsed into a lift claim;
- `mcp_apps_not_executed`: Console uses the declarative standard-view fallback.

The JSON standard-view contract is verified. Responsive, keyboard, and
screen-reader UI presentation remains `NOT_VERIFIED` until a Console UI surface
consumes it. Cross-host parity remains `NOT_VERIFIED` until Station consumes the
same public conformance vectors.

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
