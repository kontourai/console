// Declarative registry of the console HTTP API (ADR 0003 / API docs).
//
// This is the single source the OpenAPI document is GENERATED from (see
// openapi.ts) — paths, auth, scopes, and request/response schema refs. A drift
// test (openapi.test.ts) binds it to the real router: registry paths must equal
// KNOWN_ROUTES and registry scopes must equal requiredScopeForRoute(), so the
// published spec can never silently disagree with the server. Response schema
// refs point at definitions generated FROM the TS types
// (openapi/schemas.generated.json), so data shapes are code-derived, not authored.

export type ConsoleScope = "telemetry:read" | "telemetry:write" | "records:read" | "records:write" | "economics:read";

export interface ApiQueryParam {
  name: string;
  type: "string" | "integer";
  description: string;
  enum?: string[];
}
export interface ApiResponse {
  description: string;
  /** Name of a definition in schemas.generated.json (→ $ref), if applicable. */
  schema?: string;
  /** Defaults to application/json. */
  contentType?: string;
}
export interface ApiRoute {
  method: "GET" | "POST";
  path: string;
  /** Auth model: public (no gate), gate (authenticateRequest), ingest (CONSOLE_INGEST_TOKEN). */
  auth: "public" | "gate" | "ingest";
  /** Required scope when behind the auth gate (enforced for scope-carrying creds). */
  scope?: ConsoleScope;
  /** Whether this exact path participates in the router's KNOWN_ROUTES set
   *  (false for templated paths handled by prefix, e.g. /ingest/flow/{runId}). */
  knownRoute?: boolean;
  summary: string;
  tags: string[];
  request?: { schema?: string; description?: string };
  query?: ApiQueryParam[];
  responses: Record<string, ApiResponse>;
}

const TELEMETRY_QUERY: ApiQueryParam[] = [
  { name: "preset", type: "string", description: "Time window preset.", enum: ["live", "15m", "24h", "7d", "custom"] },
  { name: "from", type: "string", description: "ISO 8601 start (with preset=custom)." },
  { name: "to", type: "string", description: "ISO 8601 end (with preset=custom)." },
  { name: "q", type: "string", description: "Free-text search (max 200 chars)." },
  { name: "filter", type: "string", description: "Facet filter as facetId:value (repeatable, max 25)." },
  { name: "limit", type: "integer", description: "Page size 1–100 (default 100)." },
  { name: "offset", type: "integer", description: "Offset 0–100000 (default 0)." },
  { name: "sort", type: "string", description: "Sort direction (default desc).", enum: ["desc", "asc"] }
];

const ERR = (description: string): ApiResponse => ({ description, schema: "ApiError" });

