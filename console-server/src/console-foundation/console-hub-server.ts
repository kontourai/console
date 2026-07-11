import http = require("node:http");
import fs = require("node:fs");
import type { IncomingMessage, Server, ServerResponse } from "node:http";
const path = require("node:path");
const { DEFAULT_CONSOLE_RUNTIME_ROOT } = require("./runtime-root");
const crypto = require("node:crypto");
import { assertConsoleRuntimeConfig, resolveConsoleRuntimeConfig, type ConsoleRuntimeConfig } from "./config";
import { createSseBroker, openSseResponse, writeSse, type SseBroker } from "./sse-stream";
import { createOptionalPgClient, createTelemetryStore, parseTelemetryQuery, validateTelemetryRecordBody, type TelemetryStore } from "./telemetry";
import { createRevocationStore, newSessionId, type RevocationStore } from "./session-revocation";
import { validateFlowIngestRequest, wrapFlowIngestRecord } from "./flow-ingest";
import { isLivenessRecord, normalizeLivenessRecord, validateLivenessRecord, LIVENESS_SCHEMA } from "./liveness";
import { getRegistry } from "@kontourai/telemetry";
import type {
  ConsoleEconomicsRecord,
  ConsoleEventRecord,
  ConsoleLivenessRecord,
  ConsoleRecord,
  ConsoleHubServer,
  ConsoleHubServerOptions,
  ConsolePrincipal,
  ConsoleRequestContext,
  ConsoleSqlClient,
  CurrentOperatingStateOptions,
  DeliveryResult,
  Hub,
  InspectionReport,
  ListenOptions,
  OperatingState,
  OpenRecord,
  RequestError,
  ValidationIssue
} from "./types";
import { createEconomicsStore, type EconomicsStore } from "./economics-store";
import { createEconomicsProjection, type EconomicsProjection } from "./economics-projection";
import { CoreRecordsRepository } from "./core-records";
import { EconomicsRecordsRepository } from "./economics-records";
import { looksLikeJwt, verifyAccessToken, verifyOidcIdToken, protectedResourceMetadata } from "./oauth-resource";
import { buildAuthorizeRedirect, exchangeCodeForToken, signLoginState, verifyLoginState } from "./oidc-login";
import { handleMcpRequest } from "./mcp-server";
import { buildOpenApiDocument } from "./openapi";

const { LocalConsoleHub } = require("./console-hub");

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3737;
const MAX_BODY_BYTES = 1024 * 1024;
export const KNOWN_ROUTES = ["/events", "/stream", "/state", "/inspect", "/records", "/ingest/flow", "/api/telemetry", "/api/telemetry/records", "/api/telemetry/pricing", "/api/economics", "/api/economics/value", "/api/economics/delegations", "/healthz", "/readyz", "/session", "/session/logout", "/.well-known/oauth-protected-resource", "/auth/login", "/auth/callback", "/mcp", "/openapi.json"];

/** Matches `/ingest/flow/<runId>` (the read-only projection-fetch path). */
const INGEST_FLOW_RUN_PREFIX = "/ingest/flow/";
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173"
];

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

/**
 * Session cookie name for the hosted-mode browser session gate.
 *
 * Cookie design (stateless + signed):
 *   Value = base64url(tenantId) "." timestampMs "." HMAC-SHA256
 *
 * The HMAC input is: "<base64url(tenantId)>.<timestampMs>".
 * The HMAC key is derived per-token-config:
 *   SHA256( "console-session-v1:" + authToken )
 *
 * Validation steps:
 *   1. Parse the three-part cookie value.
 *   2. Decode the tenantId and find a matching hosted auth token config.
 *   3. Re-derive the signing key from that token's secret.
 *   4. Recompute HMAC and compare in constant time.
 *   5. (Token config still present in config = credential still valid.)
 *
 * Session cookies are HttpOnly; Secure; SameSite=Strict; Path=/
 * They have no server-side state — revoking a token in config instantly
 * invalidates all cookies derived from it.
 */
const SESSION_COOKIE_NAME = "console_session";

/**
 * Session cookie max-age in seconds (30 days).
 * Operators can rotate tokens sooner to force re-login.
 */
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Resolve the console-ui dist directory.
 *
 * Resolution order:
 * 1. CONSOLE_UI_DIST env var override — lets operators point to a custom build.
 * 2. Relative to __dirname: four levels up, then console-ui/dist.
 *    This works for both layouts:
 *      - Repo:      <root>/console-server/src/console-foundation/  → 3× .. → <root>/  → console-ui/dist
 *      - Published: <root>/console-server/dist/src/console-foundation/ → 4× .. → <root>/ → console-ui/dist
 *    In both cases path.resolve(__dirname, "../../../../console-ui/dist") resolves correctly
 *    because the TypeScript source mirrors the compiled output structure.
 *
 * Returns the resolved path string (which may or may not exist — callers check).
 */
export function resolveUiDistDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONSOLE_UI_DIST) return path.resolve(env.CONSOLE_UI_DIST);
  return path.resolve(__dirname, "../../../../console-ui/dist");
}

export function createConsoleHubServer(options: ConsoleHubServerOptions = {}): ConsoleHubServer {
  const runtimeConfig = resolveConsoleRuntimeConfig(options);
  assertConsoleRuntimeConfig(runtimeConfig);
  const hub = options.hub || new LocalConsoleHub(options);
  const localEvents = createSseBroker();
  const hostedHubs = new Map<string, Hub>();
  const hostedEvents = new Map<string, SseBroker>();
  // Per-tenant economics store + rebuildable projection (console #117, ADR 0003
  // calls 1/3). Keyed by the authoritative tenantId, exactly like `hostedHubs`;
  // isolation (AC6) is therefore by construction — one tenant never sees
  // another's economics. Local mode stays the in-memory v1 (mirrors telemetry's
  // local adapter); hosted mode is Postgres-backed (console #155) so the
  // Economics read-models survive redeploys and re-relays dedup on run_id.
  const economics = new Map<string, TenantEconomics>();
  // Flow ingest in-memory dedup + read store, scoped to this server instance.
  // `ingestSeen` maps idempotencyKey -> the recordId returned the first time, so
  // a re-POST is a no-op that returns the same recordId (no second append).
  // `ingestProjections` maps runId -> the most recently ingested
  // FlowConsoleProjection, backing the read-only GET /ingest/flow/:runId.
  // In-memory is fine for v1; persistence (Postgres) is a follow-up — the hub
  // already persists the wrapped records, so a restart loses only the read cache.
  const ingestState: FlowIngestServerState = {
    seen: new Map<string, string>(),
    projections: new Map<string, unknown>()
  };
  const telemetry = createTelemetryStore(options);
  // Resolve the SQL client once so it can be shared between telemetry and the
  // core-records persistence layer.  In hosted mode the postgres adapter is
  // required (assertConsoleRuntimeConfig enforces this), so the client will
  // always be present there.  Local mode never wires one (options.telemetrySqlClient
  // is absent and no DATABASE_URL is set), so coreSqlClient is undefined and
  // PostgresConsoleHub falls back gracefully to the local-file hub.
  const coreSqlClient: ConsoleSqlClient | undefined =
    options.telemetrySqlClient ??
    createOptionalPgClient(
      runtimeConfig.mode === "hosted"
        ? (options.telemetryDatabaseUrl || process.env.CONSOLE_DATABASE_URL || process.env.CONSOLE_TELEMETRY_DATABASE_URL)
        : undefined
    );
  // Per-session revocation store (#104): Postgres-backed in hosted mode (durable +
  // shared across instances), in-memory in local mode. Reuses the resolved SQL client.
  const revocationStore = createRevocationStore(coreSqlClient);
  const uiDistDir = resolveUiDistDir();
  const server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
    routeRequest({
      localHub: hub,
      localEvents,
      hostedHubs,
      hostedEvents,
      economics,
      telemetry,
      ingestState,
      options,
      runtimeConfig,
      coreSqlClient,
      revocationStore,
      uiDistDir,
      request,
      response
    });
  });

  return {
    hub,
    server,
    listen(listenOptions: ListenOptions = {}, callback?: () => void) {
      const host = listenOptions.host || options.host || DEFAULT_HOST;
      const port = Number(listenOptions.port ?? options.port ?? DEFAULT_PORT);
      return server.listen(port, host, callback);
    },
    close(callback?: (error?: Error) => void) {
      localEvents.closeAll();
      for (const broker of hostedEvents.values()) broker.closeAll();
      return server.close((error?: Error) => {
        telemetry.close();
        callback?.(error);
      });
    }
  };
}

/**
 * Per-server in-memory state backing the Flow ingest endpoint.
 *   - `seen`: idempotencyKey -> recordId returned on first accept (dedup).
 *   - `projections`: runId -> latest ingested FlowConsoleProjection (read cache).
 * The wrapped records themselves are persisted by the hub; this is the v1
 * read/dedup cache only. Persistence is a documented follow-up.
 */
interface FlowIngestServerState {
  seen: Map<string, string>;
  projections: Map<string, unknown>;
}

