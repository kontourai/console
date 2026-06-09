# Console Telemetry Descriptor

Console does not own product-specific telemetry meanings. Products can publish a
`console.telemetry.json` descriptor to define the facets, workflow groupings, and
record-source mappings that Console should render. Console then queries and
renders analytics generically from those descriptor-owned attributes.

Telemetry storage is a separate server concern. The local `local-jsonl` adapter
is the default, `sqlite` provides local SQL-backed testing, and `postgres` names
the hosted Postgres-compatible path for deployments such as Supabase. Descriptor
facets, flows, and record sources continue to define product-specific shapes
regardless of the selected storage adapter.

Console currently looks for descriptors at:

- `console.telemetry.json` in the Console repo root
- each configured product root's `console.telemetry.json`
- each configured product root's `.kontour/console.telemetry.json`
- every explicit path in `CONSOLE_TELEMETRY_DESCRIPTOR_PATHS`

Configure product roots with the typed server option `telemetryProductRoots` or
the environment variable `CONSOLE_TELEMETRY_PRODUCT_ROOTS`. The environment
value is a comma-separated list of `product-id:/path/to/product` entries. For
example:

```sh
CONSOLE_TELEMETRY_PRODUCT_ROOTS=flow-agents:/opt/flow-agents,acme:/srv/acme
CONSOLE_TELEMETRY_DESCRIPTOR_PATHS=product:flow-agents:console.telemetry.json,console:config/local.telemetry.json
```

`telemetryFlowAgentsRoot` remains a compatibility alias that seeds a
`flow-agents` product root from the parent of the configured `.flow-agents`
directory. New integrations should use `telemetryProductRoots` or
`CONSOLE_TELEMETRY_PRODUCT_ROOTS`.

Hosted deployments may mount descriptors and product roots through deployment
config. The descriptor remains product-owned display metadata; it must not
redefine Flow-owned gate semantics, typed `expects`, route-back rules, or
workflow-learning source record authority. See [Flow Agents Console
Integration](../integrations/flow-agents-console.md).

## Shape

```json
{
  "facets": [
    {
      "id": "components",
      "label": "Components",
      "attribute": "component",
      "limit": 12
    },
    {
      "id": "outcomes",
      "label": "Outcomes",
      "attribute": "outcome",
      "limit": 8
    }
  ],
  "recordSources": [
    {
      "id": "product-work-items",
      "root": "product:acme:.product-telemetry",
      "files": ["work-items.json", "checks.json"],
      "attributes": {
        "component": "component",
        "feature": "feature_key",
        "bug": "bug_key",
        "status": "status",
        "title": "summary",
        "observedAt": "updated_at"
      }
    }
  ],
  "flows": [
    {
      "id": "release.validation",
      "label": "Release validation",
      "match": { "attribute": "feature", "includes": "release" },
      "titleAttribute": "title",
      "limit": 10
    }
  ]
}
```

`recordSources` are product-owned source adapters expressed as data. Console does
not know product file names or field meanings unless a descriptor maps them into
generic attributes. Flow Agents may publish such a descriptor as one producer,
but Console must treat it the same as any other product-owned descriptor.

Record source roots are contained to known roots:

- `product:<id>:<path>` resolves below the configured product root for `<id>`.
- `product:<path>` is a compatibility form that resolves below the default
  configured product root.
- `console:<path>` resolves below the Console root.

Console preserves symlink and path-escape protections for all descriptor record
sources. Escaped records are skipped and reported as warnings rather than read.

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
- `status`
- `outcome`
- `title`
- `project`
- `cwd`
- any product-owned attribute mapped by a `recordSources[].attributes` entry

Products may refine their emitted telemetry or sidecar records over time, then
publish descriptors that map those product-owned attributes into Console views.
Console should display those descriptors without redefining product semantics.

## Descriptor-Driven Analytics

Console analytics are descriptor-driven:

- `facets[]` define count surfaces by naming a stable `id`, display `label`, and
  source `attribute`.
- `flows[]` define grouped lists by matching generic attributes and choosing
  display attributes such as `titleAttribute`.
- `recordSources[]` define how product-owned records are read and mapped into
  generic attributes before analytics are computed.

