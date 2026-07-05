// Declarative registry of the console HTTP API (ADR 0003 / API docs).
//
// This is the single source the OpenAPI document is GENERATED from (see
// openapi.ts) — paths, auth, scopes, and request/response schema refs. A drift
// test (openapi.test.ts) binds it to the real router: registry paths must equal
// KNOWN_ROUTES and registry scopes must equal requiredScopeForRoute(), so the
// published spec can never silently disagree with the server. Response schema
// refs point at definitions generated FROM the TS types
// (openapi/schemas.generated.json), so data shapes are code-derived, not authored.

export type ConsoleScope = "telemetry:read" | "telemetry:write" | "records:read" | "records:write" | "pricing:read" | "economics:read";

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
  { method: "POST", path: "/records", auth: "gate", scope: "records:write", knownRoute: true, summary: "Append a console event/projection record.", tags: ["records"],
    request: { description: "ConsoleRecord (kontour.console.event | kontour.console.projection)." },
    responses: { "202": { description: "Delivery result.", schema: "DeliveryResult" }, "400": ERR("Invalid record."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "500": ERR("Delivery failed.") } },

  { method: "GET", path: "/api/telemetry", auth: "gate", scope: "telemetry:read", knownRoute: true, summary: "Telemetry + cost/usage analytics summary (tenant-scoped).", tags: ["telemetry"],
    query: TELEMETRY_QUERY,
    responses: { "200": { description: "Telemetry summary.", schema: "TelemetrySummary" }, "400": ERR("Invalid query."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "POST", path: "/api/telemetry/records", auth: "gate", scope: "telemetry:write", knownRoute: true, summary: "Ingest a telemetry record.", tags: ["telemetry"],
    request: { schema: "TelemetryRecord" },
    responses: { "202": { description: "Delivery result.", schema: "DeliveryResult" }, "400": ERR("Invalid telemetry record."), "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant."), "500": ERR("Delivery failed.") } },
  { method: "GET", path: "/api/telemetry/pricing", auth: "gate", scope: "pricing:read", knownRoute: true, summary: "Versioned model pricing registry.", tags: ["telemetry"],
    responses: { "200": { description: "Pricing registry." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },

  { method: "GET", path: "/api/economics", auth: "gate", scope: "economics:read", knownRoute: true, summary: "Kit-economics rollups: cost per kit/day (with paired defect counts), caught-defects, and the iteration funnel (tenant-scoped).", tags: ["economics"],
    responses: { "200": { description: "EconomicsRollup read-model." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },
  { method: "GET", path: "/api/economics/value", auth: "gate", scope: "economics:read", knownRoute: true, summary: "The value comparison: acceptance rate, iterations-to-accept, defects, and $/acceptable grouped by (model_tier, kit_condition); headline small+kit vs large-bare (ADR 0003 call 4).", tags: ["economics"],
    responses: { "200": { description: "ValueComparison read-model." }, "401": ERR("Unauthorized."), "403": ERR("Insufficient scope / tenant.") } },

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