async function routeRequest(input: {
  localHub: Hub;
  localEvents: SseBroker;
  hostedHubs: Map<string, Hub>;
  hostedEvents: Map<string, SseBroker>;
  economics: Map<string, TenantEconomics>;
  telemetry: TelemetryStore;
  ingestState: FlowIngestServerState;
  options: ConsoleHubServerOptions;
  runtimeConfig: ConsoleRuntimeConfig;
  coreSqlClient?: ConsoleSqlClient;
  revocationStore: RevocationStore;
  uiDistDir: string;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const { telemetry, ingestState, economics, options, runtimeConfig, coreSqlClient, revocationStore, uiDistDir, request, response } = input;
  const url = new URL(request.url || "/", `http://${request.headers.host || DEFAULT_HOST}`);
  if (!applyCorsPolicy(request, response, runtimeConfig)) return;

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      writeJson(response, 200, { ok: true, mode: runtimeConfig.mode });
      return;
    }

    if (request.method === "GET" && url.pathname === "/readyz") {
      const readiness = await telemetry.ready();
      writeJson(response, readiness.ok ? 200 : 503, readiness);
      return;
    }

    // OpenAPI 3.1 document — public, generated from the route registry + types.
    if (request.method === "GET" && url.pathname === "/openapi.json") {
      writeJson(response, 200, buildOpenApiDocument({ serverUrl: `${url.protocol}//${url.host}` }));
      return;
    }

    // RFC 9728 Protected Resource Metadata (ADR 0003) — public, no auth gate.
    // Lets MCP / OAuth clients discover the authorization server. Disabled (404)
    // unless an OAuth provider is configured.
    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      if (!runtimeConfig.oauth) {
        writeApiError(response, 404, "NOT_FOUND", "protected resource metadata is not configured");
        return;
      }
      writeJson(response, 200, protectedResourceMetadata(runtimeConfig.oauth));
      return;
    }

    // Session routes — handled before the auth gate and before static asset serving.
    // POST /session: validate {token, tenant} body and issue a session cookie (hosted + dist only).
    // GET /session: check cookie, return {tenantId} (exempt from gate — used by UI on startup).
    // POST /session/logout: clear the session cookie.
    if (request.method === "POST" && url.pathname === "/session") {
      await handleSessionCreate(request, response, runtimeConfig, uiDistDir);
      return;
    }

    if (request.method === "GET" && url.pathname === "/session") {
      await handleSessionCheck(request, response, runtimeConfig, revocationStore);
      return;
    }

    if (request.method === "POST" && url.pathname === "/session/logout") {
      await handleSessionLogout(request, response, runtimeConfig, revocationStore);
      return;
    }

    // OIDC login (ADR 0003, Phase 2c) — public, before the auth gate. Inert (404)
    // unless OAuth + login are configured.
    if (request.method === "GET" && url.pathname === "/auth/login") {
      await handleOAuthLogin(response, runtimeConfig);
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/callback") {
      await handleOAuthCallback(request, response, url, runtimeConfig);
      return;
    }

    // Flow hosted-ingest contract v1 (POST /ingest/flow, GET /ingest/flow/:runId).
    // Guarded by its OWN per-product bearer token (CONSOLE_INGEST_TOKEN), NOT the
    // hosted-auth tokens or the browser session — Flow's HostedConsoleSink pushes
    // with a dedicated token. Handled before the general auth gate and static
    // serving. When no ingest token is configured the endpoint is DISABLED (404).
    if (url.pathname === "/ingest/flow" || url.pathname.startsWith(INGEST_FLOW_RUN_PREFIX)) {
      const ingestHub = runtimeConfig.mode === "hosted"
        ? hostedHubForTenant(input.hostedHubs, options, runtimeConfig.defaultTenantId, coreSqlClient)
        : input.localHub;
      const ingestEvents = runtimeConfig.mode === "hosted"
        ? hostedEventsForTenant(input.hostedEvents, runtimeConfig.defaultTenantId)
        : input.localEvents;
      await handleFlowIngestRoute(url, request, response, runtimeConfig, ingestHub, ingestEvents, ingestState);
      return;
    }

    // Serve static UI assets before auth — only when the UI dist is present
    // (opt-in via bundled build) and not disabled via CONSOLE_SERVE_UI=0 /
    // --no-ui (serveUi option).
    const serveUi = resolveServeUi(options);

    // Hosted mode + dist present: apply the session gate to HTML pages.
    // Static JS/CSS assets are served without a session so cache-hinted
    // bundles don't stale-lock behind auth; index.html IS gated — it's the
    // application entry point. See docs/deployment/hosted-console.md.
    if (
      serveUi &&
      runtimeConfig.mode === "hosted" &&
      fs.existsSync(uiDistDir) &&
      request.method === "GET" &&
      !isKnownRoute(url.pathname)
    ) {
      const decodedPath = safeDecodePath(url.pathname);
      const isHtmlRequest = !decodedPath || decodedPath === "/" || !path.extname(decodedPath);
      if (isHtmlRequest) {
        const sessionContext = await verifySessionActive(request, runtimeConfig, revocationStore);
        if (!sessionContext) {
          serveSessionGatePage(response);
          return;
        }
      }
    }

    // Serve static UI assets (non-HTML always, HTML only when gated above).
    if (serveUi && request.method === "GET" && !isKnownRoute(url.pathname)) {
      const served = await serveStaticAsset(uiDistDir, url.pathname, response, runtimeConfig);
      if (served) return;
    }

    const auth = await authenticateRequest(request, runtimeConfig, options, revocationStore);
    if (!auth.ok) {
      writeApiError(response, auth.statusCode, auth.error, auth.safeMessage);
      return;
    }
    const context = auth.context;
    // Scope authorization (ADR 0003, Phase 2): enforce scopes whenever the
    // credential CARRIES them — JWT clients, AND OIDC-issued sessions (whose
    // access-token scopes are embedded in the session cookie). Legacy credentials
    // that carry no scopes (token-issued session, opaque bearer token, loopback
    // local) keep full access for back-compat. An unknown method with no scopes
    // is NOT exempt, so it fails safe into enforcement.
    const scopeExempt = context.scopes === undefined
      && (context.authMethod === "local" || context.authMethod === "session" || context.authMethod === "token");
    if (!scopeExempt) {
      const requiredScope = requiredScopeForRoute(request.method || "GET", url.pathname);
      // scopes come from the principal when present (verified JWT/M2M), else from the
      // context (OIDC session cookie). requireScope alone is not sufficient here
      // because scope-carrying sessions have no principal; keep the context fallback.
      const grantedScopes = context.principal?.scopes ?? context.scopes ?? [];
      if (requiredScope && !grantedScopes.includes(requiredScope)) {
        response.setHeader("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${requiredScope}"`);
        writeApiError(response, 403, "INSUFFICIENT_SCOPE", `missing required scope: ${requiredScope}`);
        return;
      }
    }
    const hub = runtimeConfig.mode === "hosted" ? hostedHubForTenant(input.hostedHubs, options, context.tenantId, coreSqlClient) : input.localHub;
    const events = runtimeConfig.mode === "hosted" ? hostedEventsForTenant(input.hostedEvents, context.tenantId) : input.localEvents;
    // Economics durability (console #155) is hosted-only: local mode keeps the
    // exact in-memory v1 behaviour even when a SQL client is injected for tests.
    const economicsSqlClient = runtimeConfig.mode === "hosted" ? coreSqlClient : undefined;

    // MCP server (ADR 0003, Phase 3): JSON-RPC over POST, behind the auth gate +
    // telemetry:read scope. Tools are tenant-scoped via the request context.
    if (request.method === "POST" && url.pathname === "/mcp") {
      let message: unknown;
      try {
        message = await readJsonBody(request);
      } catch {
        writeJson(response, 200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        return;
      }
      const mcpResponse = await handleMcpRequest(message, { telemetry, requestContext: context });
      if (mcpResponse === null) {
        response.writeHead(202, { "cache-control": "no-store" });
        response.end();
        return;
      }
      writeJson(response, 200, mcpResponse);
      return;
    }

    if (request.method === "GET" && (url.pathname === "/stream" || url.pathname === "/events")) {
      // Await the initial Postgres load so SSE late-join state reflects full history.
      if ((hub as any).readyForState) await (hub as any).readyForState();
      handleEvents(hub, events, request, response, url.pathname);
      return;
    }

    if (request.method === "GET" && url.pathname === "/state") {
      // Await the initial Postgres load so /state reflects full history after restarts.
      if ((hub as any).readyForState) await (hub as any).readyForState();
      writeJson(response, 200, hub.currentOperatingState());
      return;
    }

    if (request.method === "GET" && url.pathname === "/inspect") {
      writeJson(response, 200, hub.inspect());
      return;
    }

    if (request.method === "POST" && url.pathname === "/records") {
      await handleRecords(hub, events, request, response, context, () => economicsForTenant(economics, context.tenantId, economicsSqlClient));
      return;
    }

    // Economics read-models (console #117, ADR 0003 calls 3 + 4). Rebuildable
    // projections, tenant-scoped by construction via the per-tenant map. Gated by
    // the economics:read scope (reuses the #98 per-route scope pattern).
    // Hosted (#155): fail closed — if the Postgres cold load failed, return 503
    // rather than presenting an empty projection as truth. The next request
    // retries the load.
    if (request.method === "GET" && url.pathname === "/api/economics") {
      const entry = economicsForTenant(economics, context.tenantId, economicsSqlClient);
      if (!(await entry.ensureLoaded())) {
        writeEconomicsUnavailable(response);
        return;
      }
      writeJson(response, 200, entry.projection.materialize(context.tenantId));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/economics/value") {
      const entry = economicsForTenant(economics, context.tenantId, economicsSqlClient);
      if (!(await entry.ensureLoaded())) {
        writeEconomicsUnavailable(response);
        return;
      }
      writeJson(response, 200, entry.projection.materializeValue(context.tenantId));
      return;
    }

    // Delegation efficiency (flow-agents #415): per-(role, model) outcome rollups +
    // MODEL-GRANULARITY PROXY cost. Same rebuildable projection, tenant-scoped.
    if (request.method === "GET" && url.pathname === "/api/economics/delegations") {
      const entry = economicsForTenant(economics, context.tenantId, economicsSqlClient);
      if (!(await entry.ensureLoaded())) {
        writeEconomicsUnavailable(response);
        return;
      }
      writeJson(response, 200, entry.projection.materializeDelegations(context.tenantId));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/telemetry") {
      const telemetryQuery = parseTelemetryQuery(url.searchParams);
      writeJson(response, 200, await telemetry.summarize(context, telemetryQuery));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/telemetry/pricing") {
      // Console is the pricing distribution hub: serve the live versioned
      // registry (the TELEMETRY_PRICING_URL target for runtimes + the UI).
      writeJson(response, 200, getRegistry());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/telemetry/records") {
      await handleTelemetryRecords(telemetry, events, request, response, context);
      return;
    }

    if (isKnownRoute(url.pathname)) {
      handleKnownRouteMethodError(response);
      return;
    }

    writeApiError(response, 404, "NOT_FOUND", "route was not found");
  } catch (error) {
    const requestError = error as RequestError;
    writeApiError(response, requestError.statusCode || 400, requestError.code || "BAD_REQUEST", requestError.safeMessage || "request could not be processed", requestError.validation);
  }
}

// ---------------------------------------------------------------------------
// Session gate handlers
// ---------------------------------------------------------------------------

/**
 * POST /session — validate {token, tenant} JSON body against hosted auth config
 * and issue a signed HttpOnly session cookie on success.
 *
 * Returns 204 on success, 401 on any credential failure (no disclosure of which
 * field was wrong), 400 on malformed request, 404 when gate is not active.
 */
async function handleSessionCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtimeConfig: ConsoleRuntimeConfig,
  uiDistDir: string
): Promise<void> {
  // Gate only active in hosted mode with a bundled UI present.
  if (runtimeConfig.mode !== "hosted" || !fs.existsSync(uiDistDir)) {
    writeApiError(response, 404, "NOT_FOUND", "route was not found");
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    writeApiError(response, 400, "INVALID_JSON", "invalid JSON body");
    return;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    writeApiError(response, 400, "INVALID_BODY", "request body must be a JSON object");
    return;
  }

  const { token, tenant } = body as Record<string, unknown>;
  if (typeof token !== "string" || !token) {
    // Generic message — do not reveal which field failed.
    writeApiError(response, 401, "UNAUTHORIZED", "credentials are invalid");
    return;
  }

  // Find matching token config.
  const tokenConfig = runtimeConfig.hostedAuthTokens.find((candidate) =>
    tokenMatches(candidate.token, token)
  );
  if (!tokenConfig) {
    writeApiError(response, 401, "UNAUTHORIZED", "credentials are invalid");
    return;
  }

  // If tenant was supplied, it must match the token's tenant.
  if (typeof tenant === "string" && tenant && tenant !== tokenConfig.tenantId) {
    writeApiError(response, 401, "UNAUTHORIZED", "credentials are invalid");
    return;
  }

  // Issue signed session cookie.
  const cookieValue = signSessionCookie(tokenConfig.tenantId, runtimeConfig);
  const cookieHeader = buildSessionCookieHeader(cookieValue, SESSION_COOKIE_MAX_AGE_SECONDS);
  response.writeHead(204, {
    "set-cookie": cookieHeader,
    "cache-control": "no-store"
  });
  response.end();
}

/**
 * GET /session — return {tenantId} if a valid session cookie is present, else 401.
 * This endpoint is exempt from the HTML gate so the UI can check it on startup.
 */
async function handleSessionCheck(
  request: IncomingMessage,
  response: ServerResponse,
  runtimeConfig: ConsoleRuntimeConfig,
  revocationStore: RevocationStore
): Promise<void> {
  if (runtimeConfig.mode !== "hosted") {
    writeApiError(response, 404, "NOT_FOUND", "route was not found");
    return;
  }
  const sessionContext = await verifySessionActive(request, runtimeConfig, revocationStore);
  if (!sessionContext) {
    writeApiError(response, 401, "UNAUTHORIZED", "no valid session");
    return;
  }
  writeJson(response, 200, { tenantId: sessionContext.tenantId });
}

/**
 * POST /session/logout — revoke the session server-side (#104), then clear the
 * cookie. Revoking the sid means a stolen copy of the cookie can't be replayed
 * after logout, even before its signed max-age expires. Idempotent (204).
 */
async function handleSessionLogout(
  request: IncomingMessage,
  response: ServerResponse,
  runtimeConfig: ConsoleRuntimeConfig,
  revocationStore: RevocationStore
): Promise<void> {
  const sessionContext = verifySessionCookie(request, runtimeConfig);
  if (sessionContext) {
    // Revoke until the session's signed max-age would have elapsed — the cookie is
    // worthless after that anyway (server-side max-age), so this fully covers it.
    await revocationStore.revoke(
      sessionContext.sid,
      sessionContext.tenantId,
      Date.now() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000
    );
  }
  response.writeHead(204, {
    "set-cookie": buildSessionCookieHeader("", 0),
    "cache-control": "no-store"
  });
  response.end();
}

// --- OIDC login (ADR 0003, Phase 2c) ---------------------------------------

const OAUTH_STATE_COOKIE_NAME = "console_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 600;

function buildOauthStateCookieHeader(value: string, maxAge: number): string {
  // SameSite=Lax so the cookie survives the top-level redirect back from the IdP.
  return `${OAUTH_STATE_COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}; Secure`;
}

/** Error exit from the callback that always clears the (now stale) state cookie. */
function failOAuthCallback(response: ServerResponse, status: number, code: string, message: string): void {
  response.setHeader("set-cookie", buildOauthStateCookieHeader("", 0));
  writeApiError(response, status, code, message);
}

/** GET /auth/login — start the OIDC Authorization-Code + PKCE flow. */
async function handleOAuthLogin(response: ServerResponse, runtimeConfig: ConsoleRuntimeConfig): Promise<void> {
  if (!runtimeConfig.oauth || !runtimeConfig.oauthLogin) {
    writeApiError(response, 404, "NOT_FOUND", "login is not configured");
    return;
  }
  const redirect = buildAuthorizeRedirect(runtimeConfig.oauthLogin, runtimeConfig.oauth);
  const stateCookie = signLoginState(redirect.state, redirect.codeVerifier, redirect.nonce, runtimeConfig.oauthLogin.stateSecret, Date.now());
  response.writeHead(302, {
    location: redirect.url,
    "set-cookie": buildOauthStateCookieHeader(stateCookie, OAUTH_STATE_MAX_AGE_SECONDS),
    "cache-control": "no-store"
  });
  response.end();
}

/** GET /auth/callback — validate state, exchange the code, and issue a session. */
async function handleOAuthCallback(request: IncomingMessage, response: ServerResponse, url: URL, runtimeConfig: ConsoleRuntimeConfig): Promise<void> {
  if (!runtimeConfig.oauth || !runtimeConfig.oauthLogin) {
    writeApiError(response, 404, "NOT_FOUND", "login is not configured");
    return;
  }
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  if (!code || !stateParam) {
    failOAuthCallback(response, 400, "INVALID_REQUEST", "missing code or state");
    return;
  }
  // RFC 9207 — if the AS returned an issuer, it must match the configured one.
  const issParam = url.searchParams.get("iss");
  if (issParam && issParam !== runtimeConfig.oauth.issuer) {
    failOAuthCallback(response, 400, "INVALID_ISS", "issuer mismatch");
    return;
  }
  const cookieValue = request.headers.cookie ? parseCookieValue(request.headers.cookie, OAUTH_STATE_COOKIE_NAME) : null;
  const stored = cookieValue ? verifyLoginState(cookieValue, runtimeConfig.oauthLogin.stateSecret, Date.now()) : null;
  if (!stored || stored.state !== stateParam) {
    failOAuthCallback(response, 400, "INVALID_STATE", "login state is invalid or expired");
    return;
  }
  let tenantId: string;
  let scopes: string[];
  try {
    const tokens = await exchangeCodeForToken(runtimeConfig.oauthLogin, code, stored.codeVerifier, runtimeConfig.oauth);
    // When `openid` was requested, validate the id_token as the authentication
    // assertion (OIDC Core): signature, iss, aud=client_id, exp, our nonce, and the
    // at_hash binding to the access token (blocks access-token substitution).
    if (runtimeConfig.oauthLogin.scopes.includes("openid")) {
      if (!tokens.id_token) throw new Error("missing id_token (openid scope requested)");
      await verifyOidcIdToken(tokens.id_token, runtimeConfig.oauth, {
        audience: runtimeConfig.oauthLogin.clientId,
        nonce: stored.nonce,
        accessToken: tokens.access_token
      });
    }
    // We run as a combined Relying Party + Resource Server: the access token is a
    // JWT minted by our AS, audience-bound to this console (RFC 8707) and carrying
    // the tenant claim — so it is a sound identity+authorization basis. (A provider
    // that issues OPAQUE access tokens will throw here; surfaced as a logged 401.)
    const verified = await verifyAccessToken(tokens.access_token, runtimeConfig.oauth);
    tenantId = verified.tenantId;
    scopes = verified.scopes;
  } catch (err) {
    console.error("[oauth] callback token exchange / verification failed:", err);
    failOAuthCallback(response, 401, "UNAUTHORIZED", "login failed");
    return;
  }
  // Authorize the tenant for a session. With a dedicated CONSOLE_SESSION_SECRET the
  // session is signed with that secret (no per-tenant hosted token needed), so we
  // gate on the tenant allowlist; without it, fall back to requiring a hosted token
  // as the signing anchor. The OIDC access-token scopes are embedded in the session
  // so scope authorization applies to the browser session too.
  if (runtimeConfig.sessionSecret) {
    // With a session secret there's no per-tenant hosted-token anchor, so the tenant
    // allowlist IS the gate — and an empty allowlist means no tenant is provisioned
    // for OIDC (deny-all), not allow-all.
    if (!runtimeConfig.hostedTenantIds.includes(tenantId)) {
      failOAuthCallback(response, 403, "TENANT_FORBIDDEN", "tenant is not allowed");
      return;
    }
  } else if (!runtimeConfig.hostedAuthTokens.some((candidate) => candidate.tenantId === tenantId)) {
    failOAuthCallback(response, 403, "TENANT_FORBIDDEN", "tenant is not provisioned");
    return;
  }
  response.writeHead(302, {
    location: "/",
    "set-cookie": [
      buildOauthStateCookieHeader("", 0),
      buildSessionCookieHeader(signSessionCookie(tenantId, runtimeConfig, scopes), SESSION_COOKIE_MAX_AGE_SECONDS)
    ],
    "cache-control": "no-store"
  });
  response.end();
}

/**
 * Serve the minimal token-entry gate page for unauthenticated HTML requests
 * in hosted mode. Zero product information disclosed. Dark Kontour-ish look.
 */
function serveSessionGatePage(response: ServerResponse): void {
  const html = buildSessionGateHtml();
  const body = Buffer.from(html, "utf8");
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    ...hostedHtmlSecurityHeaders("gate")
  });
  response.end(body);
}

function hostedHtmlSecurityHeaders(surface: "app" | "gate"): Record<string, string> {
  const sharedPolicy = "base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
  if (surface === "gate") {
    return {
      "content-security-policy": `default-src 'none'; ${sharedPolicy}; form-action 'self'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`,
      "x-frame-options": "DENY"
    };
  }
  return {
    "content-security-policy": `default-src 'self'; ${sharedPolicy}; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'`,
    "x-frame-options": "DENY"
  };
}

function buildSessionGateHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kontour Console</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#0a0e13;color:#eef3f8;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px}
body{display:flex;align-items:center;justify-content:center}
.gate{width:100%;max-width:380px;padding:2.5rem 2rem}
.kicker{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.68rem;font-weight:500;letter-spacing:.07em;text-transform:uppercase;color:#72869b;margin-bottom:.75rem}
h1{font-family:Georgia,"Times New Roman",serif;font-size:2rem;font-weight:600;letter-spacing:-.01em;line-height:1.05;color:#eef3f8;margin-bottom:1.75rem}
label{display:block;font-size:.78rem;font-weight:500;color:#aebccb;margin-bottom:.3rem}
input{display:block;width:100%;padding:.5rem .75rem;background:color-mix(in srgb,#0a0e13 86%,black);border:1px solid rgba(150,180,210,.12);border-radius:9px;color:#eef3f8;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem;margin-bottom:1rem;outline:none;transition:border-color .15s}
input:focus{border-color:#5ce0c6}
button{display:block;width:100%;padding:.6rem 1rem;background:#5ce0c6;border:none;border-radius:9px;color:#06080b;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:.9rem;font-weight:600;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.88}
.error{margin-top:1rem;font-size:.82rem;color:#ff6f6f;min-height:1.2em;text-align:center}
</style>
</head>
<body>
<div class="gate">
  <p class="kicker">Kontour Console</p>
  <h1>Sign in</h1>
  <form id="form">
    <label for="tenant">Tenant</label>
    <input id="tenant" name="tenant" autocomplete="off" spellcheck="false" placeholder="tenant-id">
    <label for="token">Token</label>
    <input id="token" name="token" type="password" autocomplete="current-password" placeholder="access token">
    <button type="submit">Continue</button>
    <div class="error" id="err" aria-live="polite"></div>
  </form>
</div>
<script>
document.getElementById('form').addEventListener('submit', async function(e) {
  e.preventDefault();
  var err = document.getElementById('err');
  err.textContent = '';
  var token = document.getElementById('token').value.trim();
  var tenant = document.getElementById('tenant').value.trim();
  if (!token) { err.textContent = 'Token is required.'; return; }
  try {
    var res = await fetch('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, tenant: tenant || undefined })
    });
    if (res.status === 204) { window.location.reload(); return; }
    err.textContent = 'Sign in failed. Check your credentials.';
  } catch (_) {
    err.textContent = 'Network error. Please try again.';
  }
});
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Session cookie signing and verification
// ---------------------------------------------------------------------------

/**
 * Derive a per-token signing key from the raw token secret.
 * key = SHA256("console-session-v1:" + rawToken)
 */
function sessionSigningKey(rawToken: string): Buffer {
  return crypto.createHash("sha256").update(`console-session-v1:${rawToken}`).digest();
}

/**
 * Resolve the HMAC key for session cookies (ADR 0003 / #104). Prefer a dedicated
 * CONSOLE_SESSION_SECRET — independent of auth tokens, so rotating a tenant's auth
 * token no longer invalidates everyone's session, and OIDC sessions don't need a
 * per-tenant hosted token to sign. Falls back to the tenant's hosted-token-derived
 * key for back-compat when no session secret is configured. Returns null when
 * neither source is available.
 */
function sessionKey(runtimeConfig: ConsoleRuntimeConfig, tenantId: string): Buffer | null {
  if (runtimeConfig.sessionSecret) {
    return crypto.createHash("sha256").update(`console-session-secret-v1:${runtimeConfig.sessionSecret}`).digest();
  }
  const tokenConfig = runtimeConfig.hostedAuthTokens.find((candidate) => candidate.tenantId === tenantId);
  return tokenConfig ? sessionSigningKey(tokenConfig.token) : null;
}

/**
 * Build a signed session cookie value for a given tenant.
 *
 * Full-access (token-issued) format: v2.base64url(tenantId).timestampMs.sid.HMAC
 * Scoped (OIDC-issued) format:        v2.base64url(tenantId).timestampMs.sid.base64url(scopes).HMAC
 * `sid` is a random per-session id (#104) that the revocation store keys on. The leading
 * `v2` is an explicit format-version marker (folded into the HMAC) so pre-#104 cookies —
 * whose 4-part scoped shape otherwise had a byte-identical HMAC input to the new 4-part
 * full-access shape — fail closed instead of being silently upgraded to full access. The
 * HMAC covers all preceding dot-joined parts. Presence of the scope segment is what makes
 * a session scope-enforced (ADR 0003, Phase 2). The signing key comes from
 * CONSOLE_SESSION_SECRET when set, else the tenant's hosted token (#104).
 */
export function signSessionCookie(tenantId: string, runtimeConfig: ConsoleRuntimeConfig, scopes?: string[]): string {
  const tenantPart = Buffer.from(tenantId, "utf8").toString("base64url");
  const tsPart = String(Date.now());
  const sid = newSessionId();
  const key = sessionKey(runtimeConfig, tenantId);
  if (!key) {
    throw new Error("no session signing key (set CONSOLE_SESSION_SECRET or a hosted auth token for the tenant)");
  }
  if (scopes === undefined) {
    const signed = `v2.${tenantPart}.${tsPart}.${sid}`;
    const sig = crypto.createHmac("sha256", key).update(signed).digest("hex");
    return `${signed}.${sig}`;
  }
  const scopePart = Buffer.from(scopes.join(" "), "utf8").toString("base64url");
  const signed = `v2.${tenantPart}.${tsPart}.${sid}.${scopePart}`;
  const sig = crypto.createHmac("sha256", key).update(signed).digest("hex");
  return `${signed}.${sig}`;
}

/**
 * Verify a session cookie value against the current runtime config.
 *
 * Returns { tenantId, scopes? } if valid, null otherwise. `scopes` is present
 * only for scoped (OIDC) sessions. Constant-time signature comparison; server-side
 * max-age enforcement (so a stolen raw cookie can't outlive the signed lifetime).
 */
export function verifySessionCookieValue(
  cookieValue: string,
  runtimeConfig: ConsoleRuntimeConfig
): { tenantId: string; scopes?: string[]; sid: string } | null {
  const parts = cookieValue.split(".");
  // v2 format (#104): v2.tenant.ts.sid.sig (5 parts, full-access) or
  // v2.tenant.ts.sid.scope.sig (6 parts, scoped OIDC). The explicit "v2" version
  // marker makes pre-#104 cookies (3/4 parts, no marker) fail closed here — old 4-part
  // scoped cookies otherwise had a byte-identical HMAC input to the new 4-part
  // full-access shape and would be silently upgraded to full access.
  if (parts[0] !== "v2") return null;
  if (parts.length !== 5 && parts.length !== 6) return null;
  const scoped = parts.length === 6;
  const tenantPart = parts[1];
  const tsPart = parts[2];
  const sid = parts[3];
  const scopePart = scoped ? parts[4] : undefined;
  const sig = scoped ? parts[5] : parts[4];
  if (!tenantPart || !tsPart || !sid || !sig) return null;
  if (!/^\d+$/.test(tsPart)) return null;

  // Server-side max-age: reject cookies older than the signed lifetime.
  const ts = Number(tsPart);
  if (!Number.isSafeInteger(ts) || Date.now() - ts > SESSION_COOKIE_MAX_AGE_SECONDS * 1000) return null;

  let tenantId: string;
  try {
    tenantId = Buffer.from(tenantPart, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!tenantId) return null;

  const key = sessionKey(runtimeConfig, tenantId);
  if (!key) return null;

  const sigInput = scoped ? `v2.${tenantPart}.${tsPart}.${sid}.${scopePart}` : `v2.${tenantPart}.${tsPart}.${sid}`;
  const expected = crypto.createHmac("sha256", key).update(sigInput).digest("hex");
  // Compare as ASCII hex — both sides are fixed-length lowercase hex, so this is
  // constant-time and never throws (unlike Buffer.from(sig, "hex") on bad input).
  const sigBuf = Buffer.from(sig, "ascii");
  const expBuf = Buffer.from(expected, "ascii");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  if (!scoped) return { tenantId, sid };
  try {
    const raw = Buffer.from(scopePart as string, "base64url").toString("utf8");
    return { tenantId, scopes: raw ? raw.split(" ").filter(Boolean) : [], sid };
  } catch {
    return null;
  }
}

/**
 * Verify a session cookie AND confirm its sid has not been revoked (#104). Returns
 * the session context or null. Used on every session-authenticated path so a
 * logged-out / revoked session is rejected even before its signed max-age expires.
 */
async function verifySessionActive(
  request: IncomingMessage,
  runtimeConfig: ConsoleRuntimeConfig,
  revocationStore: RevocationStore
): Promise<{ tenantId: string; scopes?: string[]; sid: string } | null> {
  const context = verifySessionCookie(request, runtimeConfig);
  if (!context) return null;
  if (await revocationStore.isRevoked(context.sid)) return null;
  return context;
}

/**
 * Parse the session cookie from the incoming request's Cookie header and
 * verify it. Returns the session context or null.
 */
function verifySessionCookie(
  request: IncomingMessage,
  runtimeConfig: ConsoleRuntimeConfig
): { tenantId: string; scopes?: string[]; sid: string } | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const cookieValue = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME);
  if (!cookieValue) return null;
  return verifySessionCookieValue(cookieValue, runtimeConfig);
}

function parseCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const cookieName = trimmed.slice(0, eqIndex).trim();
    if (cookieName === name) {
      return trimmed.slice(eqIndex + 1).trim();
    }
  }
  return null;
}

function buildSessionCookieHeader(value: string, maxAge: number): string {
  const base = `${SESSION_COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/`;
  // Add Secure flag in production (hosted mode always implies HTTPS in practice).
  // We omit Secure in tests that use plain http — operators must ensure TLS at
  // the edge in production. Document this requirement in hosted-console.md.
  const maxAgePart = `; Max-Age=${maxAge}`;
  return `${base}${maxAgePart}; Secure`;
}

// ---------------------------------------------------------------------------
// Static asset serving
// ---------------------------------------------------------------------------

/**
 * Attempt to serve a static file from the UI dist directory.
 *
 * In hosted mode, HTML files (index.html fallback) are only reached here
 * when the caller has already verified a valid session cookie, since the
 * session gate runs first in routeRequest. Non-HTML assets (JS, CSS,
 * fonts, images) are served without authentication — they are content-hashed
 * bundles that disclose no product information.
 *
 * In local mode, all assets are served freely as before (gate is inert).
 *
 * - Resolves the file within the dist directory, rejecting path traversal.
 * - Serves the exact file when it exists.
 * - Falls back to index.html for client-side routes (e.g. /telemetry, /environment).
 * - Returns false when the dist directory is absent (hub-only deploys unaffected).
 */
async function serveStaticAsset(uiDistDir: string, pathname: string, response: ServerResponse, runtimeConfig: ConsoleRuntimeConfig): Promise<boolean> {
  if (!fs.existsSync(uiDistDir)) return false;

  // Decode and sanitize the path component; strip query string (already stripped by URL parse).
  const decodedPath = safeDecodePath(pathname);
  if (decodedPath === null) return false;

  // Resolve relative to the dist dir and reject traversal escapes.
  const resolved = path.resolve(uiDistDir, "." + decodedPath);
  if (!resolved.startsWith(path.resolve(uiDistDir) + path.sep) && resolved !== path.resolve(uiDistDir)) {
    return false;
  }

  let filePath = resolved;
  let stat: fs.Stats | null = null;

  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }

  // If path points at a directory or file doesn't exist, try index.html fallback.
  if (!stat || stat.isDirectory()) {
    const indexPath = path.join(uiDistDir, "index.html");
    if (!fs.existsSync(indexPath)) return false;
    filePath = indexPath;
    stat = fs.statSync(filePath);
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPE_MAP[ext] || "application/octet-stream";
  const isHtml = ext === ".html";

  const headers: Record<string, string | number> = {
    "content-type": contentType,
    "content-length": stat.size
  };
  if (isHtml) {
    headers["cache-control"] = "no-store";
    if (runtimeConfig.mode === "hosted") {
      Object.assign(headers, hostedHtmlSecurityHeaders("app"));
    }
  } else {
    // Assets have content-hashed filenames from vite — safe to cache long-term.
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }

  response.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function safeDecodePath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    // Reject any path that still contains encoded or literal traversal sequences.
    if (decoded.includes("..")) return null;
    // Normalize to always start with /
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
  } catch {
    return null;
  }
}

/**
 * Resolve whether to serve the UI.
 * Disabled when CONSOLE_SERVE_UI=0 (env) or options.serveUi === false.
 */
function resolveServeUi(options: ConsoleHubServerOptions): boolean {
  if (options.serveUi === false) return false;
  if (process.env.CONSOLE_SERVE_UI === "0") return false;
  return true;
}

function handleEvents(hub: Hub, events: SseBroker, request: IncomingMessage, response: ServerResponse, pathname: string): void {
  if (pathname === "/events" && !prefersSse(request)) {
    writeJson(response, 200, hub.inspect().eventStreams);
    return;
  }
  openEventStream(hub, events, request, response);
}

async function handleRecords(
  hub: Hub,
  events: SseBroker,
  request: IncomingMessage,
  response: ServerResponse,
  context: ConsoleRequestContext,
  economicsForContext: () => TenantEconomics
): Promise<void> {
  const body = await readJsonBody(request);
  const record = validateRecordBody(body);

  // Bind tenancy from the verified principal, never from the payload (ADR 0003
  // call 2). The body tenant_id is advisory; a disagreement is a 403, otherwise
  // the record is stamped with the principal's tenant before it is appended.
  const stamped = stampTenantFromPrincipal(record, context);
  if (!stamped.ok) {
    writeApiError(response, 403, stamped.error, stamped.safeMessage);
    return;
  }

  // Economics is a telemetry-plane KIND: route the tenant-stamped record to the
  // per-tenant economics store + rebuildable projection, NOT `hub.append` (the
  // control plane). ADR 0003 calls 1 + 3.
  if (stamped.record.schema === "kontour.console.economics") {
    const entry = economicsForContext();
    const economicsRecord = stamped.record as ConsoleEconomicsRecord;

    // Hosted durable path (console #155): Postgres is the source of truth AND
    // the dedup boundary. Persist FIRST; fold into the in-memory projection
    // only when the row is NEWLY persisted (a duplicate re-relay must not
    // double-count) and the cold load succeeded (never fold onto a projection
    // that is missing history — reads are 503 until a load succeeds).
    if (entry.repo) {
      const loaded = await entry.ensureLoaded();
      const persisted = await entry.repo.persist(context.tenantId, economicsRecord, new Date().toISOString());
      if (persisted.outcome !== "accepted") {
        writeApiError(response, 500, persisted.errorCode || "SINK_DELIVERY_FAILED", persisted.safeMessage || "record delivery failed");
        return;
      }
      if (persisted.status === "persisted" && loaded) {
        entry.store.append(economicsRecord);
        entry.projection.apply(economicsRecord);
      }
      events.broadcast("record.accepted", { delivery: persisted });
      writeJson(response, 202, persisted);
      return;
    }

    // Local in-memory v1 path — unchanged (#117 behaviour).
    entry.store.append(economicsRecord);
    entry.projection.apply(economicsRecord);
    events.broadcast("record.accepted", { delivery: { recordKind: "economics", recordId: economicsRecord.run_id, outcome: "accepted" } });
    writeJson(response, 202, { recordKind: "economics", recordId: economicsRecord.run_id, outcome: "accepted" });
    return;
  }

  const result = await hub.append(stamped.record);
  if (result.outcome !== "accepted") {
    writeApiError(response, 500, result.errorCode || "SINK_DELIVERY_FAILED", result.safeMessage || "record delivery failed");
    return;
  }

  events.broadcast("record.accepted", {
    delivery: result,
    state: hub.currentOperatingState()
  });
  writeJson(response, 202, result);
}

/**
 * Bind a record's tenant from the verified principal (ADR 0003 call 2).
 *
 * `context.tenantId` is authoritative: it is resolved at auth time from the
 * principal (hosted mode) or from the runtime default (local/self-hosted mode),
 * and it already scopes which tenant hub the record lands in. A record MAY carry
 * a `tenant_id`/`tenantId` for self-description, but it is never trusted:
 *   - if the body carries a tenant that is present AND disagrees with the
 *     principal's tenant, the record is rejected (caller returns 403); a
 *     hostile or buggy producer cannot write across tenants by editing a field.
 *   - otherwise the record is stamped with the authoritative tenant so it is
 *     self-consistent with the hub it lands in.
 *
 * Local (non-hosted) mode has a single default tenant, so this simply stamps
 * that default — behaviour is unchanged for the common case where no body
 * tenant is present.
 */
function stampTenantFromPrincipal(
  record: ConsoleRecord,
  context: ConsoleRequestContext
): { ok: true; record: ConsoleRecord } | { ok: false; error: string; safeMessage: string } {
  const authoritative = context.tenantId;
  const bodyTenant = (record as { tenant_id?: unknown }).tenant_id ?? (record as { tenantId?: unknown }).tenantId;
  if (typeof bodyTenant === "string" && bodyTenant && bodyTenant !== authoritative) {
    return {
      ok: false,
      error: "TENANT_MISMATCH",
      safeMessage: "record tenant does not match the authenticated principal"
    };
  }
  return { ok: true, record: { ...record, tenant_id: authoritative } };
}

/**
 * Flow hosted-ingest endpoint (contract v1):
 *   POST /ingest/flow         — validate -> wrap -> append -> broadcast -> 202 { recordId }
 *   GET  /ingest/flow/:runId  — read-only stored FlowConsoleProjection -> 200 / 404
 *
 * Auth: a single per-product bearer token (`runtimeConfig.ingestToken`). When no
 * token is configured the endpoint is DISABLED and every method returns 404
 * (we do not disclose the route, and never accept unauthenticated writes).
 * Missing/invalid bearer ⇒ 401. Bad request shape ⇒ 400 { error }.
 *
 * Idempotency: dedup on `idempotencyKey`. A repeat POST returns 202 with the
 * SAME recordId and does NOT append a second record.
 *
 * Console stays read-only re: authority — it records Flow's payload and projects
 * it; Flow owns the process/projection.
 */
async function handleFlowIngestRoute(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  runtimeConfig: ConsoleRuntimeConfig,
  hub: Hub,
  events: SseBroker,
  ingestState: FlowIngestServerState
): Promise<void> {
  // Disabled when no ingest token is configured — return 404 consistently for
  // every method so the route's existence is not disclosed.
  if (!runtimeConfig.ingestToken) {
    writeApiError(response, 404, "NOT_FOUND", "route was not found");
    return;
  }

  // Bearer auth (constant-time compare), independent of the session/tenant gate.
  const token = bearerToken(request);
  if (!token || !tokenMatches(runtimeConfig.ingestToken, token)) {
    writeApiError(response, 401, "UNAUTHORIZED", "ingest authorization token is required");
    return;
  }

  // GET /ingest/flow/:runId — read-only projection fetch.
  if (request.method === "GET" && url.pathname.startsWith(INGEST_FLOW_RUN_PREFIX)) {
    const runId = safeDecodePath(url.pathname.slice(INGEST_FLOW_RUN_PREFIX.length - 1))?.replace(/^\//, "");
    if (!runId) {
      writeApiError(response, 400, "INVALID_RUN_ID", "run id is required");
      return;
    }
    const projection = ingestState.projections.get(runId);
    if (projection === undefined) {
      writeApiError(response, 404, "NOT_FOUND", "no projection recorded for run");
      return;
    }
    writeJson(response, 200, projection);
    return;
  }

  // POST /ingest/flow — accept a FlowIngestRequest envelope.
  if (request.method === "POST" && url.pathname === "/ingest/flow") {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      writeApiError(response, 400, "INVALID_JSON", "invalid JSON body");
      return;
    }

    const validation = validateFlowIngestRequest(body);
    if (!validation.ok) {
      writeApiError(response, 400, "INVALID_INGEST_REQUEST", validation.error);
      return;
    }

    const idempotencyKey = validation.request.idempotencyKey;
    const existingRecordId = ingestState.seen.get(idempotencyKey);
    if (existingRecordId !== undefined) {
      // Idempotent replay: same recordId, no second append/broadcast.
      writeJson(response, 202, { recordId: existingRecordId });
      return;
    }

    const record = wrapFlowIngestRecord(validation.request);
    const result = await hub.append(record);
    if (result.outcome !== "accepted") {
      writeApiError(response, 500, result.errorCode || "SINK_DELIVERY_FAILED", result.safeMessage || "record delivery failed");
      return;
    }

    // Mark seen and cache the projection for the read-only GET only AFTER a
    // successful append, so a failed delivery can be retried.
    ingestState.seen.set(idempotencyKey, record.id);
    const projection = validation.request.payload as { run?: { run_id?: unknown } };
    const runId = projection?.run?.run_id;
    if (typeof runId === "string" && runId) {
      ingestState.projections.set(runId, projection);
    }

    events.broadcast("record.accepted", {
      delivery: result,
      state: hub.currentOperatingState()
    });
    writeJson(response, 202, { recordId: record.id });
    return;
  }

  // Known ingest path but unsupported method.
  handleKnownRouteMethodError(response);
}

async function handleTelemetryRecords(telemetry: TelemetryStore, events: SseBroker, request: IncomingMessage, response: ServerResponse, context: ConsoleRequestContext): Promise<void> {
  const body = await readJsonBody(request);
  const record = validateTelemetryRecordBody(body);
  const result = await telemetry.accept(record, context);
  if (result.outcome !== "accepted") {
    writeApiError(response, 500, result.errorCode || "TELEMETRY_DELIVERY_FAILED", result.safeMessage || "telemetry delivery failed");
    return;
  }
  events.broadcast("telemetry.updated", {
    telemetry: {
      generatedAt: result.observedAt,
      recordCount: 1
    }
  });
  writeJson(response, 202, result);
}

function handleKnownRouteMethodError(response: ServerResponse): void {
  writeApiError(response, 405, "METHOD_NOT_ALLOWED", "method is not allowed for this route");
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve: (record: unknown) => void, reject: (error: unknown) => void) => {
    let size = 0;
    let body = "";
    let rejected = false;

    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (rejected) return;
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        const error = new Error("request body too large") as RequestError;
        error.code = "BODY_TOO_LARGE";
        error.statusCode = 413;
        error.safeMessage = "request body too large";
        rejected = true;
        reject(error);
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        const invalid = new Error("invalid JSON body") as RequestError;
        invalid.code = "INVALID_JSON";
        invalid.statusCode = 400;
        invalid.safeMessage = "invalid JSON body";
        reject(invalid);
      }
    });
    request.on("error", reject);
  });
}

