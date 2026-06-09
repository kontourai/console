# Console Telemetry Descriptor

Console does not own product-specific telemetry meanings. Products can publish a
`console.telemetry.json` descriptor to define the facets and workflow groupings
that Console should render.

Telemetry storage is a separate server concern. The local `local-jsonl` adapter
is the default, `sqlite` provides local SQL-backed testing, and `postgres` names
the hosted Postgres-compatible path for deployments such as Supabase. Descriptor
facets, flows, and record sources continue to define product-specific shapes
regardless of the selected storage adapter.

Console currently looks for descriptors at:

- `console.telemetry.json` in the Console repo root
- `../flow-agents/console.telemetry.json`
- `../flow-agents/.kontour/console.telemetry.json`

Hosted deployments may mount the descriptor and pass its location through
deployment config. The descriptor remains product-owned display metadata; it
must not redefine Flow-owned gate semantics, typed `expects`, route-back rules,
or workflow-learning source record authority. See
[Flow Agents Console Integration](../integrations/flow-agents-console.md).

## Shape

```json
{
  "facets": [
    {
      "id": "tools",
      "label": "Tools",
      "attribute": "toolName",
      "limit": 12
    }
  ],
  "recordSources": [
    {
      "id": "flow-agents-workflows",
      "root": "product:.flow-agents",
      "files": ["state.json", "acceptance.json", "handoff.json"],
      "attributes": {
        "taskSlug": "task_slug",
        "status": "status",
        "title": "summary",
        "observedAt": "updated_at"
      }
    }
  ],
  "flows": [
    {
      "id": "builder.shape",
      "label": "Builder shape",
      "match": { "attribute": "taskSlug", "includes": "shape" },
      "titleAttribute": "title",
      "limit": 10
    }
  ]
}
```

`recordSources` are product-owned source adapters expressed as data. Console does
not know product file names or field meanings unless a descriptor maps them into
generic attributes.

## Attributes

Console provides generic attributes from runtime telemetry and workflow
sidecars, including:

- `eventType`
- `sessionId`
- `agentName`
- `runtime`
- `toolName`
- `delegationTarget`
- `sourceKind`
- any product-owned attribute mapped by a `recordSources[].attributes` entry

Products may refine their emitted telemetry or sidecar records over time, then
publish descriptors that map those product-owned attributes into Console views.
Console should display those descriptors without redefining product semantics.