Products can expose common concepts such as tools, skills, flows, bugs,
features, components, environments, or outcomes by mapping those concepts to
attributes and then referencing the attributes from facets or flows. Console
does not need hardcoded knowledge of those concepts. For example, a product that
emits `skill_key`, `feature_key`, and `bug_key` can map them to `skill`,
`feature`, and `bug`, then define facets with ids such as `skills`, `features`,
and `bugs`.

When no descriptor is present, Console should continue to render useful generic
telemetry from runtime attributes such as event type, tool name, runtime, agent,
project, and source kind. A descriptor only adds or shapes analytics surfaces; it
does not replace the base telemetry contract.

## `/api/telemetry` Query Contract

`GET /api/telemetry` returns the telemetry summary. An empty query remains
backward compatible for existing callers: the response keeps `generatedAt`,
`sources`, `totals`, `analytics`, `records`, and `warnings`.

The endpoint accepts these query params:

| Param | Shape | Meaning |
| --- | --- | --- |
| `preset` | `live`, `15m`, `24h`, `7d`, or `custom` | Selects the effective time window. `live` is a short recent window suitable for polling. |
| `from` | ISO timestamp | Inclusive lower bound for `custom` or explicit ranges. |
| `to` | ISO timestamp | Inclusive upper bound for `custom` or explicit ranges. Custom ranges may span at most 31 days. |
| `q` | string | Bounded free-text search across stable summary fields and string attributes. |
| `filter` | repeatable `facetId:value` | Applies a facet value filter. Repeat the param for multiple values. |
| `limit` | integer | Maximum number of records returned in this page. |
| `offset` | integer | Zero-based offset into the matched record set. |
| `sort` | `desc` or `asc` | Sort direction by observed time, defaulting to newest first. |

Repeatable filters are the preferred encoding because they are auditable and
URL-native:

```http
GET /api/telemetry?preset=24h&q=deploy&filter=components:api&filter=outcomes:failed&limit=50&sort=desc
```

Facet filtering is deterministic:

- Filters for different facets are combined with AND.
- Multiple values for the same facet are combined with OR.
- Facet ids are descriptor ids or generic fallback facet ids.
- Facet values are compared against the descriptor-owned attribute values for
  that facet.

Search is query-scoped and should run before pagination. It should cover stable
summary fields such as `eventId`, `eventType`, `sessionId`, `project`, `cwd`,
`toolName`, `agentName`, `model`, `status`, `outcome`, `title`, plus string
attributes mapped by descriptors. Search should not expose raw payloads or
unredacted secret values.

Analytics are computed from the matched query scope, not only from the current
page, so facet and flow counts explain the filtered result set. Returned
`records` are then sorted and paginated from that matched set.

## Response Metadata

Parameterized responses should add optional metadata without removing existing
fields:

```json
{
  "query": {
    "preset": "24h",
    "from": "2026-06-08T12:00:00.000Z",
    "to": "2026-06-09T12:00:00.000Z",
    "q": "deploy",
    "filters": [
      { "facetId": "components", "value": "api" },
      { "facetId": "outcomes", "value": "failed" }
    ],
    "sort": "desc"
  },
  "pagination": {
    "limit": 50,
    "offset": 0,
    "returnedCount": 21,
    "totalMatchedCount": 21
  }
}
```

`totalMatchedCount` is the number of records in the query scope when the storage
path can know it safely. If a bounded local read path cannot prove a complete
historical total, metadata must make the bounded scope clear and must not imply
an exhaustive count outside the read window.
`nextOffset` is present only when another page is available.

## Validation And Bounds

The server validates query params before reading storage:

- Unsupported `preset`, malformed timestamps, negative offsets, invalid sort
  directions, malformed filters, and non-integer limits return `400
  BAD_REQUEST` with safe validation details.
- `limit`, `q`, filter count, facet id length, filter value length, and time
  range size are bounded.
- `from` must be earlier than `to` when both are supplied, and the range may
  span at most 31 days.
- Query strings must not be interpolated into SQL. Storage adapters should use
  parameterized values and enum-validated sort directions.
- Tenant isolation remains storage-side for hosted SQL paths before any
  application-level search or facet filtering.
- Responses keep path redaction and sensitive-key redaction expectations from
  the base telemetry API.

Unknown descriptor-owned facet ids may be evaluated against record attributes
when they are syntactically valid. Malformed facet expressions are rejected
rather than silently ignored.