function validateRecordBody(body: unknown): ConsoleRecord {
  if (!isOpenRecord(body)) {
    throw requestError("INVALID_BODY", 400, "request body must be a JSON object");
  }
  // Economics is an additive KIND on the one `/records` ingress (ADR 0003 call 1).
  // It is validated by its own schema (with the Goodhart invariant) and routed to
  // the economics store, NOT `hub.append` — so it returns here as a ConsoleRecord
  // for tenant-stamping, and handleRecords branches on the schema before append.
  if (body.schema === "kontour.console.economics") {
    return validateEconomicsRecordBody(body);
  }
  // Liveness (flow-agents #295) is likewise an additive KIND on `/records`, but
  // UNLIKE economics it DOES flow through `hub.append` — it folds into the
  // OperatingState projection's `actors[]` (console #125) alongside events, just
  // via a different applyEvent branch (see current-operating-state.ts).
  if (body.schema === LIVENESS_SCHEMA) {
    return validateLivenessRecordBody(body);
  }
  if (body.schema !== "kontour.console.event" && body.schema !== "kontour.console.projection") {
    throw requestError("INVALID_RECORD", 400, "record.schema must be kontour.console.event, kontour.console.projection, kontour.console.liveness, or kontour.console.economics");
  }

  const record = body as ConsoleRecord;
  const validation = body.schema === "kontour.console.projection"
    ? foundation().validateProjection(record, "record")
    : foundation().validateEvent(record, "record");
  const errors = validation.filter((item: import("./types").ValidationIssue) => item.severity === "error");
  if (errors.length) {
    const error = requestError("INVALID_RECORD", 400, "record validation failed");
    error.validation = errors;
    throw error;
  }
  return record;
}