export const API_ROUTES: ApiRoute[] = [
  { method: "GET", path: "/healthz", auth: "public", knownRoute: true, summary: "Liveness probe.", tags: ["ops"],
    responses: { "200": { description: "Service is up.", schema: "HealthResponse" } } },
  { method: "GET", path: "/readyz", auth: "public", knownRoute: true, summary: "Readiness probe (telemetry storage).", tags: ["ops"],
    responses: { "200": { description: "Ready." }, "503": { description: "Not ready." } } },
  { method: "GET", path: "/version", auth: "public", knownRoute: true, summary: "Release/build info (package version + optional git sha and build time).", tags: ["ops"],
    responses: { "200": { description: "Version and build metadata." } } },
  { method: "GET", path: "/openapi.json", auth: "public", knownRoute: true, summary: "This OpenAPI 3.1 document (generated).", tags: ["ops"],
    responses: { "200": { description: "OpenAPI document." } } },
  { method: "GET", path: "/.well-known/oauth-protected-resource", auth: "public", knownRoute: true, summary: "RFC 9728 Protected Resource Metadata (when OAuth configured).", tags: ["auth"],
    responses: { "200": { description: "Metadata.", schema: "ProtectedResourceMetadata" }, "404": ERR("OAuth not configured.") } },

  { method: "POST", path: "/session", auth: "public", knownRoute: true, summary: "Exchange a token for a session cookie (hosted + UI only).", tags: ["auth"],
    request: { schema: "SessionCreateRequest" },
    responses: { "204": { description: "Session cookie set." }, "400": ERR("Invalid body."), "401": ERR("Invalid credentials."), "404": ERR("Not available.") } },
  { method: "GET", path: "/session", auth: "public", knownRoute: true, summary: "Return the current session's tenant (hosted).", tags: ["auth"],
    responses: { "200": { description: "Session info.", schema: "SessionInfo" }, "401": ERR("No valid session."), "404": ERR("Not hosted.") } },
  { method: "POST", path: "/session/logout", auth: "public", knownRoute: true, summary: "Clear the session cookie.", tags: ["auth"],
    responses: { "204": { description: "Cleared." } } },
  { method: "GET", path: "/auth/login", auth: "public", knownRoute: true, summary: "Start OIDC Authorization-Code + PKCE login (when configured).", tags: ["auth"],
    responses: { "302": { description: "Redirect to the authorization server." }, "404": ERR("Login not configured.") } },
  { method: "GET", path: "/auth/callback", auth: "public", knownRoute: true, summary: "OIDC callback: validate state, exchange code, issue session.", tags: ["auth"],
    query: [{ name: "code", type: "string", description: "Authorization code." }, { name: "state", type: "string", description: "Opaque state." }, { name: "iss", type: "string", description: "Issuer (RFC 9207)." }],
    responses: { "302": { description: "Redirect to /." }, "400": ERR("Bad request / state / issuer."), "401": ERR("Login failed."), "403": ERR("Tenant not provisioned."), "404": ERR("Login not configured.") } },

  { method: "POST", path: "/ingest/flow", auth: "ingest", knownRoute: true, summary: "Flow hosted-ingest (CONSOLE_INGEST_TOKEN).", tags: ["ingest"],
    request: { description: "FlowIngestRequest envelope (contractVersion, source, type, idempotencyKey, occurredAt, payload)." },
    responses: { "202": { description: "Accepted.", schema: "RecordIdResponse" }, "400": ERR("Invalid ingest request."), "401": ERR("Invalid token."), "404": ERR("Ingest disabled.") } },
  { method: "GET", path: "/ingest/flow/{runId}", auth: "ingest", knownRoute: false, summary: "Read the latest ingested projection for a run.", tags: ["ingest"],
    responses: { "200": { description: "Projection." }, "401": ERR("Invalid token."), "404": ERR("Not found.") } },

  { method: "GET", path: "/stream", auth: "gate", scope: "records:read", knownRoute: true, summary: "Operating-state event stream (SSE).", tags: ["records"],
    responses: { "200": { description: "Server-Sent Events stream.", contentType: "text/event-stream" }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "GET", path: "/events", auth: "gate", scope: "records:read", knownRoute: true, summary: "Event streams (SSE with Accept: text/event-stream, else JSON inspection).", tags: ["records"],
    responses: { "200": { description: "SSE stream or JSON inspection array." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "GET", path: "/state", auth: "gate", scope: "records:read", knownRoute: true, summary: "Current cross-product operating state.", tags: ["records"],
    responses: { "200": { description: "Operating state." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "GET", path: "/inspect", auth: "gate", scope: "records:read", knownRoute: true, summary: "Inspection report (event streams + projections).", tags: ["records"],
    responses: { "200": { description: "Inspection report." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "POST", path: "/records", auth: "gate", scope: "records:write", knownRoute: true, summary: "Append a console record. Additive kinds are routed by `schema`: event/projection reach the control-plane hub; kontour.console.economics and kontour.flow-agents.transition are telemetry-plane kinds folded into their per-tenant projections instead. Every kind is tenant-bound from the authenticated principal, never from the body.", tags: ["records"],
    request: { description: "ConsoleRecord (kontour.console.event | kontour.console.projection | kontour.console.liveness | kontour.console.economics | kontour.flow-agents.transition). A kontour.flow-agents.transition is one flow-agents CLI invocation exactly as its src/transition-log.ts writes it (command, verb, allowlisted identifier-flag values, flag NAMES, exit code, outcome class, duration, actor) — the OPTIONAL cost producer for GET /api/gates/scorecard. Unknown extra fields are accepted, as the producer schema declares additionalProperties: true. An unrecognized schema is a 400." },
    responses: { "202": { description: "Delivery result.", schema: "DeliveryResult" }, "400": ERR("Invalid record."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "500": ERR("Delivery failed.") } },

  { method: "GET", path: "/api/telemetry", auth: "gate", scope: "telemetry:read", knownRoute: true, summary: "Telemetry + cost/usage analytics summary (tenant-scoped).", tags: ["telemetry"],
    query: TELEMETRY_QUERY,
    responses: { "200": { description: "Telemetry summary.", schema: "TelemetrySummary" }, "400": ERR("Invalid query."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "POST", path: "/api/telemetry/records", auth: "gate", scope: "telemetry:write", knownRoute: true, summary: "Ingest a telemetry record.", tags: ["telemetry"],
    request: { schema: "TelemetryRecord" },
    responses: { "202": { description: "Delivery result.", schema: "DeliveryResult" }, "400": ERR("Invalid telemetry record."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "500": ERR("Delivery failed.") } },
  { method: "GET", path: "/api/economics", auth: "gate", scope: "economics:read", knownRoute: true, summary: "Kit-economics rollups: cost per kit/day (with paired defect counts), caught-defects, and the iteration funnel (tenant-scoped).", tags: ["economics"],
    responses: { "200": { description: "EconomicsRollup read-model." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "GET", path: "/api/economics/value", auth: "gate", scope: "economics:read", knownRoute: true, summary: "The value comparison: acceptance rate, iterations-to-accept, defects, and $/acceptable grouped by (model_tier, kit_condition); headline small+kit vs large-bare (ADR 0003 call 4).", tags: ["economics"],
    responses: { "200": { description: "ValueComparison read-model." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "GET", path: "/api/economics/delegations", auth: "gate", scope: "economics:read", knownRoute: true, summary: "Delegation efficiency per (role, model): outcome mix + acceptance rate (excluding `unavailable`), outcome coverage, and MODEL-GRANULARITY PROXY cost (no runtime isolates per-sub-agent tokens) (flow-agents #415).", tags: ["economics"],
    responses: { "200": { description: "EconomicsDelegationRollup read-model." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },

  { method: "GET", path: "/api/gates/scorecard", auth: "gate", scope: "records:read", knownRoute: true, summary: "Per-gate outcome scorecard folded from ingested Flow projections: invoked / never_invoked / unexercised / withheld / indeterminate, refusal and route-back counts, and unattributable evidence (console #277). Each entry MAY carry an optional `cost` block, enriched from kontour.flow-agents.transition records posted to /records and joined by EXPECTATION ID (disambiguated by flow id — a transition carries no gate id and no run id). Read `cost_availability` before reading any number in it: `unavailable` means no cost producer reached this gate and `cost` is null — NOT zero; `activity_only` means invocations were observed (their counts, durations and exit classes are real) but nothing attributed spend, so cost itself is still unavailable; `floor` means `cost.output_tokens_floor` is a strict LOWER BOUND, never a total. It under-attributes by construction — output tokens only (a minority of real spend, and not proportional to it), and a turn is consumed by at most one transition so a transition sharing a turn contributes nothing (`cost.attribution.transitions_without_turn`) — which is why the field is named for the floor it is and the granularity is stated in `cost.attribution.granularity`, on the economics `model-proxy` precedent. `cost.duration_ms` is latency, not spend. Layer-1 outcome counts are never derived from transitions. Transitions that could not be resolved to exactly one gate appear in `unattributable` under the `transition_*` kinds with denominators untouched, and `transition_coverage` accounts for every record folded.", tags: ["records"],
    query: [{ name: "since", type: "string", description: "Window start as an extended-format ISO 8601 timestamp with date, time including seconds, and an explicit zone (e.g. 2026-08-22T00:00:00Z); other ISO forms are rejected with 400. Older runs still contribute declared gates (shown as unexercised)." }],
    responses: { "200": { description: "GateScorecard read-model." }, "400": ERR("Invalid query."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },

  { method: "POST", path: "/api/kits/contributions", auth: "gate", scope: "records:write", knownRoute: true, summary: "Register a versioned Flow Agents Kit observability contribution for the authenticated tenant.", tags: ["kits"],
    request: { description: "KitContributionRegistration wrapping the public Flow Agents descriptor." },
    responses: { "201": { description: "Contribution registered." }, "202": { description: "Contribution quarantined with diagnostics." }, "400": ERR("Invalid body."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "503": ERR("Kit host dependency unavailable.") } },
  { method: "POST", path: "/api/kits/records", auth: "gate", scope: "records:write", knownRoute: true, summary: "Ingest or quarantine a descriptor-bound Kit observability record.", tags: ["kits"],
    request: { description: "KitRecordIngest with controlled/observational provenance and producer-owned source refs." },
    responses: { "202": { description: "Record accepted or quarantined." }, "400": ERR("Invalid body."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "503": ERR("Kit host dependency unavailable.") } },
  { method: "GET", path: "/api/kits/workspace", auth: "gate", scope: "records:read", knownRoute: true, summary: "Tenant-scoped Kit contribution registry, separate observational/controlled aggregates, runs, and quarantine diagnostics.", tags: ["kits"],
    responses: { "200": { description: "KitWorkspaceRead standard-view model." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "503": ERR("Kit host dependency unavailable.") } },
  { method: "GET", path: "/api/kits/runs/{runId}", auth: "gate", scope: "records:read", knownRoute: false, summary: "Trace a Kit aggregate back to exact run records and producer-owned source refs.", tags: ["kits"],
    responses: { "200": { description: "Traceable Kit run records." }, "400": ERR("Invalid run id."), "404": ERR("Run not found."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "503": ERR("Kit host dependency unavailable.") } },

  { method: "POST", path: "/mcp", auth: "gate", scope: "telemetry:read", knownRoute: true, summary: "MCP server (JSON-RPC 2.0) over the telemetry/cost analytics.", tags: ["mcp"],
    request: { description: "JSON-RPC 2.0 request: initialize | ping | tools/list | tools/call." },
    responses: { "200": { description: "JSON-RPC 2.0 response (result or error)." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } }
];

/** Exact paths the router treats as KNOWN_ROUTES (templated paths excluded). */
export function registryKnownRoutePaths(): string[] {
  return [...new Set(API_ROUTES.filter((r) => r.knownRoute !== false).map((r) => r.path))];
}

/** Required scope for (method, exact path) per the registry, or undefined. */
export function registryScopeFor(method: string, pathname: string): ConsoleScope | undefined {
  return API_ROUTES.find((r) => r.method === method.toUpperCase() && r.path === pathname)?.scope;
}
