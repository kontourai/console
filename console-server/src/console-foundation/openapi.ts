// Assembles the OpenAPI 3.1 document for the console API FROM the route registry
// (api-registry.ts) and the JSON Schemas generated from the TS types
// (openapi/schemas.generated.json). Nothing here is a hand-authored copy of the
// API shape — paths/scopes come from the registry, data schemas from the types.
// Served live at GET /openapi.json.
import { API_ROUTES, type ApiRoute, type ApiResponse } from "./api-registry";
import { GENERATED_DEFINITIONS } from "./openapi/schemas.generated";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// Small auxiliary response/request shapes not modeled as TS interfaces. Kept
// minimal and stable; the data-rich types (TelemetrySummary, etc.) are generated.
const AUX_SCHEMAS: Record<string, unknown> = {
  ApiError: {
    type: "object",
    properties: {
      error: { type: "string", description: "Stable error code (e.g. UNAUTHORIZED, INSUFFICIENT_SCOPE)." },
      safeMessage: { type: "string" },
      validation: { type: "array", items: ref("ValidationIssue") }
    },
    required: ["error", "safeMessage"]
  },
  HealthResponse: { type: "object", properties: { ok: { type: "boolean" }, mode: { type: "string", enum: ["local", "hosted"] } }, required: ["ok", "mode"] },
  ProtectedResourceMetadata: {
    type: "object",
    properties: {
      resource: { type: "string" },
      authorization_servers: { type: "array", items: { type: "string" } },
      bearer_methods_supported: { type: "array", items: { type: "string" } },
      scopes_supported: { type: "array", items: { type: "string" } }
    }
  },
  SessionCreateRequest: { type: "object", properties: { token: { type: "string" }, tenant: { type: "string" } }, required: ["token"] },
  SessionInfo: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
  RecordIdResponse: { type: "object", properties: { recordId: { type: "string" } }, required: ["recordId"] }
};

/** Rewrite generated draft-07 `#/definitions/X` refs to OpenAPI `#/components/schemas/X`. */
function componentSchemasFromGenerated(): Record<string, unknown> {
  const rewritten = JSON.stringify(GENERATED_DEFINITIONS).replace(/#\/definitions\//g, "#/components/schemas/");
  return JSON.parse(rewritten) as Record<string, unknown>;
}

function responseObject(r: ApiResponse, code: string): Record<string, unknown> {
  const out: Record<string, unknown> = { description: r.description };
  const hasBody = Boolean(r.schema) || (code.startsWith("2") && r.contentType !== "text/event-stream");
  if (r.schema) {
    out.content = { [r.contentType ?? "application/json"]: { schema: ref(r.schema) } };
  } else if (r.contentType === "text/event-stream") {
    out.content = { "text/event-stream": { schema: { type: "string", description: "Server-Sent Events stream." } } };
  } else if (hasBody) {
    out.content = { "application/json": { schema: { type: "object" } } };
  } else if (code !== "204" && code !== "302") {
    out.content = { "application/json": { schema: ref("ApiError") } };
  }
  return out;
}

function operationFor(route: ApiRoute): Record<string, unknown> {
  const op: Record<string, unknown> = { summary: route.summary, tags: route.tags };
  if (route.auth === "gate") {
    op.security = [{ oauth2: route.scope ? [route.scope] : [] }, { bearerToken: [] }, { sessionCookie: [] }];
  } else if (route.auth === "ingest") {
    op.security = [{ ingestToken: [] }];
  } else {
    op.security = [];
  }
  const parameters: unknown[] = [];
  for (const m of route.path.matchAll(/\{(\w+)\}/g)) {
    parameters.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
  }
  for (const q of route.query ?? []) {
    parameters.push({ name: q.name, in: "query", required: false, description: q.description, schema: { type: q.type, ...(q.enum ? { enum: q.enum } : {}) } });
  }
  if (parameters.length) op.parameters = parameters;
  if (route.request) {
    op.requestBody = {
      required: true,
      ...(route.request.description ? { description: route.request.description } : {}),
      content: { "application/json": { schema: route.request.schema ? ref(route.request.schema) : { type: "object" } } }
    };
  }
  op.responses = Object.fromEntries(Object.entries(route.responses).map(([code, r]) => [code, responseObject(r, code)]));
  return op;
}

export function buildOpenApiDocument(options: { serverUrl?: string; version?: string } = {}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of API_ROUTES) {
    (paths[route.path] ??= {})[route.method.toLowerCase()] = operationFor(route);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Kontour Console API",
      version: options.version ?? "0.1.0",
      description: "Console HTTP API: telemetry + cost/usage analytics, records, OAuth 2.1 / OIDC auth, and an MCP server. Generated from the in-code route registry + TypeScript types."
    },
    servers: options.serverUrl ? [{ url: options.serverUrl }] : [],
    paths,
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          description: "OIDC access token (JWT) issued by the configured authorization server, audience-bound to the console (RFC 8707). Scopes are enforced per-route.",
          flows: {
            authorizationCode: {
              authorizationUrl: "https://<your-oauth-issuer>/authorize",
              tokenUrl: "https://<your-oauth-issuer>/token",
              scopes: {
                "telemetry:read": "Read telemetry + cost analytics",
                "telemetry:write": "Ingest telemetry records",
                "records:read": "Read console records / state / streams",
                "records:write": "Append console records",
                "pricing:read": "Read the pricing registry",
                "economics:read": "Read kit-economics rollups + the value comparison"
              }
            }
          }
        },
        bearerToken: { type: "http", scheme: "bearer", description: "Opaque hosted/local API token (legacy; full access, not scope-gated)." },
        sessionCookie: { type: "apiKey", in: "cookie", name: "console_session", description: "Signed session cookie (browser)." },
        ingestToken: { type: "http", scheme: "bearer", description: "Dedicated CONSOLE_INGEST_TOKEN for the Flow ingest endpoints." }
      },
      schemas: { ...AUX_SCHEMAS, ...componentSchemasFromGenerated() }
    }
  };
}