/**
 * Validate a `kontour.console.liveness` v0.1 record (flow-agents #295,
 * scripts/liveness/relay.sh) — a flat claim/heartbeat/release fact about one
 * actor holding (or releasing) one subjectId, with no event-style
 * subject/payload/producer envelope. Synthesizes `id` when absent so the
 * record stays idempotent under the core-records (tenant_id, record_id)
 * primary key (see normalizeLivenessRecord).
 */
export function validateLivenessRecordBody(body: unknown): ConsoleLivenessRecord {
  if (!isOpenRecord(body)) {
    throw requestError("INVALID_BODY", 400, "request body must be a JSON object");
  }
  const issues = validateLivenessRecord(body, "record");
  if (issues.length) {
    const error = requestError("INVALID_RECORD", 400, "record validation failed");
    error.validation = issues;
    throw error;
  }
  return normalizeLivenessRecord(body as Record<string, unknown>);
}

/**
 * Validate a `kontour.console.economics` v0.1 record — the AUTHORITATIVE flow-agents
 * #349 contract (snake_case, nested objects). Enforces the R7 Goodhart invariant at
 * the SCHEMA boundary: `cost` and `defects` are CO-REQUIRED. A record carrying `cost`
 * but no `defects` is rejected `400 INVALID_RECORD` — no consumer can render "cheaper"
 * without "and here is what it caught / missed."
 *
 * Top-level required: `schema, version, run_id, cost, time, iterations, defects`.
 * The value-experiment tags (`model_tier`, `kit_condition`, `acceptance_label`) are
 * NOT on the base record — they are #350 harness extensions, so they are OPTIONAL and
 * only validated for enum-correctness when present. Throws a RequestError with a
 * diagnostic `validation[]` on any failure.
 */
export function validateEconomicsRecordBody(body: unknown): ConsoleEconomicsRecord {
  if (!isOpenRecord(body)) {
    throw requestError("INVALID_BODY", 400, "request body must be a JSON object");
  }
  const issues: ValidationIssue[] = [];
  const record = body as Record<string, unknown>;

  const isObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

  if (record.version !== "0.1") {
    issues.push({ severity: "error", path: "economics.version", message: "version must be \"0.1\"" });
  }
  if (typeof record.run_id !== "string" || !record.run_id) {
    issues.push({ severity: "error", path: "economics.run_id", message: "run_id is required and must be a non-empty string" });
  }

  // `time` and `iterations` are required objects with numeric fields.
  const time = record.time;
  if (!isObject(time)) {
    issues.push({ severity: "error", path: "economics.time", message: "time is required and must be an object" });
  } else {
    if (!isFiniteNumber(time.wall_clock_s)) issues.push({ severity: "error", path: "economics.time.wall_clock_s", message: "time.wall_clock_s must be a finite number" });
    if (!isFiniteNumber(time.human_wait_s)) issues.push({ severity: "error", path: "economics.time.human_wait_s", message: "time.human_wait_s must be a finite number" });
  }
  const iterations = record.iterations;
  if (!isObject(iterations)) {
    issues.push({ severity: "error", path: "economics.iterations", message: "iterations is required and must be an object" });
  } else {
    if (!isFiniteNumber(iterations.count)) issues.push({ severity: "error", path: "economics.iterations.count", message: "iterations.count must be a finite number" });
    if (!isFiniteNumber(iterations.route_backs)) issues.push({ severity: "error", path: "economics.iterations.route_backs", message: "iterations.route_backs must be a finite number" });
  }

  // ── The R7 Goodhart invariant: cost and defects are CO-REQUIRED. ──
  const cost = record.cost;
  if (!isObject(cost)) {
    issues.push({ severity: "error", path: "economics.cost", message: "cost is required and must be an object" });
  } else if (!isFiniteNumber(cost.estimated_cost_usd)) {
    issues.push({ severity: "error", path: "economics.cost.estimated_cost_usd", message: "cost.estimated_cost_usd is required and must be a finite number" });
  }
  const defects = record.defects;
  if (!isObject(defects)) {
    // The load-bearing Goodhart rejection: a cost-only record has no defects block.
    issues.push({ severity: "error", path: "economics.defects", message: "a record carrying cost MUST also carry defects (R7 Goodhart invariant): defects is required and must be an object" });
  } else {
    if (!isFiniteNumber(defects.caught_false_completions)) {
      issues.push({ severity: "error", path: "economics.defects.caught_false_completions", message: "defects.caught_false_completions must be a finite number" });
    }
    if (typeof defects.verification_verdict !== "string" || !["PASS", "FAIL", "NOT_VERIFIED"].includes(defects.verification_verdict as string)) {
      issues.push({ severity: "error", path: "economics.defects.verification_verdict", message: "defects.verification_verdict must be one of: PASS, FAIL, NOT_VERIFIED" });
    }
    const sev = defects.findings_by_severity;
    if (!isObject(sev)) {
      issues.push({ severity: "error", path: "economics.defects.findings_by_severity", message: "defects.findings_by_severity must be an object of severity → count" });
    } else {
      for (const key of ["critical", "high", "medium", "low"]) {
        if (!isFiniteNumber(sev[key])) issues.push({ severity: "error", path: `economics.defects.findings_by_severity.${key}`, message: `findings_by_severity.${key} must be a finite number` });
      }
    }
  }

  // ── Optional #350 harness tags: enum-check only when present. ──
  if (record.model_tier !== undefined && !["small", "large"].includes(record.model_tier as string)) {
    issues.push({ severity: "error", path: "economics.model_tier", message: "model_tier, when present, must be one of: small, large" });
  }
  if (record.kit_condition !== undefined && !["bare", "+kit"].includes(record.kit_condition as string)) {
    issues.push({ severity: "error", path: "economics.kit_condition", message: "kit_condition, when present, must be one of: bare, +kit" });
  }
  if (record.acceptance_label !== undefined && !["accepted", "rejected"].includes(record.acceptance_label as string)) {
    issues.push({ severity: "error", path: "economics.acceptance_label", message: "acceptance_label, when present, must be one of: accepted, rejected" });
  }

  if (issues.length) {
    const error = requestError("INVALID_RECORD", 400, "economics record validation failed");
    error.validation = issues;
    throw error;
  }
  return body as ConsoleEconomicsRecord;
}

/**
 * Per-tenant economics state.
 *
 * Local mode: `repo` is undefined, `ensureLoaded()` resolves true immediately,
 * and store/projection behave exactly as the in-memory v1 (#117).
 *
 * Hosted mode (console #155): `repo` persists every accepted record to
 * Postgres and `ensureLoaded()` cold-loads the tenant's history (sequence
 * ascending) into a fresh store + projection. Fail-closed: while the load has
 * not succeeded, reads return 503 and ingests persist WITHOUT folding — a
 * later successful load rebuilds the projection from Postgres, which includes
 * everything persisted during the outage.
 */
interface TenantEconomics {
  store: EconomicsStore;
  projection: EconomicsProjection;
  /** Present in hosted mode only — the Postgres persistence layer. */
  repo?: EconomicsRecordsRepository;
  /** Resolves true when the (possibly retried) cold load has succeeded. */
  ensureLoaded(): Promise<boolean>;
}

/** Lazily create (and cache) the per-tenant economics store + projection. */
function economicsForTenant(
  economics: Map<string, TenantEconomics>,
  tenantId: string,
  sqlClient?: ConsoleSqlClient
): TenantEconomics {
  const key = safePathToken(tenantId);
  let existing = economics.get(key);
  if (!existing) {
    existing = sqlClient
      ? createDurableTenantEconomics(new EconomicsRecordsRepository(sqlClient), tenantId)
      : {
        store: createEconomicsStore(),
        projection: createEconomicsProjection(),
        ensureLoaded: () => Promise.resolve(true)
      };
    economics.set(key, existing);
  }
  return existing;
}

/**
 * Hosted-mode durable economics entry (console #155).
 *
 * The cold load is memoized on success and RETRIED on the next request after a
 * failure (mirrors PostgresConsoleHub's #149 posture of never trusting an
 * incomplete in-memory view: there `loadSucceeded` gates the memory-based
 * staleness shortcut; here it gates folds and reads outright). A successful
 * load atomically replaces the store + projection with one rebuilt from the
 * full Postgres history.
 */
function createDurableTenantEconomics(repo: EconomicsRecordsRepository, tenantId: string): TenantEconomics {
  let loadPromise: Promise<boolean> | undefined;

  const entry: TenantEconomics = {
    store: createEconomicsStore(),
    projection: createEconomicsProjection(),
    repo,
    ensureLoaded
  };

  async function loadOnce(): Promise<boolean> {
    const result = await repo.loadRecords(tenantId);
    if (!result.ok) return false;
    const store = createEconomicsStore();
    const projection = createEconomicsProjection();
    for (const record of result.records) {
      store.append(record);
      projection.apply(record);
    }
    entry.store = store;
    entry.projection = projection;
    return true;
  }

  async function ensureLoaded(): Promise<boolean> {
    if (!loadPromise) loadPromise = loadOnce();
    const current = loadPromise;
    const ok = await current;
    // A failed attempt is not cached: the next request retries the load.
    if (!ok && loadPromise === current) loadPromise = undefined;
    return ok;
  }

  // Kick off the cold load eagerly (mirrors PostgresConsoleHub's constructor-time
  // load) so the first read after a deploy usually finds a warm projection.
  void ensureLoaded();

  return entry;
}

/** Fail-closed economics read (#155): a failed Postgres cold load is a 503, never an empty rollup. */
function writeEconomicsUnavailable(response: ServerResponse): void {
  writeApiError(response, 503, "ECONOMICS_STORE_UNAVAILABLE", "economics records could not be loaded from storage; retry shortly");
}

function foundation() {
  return require("./index");
}

function requestError(code: string, statusCode: number, safeMessage: string): RequestError {
  const error = new Error(safeMessage) as RequestError;
  error.code = code;
  error.statusCode = statusCode;
  error.safeMessage = safeMessage;
  return error;
}

function openEventStream(hub: Hub, events: SseBroker, request: IncomingMessage, response: ServerResponse): void {
  openSseResponse(response);
  events.add(response);
  writeSse(response, "ready", {
    connectedAt: new Date().toISOString()
  });
  writeSse(response, "state", hub.currentOperatingState());

  request.on("close", () => {
    events.remove(response);
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function writeApiError(response: ServerResponse, statusCode: number, error: string, safeMessage: string, validation?: ValidationIssue[]): void {
  writeJson(response, statusCode, {
    error,
    safeMessage,
    ...(validation && validation.length ? { validation } : {})
  });
}

function writeCorsHeaders(response: ServerResponse, origin?: string): void {
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    response.setHeader(name, value);
  }
}

function corsHeaders(origin?: string): Record<string, string> {
  return compactHeaders({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-console-api-token, x-console-telemetry-token, x-console-tenant-id",
    "vary": "origin"
  });
}

function isOpenRecord(value: unknown): value is OpenRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function prefersSse(request: IncomingMessage): boolean {
  return String(request.headers.accept || "").split(",").some((value: string) => value.trim().toLowerCase().startsWith("text/event-stream"));
}

function applyCorsPolicy(request: IncomingMessage, response: ServerResponse, runtimeConfig: ConsoleRuntimeConfig): boolean {
  const origin = request.headers.origin;
  if (Array.isArray(origin) || !isAllowedOrigin(origin, runtimeConfig)) {
    writeApiError(response, 403, "ORIGIN_NOT_ALLOWED", "origin is not allowed for the local console hub");
    return false;
  }
  writeCorsHeaders(response, origin);
  return true;
}

/** Required OAuth scope for a route (ADR 0003, Phase 2), or undefined if the
 *  route is unscoped. Mirrors the `scopes_supported` in the RFC 9728 metadata. */
export function requiredScopeForRoute(method: string, pathname: string): string | undefined {
  const m = method.toUpperCase();
  if (pathname === "/api/telemetry/pricing") return "pricing:read";
  if (pathname === "/api/telemetry" || pathname === "/api/telemetry/records") {
    return m === "POST" ? "telemetry:write" : "telemetry:read";
  }
  if (pathname === "/records") return "records:write"; // only POST is handled at /records
  if (pathname === "/api/economics" || pathname === "/api/economics/value" || pathname === "/api/economics/delegations") return "economics:read"; // only GET is handled
  if (pathname === "/mcp") return "telemetry:read"; // MCP tools expose telemetry/cost analytics
  if (pathname === "/state" || pathname === "/inspect" || pathname === "/events" || pathname === "/stream") {
    return "records:read";
  }
  return undefined;
}

/**
 * Per-route scope enforcement (console #98, ADR 0003, Phase 2).
 *
 * Returns `{ ok: true }` when the request may proceed, or a 403 INSUFFICIENT_SCOPE
 * descriptor when the authenticated principal lacks `scope`. Callers translate the
 * descriptor into a response (WWW-Authenticate + writeApiError).
 *
 * Exemption keys on LOCAL MODE, not on absence-of-principal (ADR 0003 call 6): the local
 * single-tenant self-host console must never require an OIDC scope. In HOSTED mode this is
 * fail-closed and mirrors the active route gate exactly — scopes come from a verified JWT
 * principal or a scope-carrying session (`principal?.scopes ?? context.scopes`), and a request
 * lacking the scope is REJECTED. It is deliberately NOT exempted just because it carries no
 * structured principal (e.g. a hosted legacy static token) — exempting on "no principal" would be
 * a scope-bypass footgun the moment this helper is wired onto a hosted route.
 */
export function requireScope(
  context: ConsoleRequestContext,
  scope: string
): { ok: true } | { ok: false; statusCode: 403; error: "INSUFFICIENT_SCOPE"; safeMessage: string; scope: string } {
  // Local-first: the local single-tenant console is never scope-gated.
  if (context.runtimeMode === "local") return { ok: true };
  // Hosted: fail-closed, same source of scopes as the active route gate.
  const granted = context.principal?.scopes ?? context.scopes ?? [];
  if (granted.includes(scope)) return { ok: true };
  return { ok: false, statusCode: 403, error: "INSUFFICIENT_SCOPE", safeMessage: `missing required scope: ${scope}`, scope };
}

function isAllowedOrigin(origin: string | undefined, runtimeConfig: ConsoleRuntimeConfig): boolean {
  if (!origin) return true;
  const allowedOrigins = runtimeConfig.mode === "hosted"
    ? runtimeConfig.allowedOrigins
    : DEFAULT_ALLOWED_ORIGINS.concat(runtimeConfig.allowedOrigins);
  return allowedOrigins.includes(origin);
}

function isKnownRoute(pathname: string): boolean {
  return KNOWN_ROUTES.includes(pathname);
}

async function authenticateRequest(request: IncomingMessage, runtimeConfig: ConsoleRuntimeConfig, options: ConsoleHubServerOptions, revocationStore: RevocationStore): Promise<{ ok: true; context: ConsoleRequestContext } | { ok: false; statusCode: number; error: string; safeMessage: string }> {
  if (runtimeConfig.mode !== "hosted") {
    if (!authorizeLocalRequest(request, runtimeConfig)) {
      return { ok: false, statusCode: 401, error: "UNAUTHORIZED", safeMessage: "console token is required for non-loopback clients" };
    }
    return { ok: true, context: { tenantId: runtimeConfig.defaultTenantId, runtimeMode: "local", authMethod: "local" } };
  }

  // Accept session cookie as credential (equivalent to bearer token + tenant).
  // This supports EventSource (SSE) from the browser, which cannot set headers.
  const sessionContext = await verifySessionActive(request, runtimeConfig, revocationStore);
  if (sessionContext) {
    return { ok: true, context: { tenantId: sessionContext.tenantId, runtimeMode: "hosted", authMethod: "session", scopes: sessionContext.scopes } };
  }

  const token = apiRequestToken(request);
  if (!token) {
    return { ok: false, statusCode: 401, error: "UNAUTHORIZED", safeMessage: "authorization token is required" };
  }

  // OAuth 2.1 Resource-Server path (ADR 0003, config-gated). A bearer that is
  // structurally a JWT is verified as a OIDC access token (JWKS signature,
  // issuer, audience-bound `aud`); the tenant comes from the org claim. Opaque
  // tokens are not JWT-shaped and fall through to the unchanged path below.
  if (runtimeConfig.oauth && looksLikeJwt(token)) {
    try {
      const verified = await verifyAccessToken(token, runtimeConfig.oauth);
      const requestedTenant = requestTenantId(request);
      if (requestedTenant && requestedTenant !== verified.tenantId) {
        return { ok: false, statusCode: 403, error: "TENANT_FORBIDDEN", safeMessage: "tenant is not allowed for this token" };
      }
      if (runtimeConfig.hostedTenantIds.length && !runtimeConfig.hostedTenantIds.includes(verified.tenantId)) {
        return { ok: false, statusCode: 403, error: "TENANT_FORBIDDEN", safeMessage: "tenant is not allowed" };
      }
      // Build the verified principal (console #98, ADR 0003 call 2). tenantId is the
      // authoritative tenant claim; kind is "machine" when a client_id/cid claim
      // identifies an M2M client, else "user" (an OIDC human, identified by sub).
      const principal: ConsolePrincipal = {
        kind: verified.isMachine ? "machine" : "user",
        subject: verified.clientId || verified.subject || verified.tenantId,
        tenantId: verified.tenantId,
        scopes: verified.scopes,
        clientId: verified.clientId,
        issuer: verified.issuer
      };
      return { ok: true, context: { tenantId: verified.tenantId, runtimeMode: "hosted", authMethod: "jwt", scopes: verified.scopes, principal } };
    } catch {
      return { ok: false, statusCode: 401, error: "UNAUTHORIZED", safeMessage: "access token is invalid" };
    }
  }

  // Opaque bearer token auth (unchanged).
  const tokenConfig = runtimeConfig.hostedAuthTokens.find((candidate) => tokenMatches(candidate.token, token));
  if (!tokenConfig) {
    return { ok: false, statusCode: 401, error: "UNAUTHORIZED", safeMessage: "authorization token is invalid" };
  }
  const requestedTenant = requestTenantId(request);
  if (requestedTenant && requestedTenant !== tokenConfig.tenantId) {
    return { ok: false, statusCode: 403, error: "TENANT_FORBIDDEN", safeMessage: "tenant is not allowed for this token" };
  }
  return { ok: true, context: { tenantId: tokenConfig.tenantId, runtimeMode: "hosted", authMethod: "token" } };
}

function authorizeLocalRequest(request: IncomingMessage, runtimeConfig: ConsoleRuntimeConfig): boolean {
  if (isLoopbackAddress(request.socket.remoteAddress)) return true;
  const expected = runtimeConfig.localAuthToken;
  if (!expected) return false;
  const token = apiRequestToken(request) || telemetryRequestToken(request);
  return Boolean(token && tokenMatches(expected, token));
}

function apiRequestToken(request: IncomingMessage): string | undefined {
  const headerToken = request.headers["x-console-api-token"];
  if (typeof headerToken === "string" && headerToken) return headerToken;
  return bearerToken(request);
}

function telemetryRequestToken(request: IncomingMessage): string | undefined {
  const headerToken = request.headers["x-console-telemetry-token"];
  if (typeof headerToken === "string" && headerToken) return headerToken;
  return bearerToken(request);
}

function tokenMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization || "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice("bearer ".length);
  return undefined;
}

function requestTenantId(request: IncomingMessage): string | undefined {
  const headerTenant = request.headers["x-console-tenant-id"];
  return typeof headerTenant === "string" && headerTenant ? headerTenant : undefined;
}

function hostedHubForTenant(
  hostedHubs: Map<string, Hub>,
  options: ConsoleHubServerOptions,
  tenantId: string,
  sqlClient?: ConsoleSqlClient
): Hub {
  const safeTenantId = safePathToken(tenantId);
  const existing = hostedHubs.get(safeTenantId);
  if (existing) return existing;
  const baseRoot = options.kontourRoot || options.localRoot || DEFAULT_CONSOLE_RUNTIME_ROOT;
  const localHub = new LocalConsoleHub({
    ...options,
    hub: undefined,
    sink: undefined,
    kontourRoot: path.join(baseRoot, "tenants", safeTenantId)
  });
  // In hosted mode with a SQL client, wrap with PostgresConsoleHub so records
  // survive redeploys.  Without a SQL client (shouldn't happen in valid hosted
  // config, but safe fallback) use the local hub as-is.
  const tenantHub = sqlClient
    ? new PostgresConsoleHub(localHub, sqlClient, tenantId)
    : localHub;
  hostedHubs.set(safeTenantId, tenantHub);
  return tenantHub;
}

/**
 * Hub implementation for hosted mode that persists accepted records to
 * Postgres and builds /state from Postgres-sourced in-memory records.
 *
 * Invariants:
 *   - At construction the full tenant record set is loaded from Postgres
 *     in sequence order (async, via loadPromise).  The Hub interface's
 *     synchronous currentOperatingState() is safe to call at any point;
 *     call await hub.readyForState() first when you need a complete picture
 *     (routeRequest does this for /state and SSE late-join).
 *   - Subsequent appends wait for the initial load before persisting so that
 *     in-memory order matches Postgres sequence order.
 *   - currentOperatingState() and SSE late-join state are both built from
 *     the in-memory cache, so they survive redeploys.
 *   - inspect() is delegated to the underlying LocalConsoleHub so the
 *     current-session JSONL file view (useful for debugging) still works.
 *   - Duplicate record IDs follow the Postgres on-conflict update semantics:
 *     the insert succeeds (returns accepted) just like the JSONL append
 *     path — consistent with existing dedup behaviour.
 */
class PostgresConsoleHub implements Hub {
  private readonly repo: CoreRecordsRepository;
  // Incremental projection of the operating state — fold each event once as it is
  // loaded/appended instead of retaining every raw record and re-folding the full
  // history on each /state read (ops#34). Memory and per-request cost scale with
  // current state, not total history.
  private readonly projection: {
    apply(event: ConsoleEventRecord | ConsoleLivenessRecord, streamId?: string): void;
    materialize(options?: CurrentOperatingStateOptions): OperatingState;
    wouldAdvanceLiveness(event: ConsoleLivenessRecord, options?: CurrentOperatingStateOptions): boolean;
  };
  /** Resolves when the initial Postgres load is done (or errored gracefully). */
  private readonly loadPromise: Promise<void>;
  private loadSucceeded = false;

  constructor(
    private readonly localHub: InstanceType<typeof LocalConsoleHub>,
    sqlClient: ConsoleSqlClient,
    private readonly tenantId: string
  ) {
    this.repo = new CoreRecordsRepository(sqlClient);
    this.projection = foundation().createOperatingStateProjection();
    // Start the load immediately so /state benefits from it on the first request
    // without needing an explicit trigger. Records arrive in sequence order
    // (loadRecords orders by sequence asc), which the projection's parity contract
    // requires.
    this.loadPromise = this.repo.loadRecords(tenantId).then((result) => {
      this.loadSucceeded = result.ok;
      for (const record of result.records) {
        if (isConsoleEventRecord(record) || isLivenessRecord(record)) {
          this.projection.apply(record);
        }
      }
    }).catch(() => {
      this.loadSucceeded = false;
      // Errors are swallowed; the projection stays empty and the hub degrades to
      // an empty-state view rather than crashing.
    });
  }

  /**
   * Wait for the initial Postgres load to complete.
   * routeRequest calls this before currentOperatingState() so /state and
   * SSE late-join always reflect the full persistent history.
   */
  readyForState(): Promise<void> {
    return this.loadPromise;
  }

  async append(record: ConsoleRecord): Promise<DeliveryResult> {
    // Ensure load is complete before appending so in-memory order is stable.
    await this.loadPromise;
    const observedAt = new Date().toISOString();
    // Timestamp ordering, not network arrival, owns the one persisted session
    // row. A stale/equal liveness retry is acknowledged without touching either
    // Postgres, the local inspection file, or the live projection.
    if (isLivenessRecord(record) && this.loadSucceeded && !this.projection.wouldAdvanceLiveness(record)) {
      return {
        sinkId: "postgres-core-records",
        sinkRole: "CoreRecordsStore",
        outcome: "accepted",
        status: "stale_liveness_ignored",
        recordId: record.id || "",
        recordKind: "event",
        observedAt
      };
    }
    // Persist to Postgres first.  A failure returns a failed DeliveryResult
    // to the caller — we do not silently fall through to JSONL in hosted mode.
    const persisted = await this.repo.persist(record, this.tenantId, observedAt);
    if (persisted.outcome !== "accepted") return persisted;
    // The atomic Postgres predicate is the cross-process ordering authority.
    // A stale/equal liveness row or cross-schema ID collision reports accepted
    // without advancing and must not leak to inspection or the live projection.
    if (persisted.status !== "persisted") return persisted;
    // Also write to the local file sink for the current session
    // (enables inspect() to show streams; harmless if disk is ephemeral).
    await this.localHub.append(record);
    // Fold the event into the projection for currentOperatingState(). Liveness
    // records (flow-agents #295) fold too — into `actors[]`, via a distinct
    // applyEvent branch — so active sessions show up without needing their own
    // store/projection pair the way economics does.
    if (isConsoleEventRecord(record) || isLivenessRecord(record)) {
      this.projection.apply(record);
    }
    return persisted;
  }

  inspect(): InspectionReport {
    return this.localHub.inspect();
  }

  currentOperatingState(options: CurrentOperatingStateOptions = {}): OperatingState {
    return this.projection.materialize(options);
  }
}

function isConsoleEventRecord(record: ConsoleRecord): record is ConsoleEventRecord {
  return record.schema === "kontour.console.event";
}

function hostedEventsForTenant(hostedEvents: Map<string, SseBroker>, tenantId: string): SseBroker {
  const safeTenantId = safePathToken(tenantId);
  const existing = hostedEvents.get(safeTenantId);
  if (existing) return existing;
  const broker = createSseBroker();
  hostedEvents.set(safeTenantId, broker);
  return broker;
}

function safePathToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return true;
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

function compactHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
