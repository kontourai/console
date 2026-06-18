import http = require("node:http");
import fs = require("node:fs");
import type { IncomingMessage, Server, ServerResponse } from "node:http";
const path = require("node:path");
const crypto = require("node:crypto");
import { assertConsoleRuntimeConfig, resolveConsoleRuntimeConfig, type ConsoleRuntimeConfig } from "./config";
import { createSseBroker, openSseResponse, writeSse, type SseBroker } from "./sse-stream";
import { createOptionalPgClient, createTelemetryStore, parseTelemetryQuery, validateTelemetryRecordBody, type TelemetryStore } from "./telemetry";
import { validateFlowIngestRequest, wrapFlowIngestRecord } from "./flow-ingest";
import type {
  ConsoleEventRecord,
  ConsoleRecord,
  ConsoleHubServer,
  ConsoleHubServerOptions,
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
import { CoreRecordsRepository } from "./core-records";

const { LocalConsoleHub } = require("./console-hub");

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3737;
const MAX_BODY_BYTES = 1024 * 1024;
const KNOWN_ROUTES = ["/events", "/stream", "/state", "/inspect", "/records", "/ingest/flow", "/api/telemetry", "/api/telemetry/records", "/healthz", "/readyz", "/session", "/session/logout"];

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
  const uiDistDir = resolveUiDistDir();
  const server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
    routeRequest({
      localHub: hub,
      localEvents,
      hostedHubs,
      hostedEvents,
      telemetry,
      ingestState,
      options,
      runtimeConfig,
      coreSqlClient,
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
  telemetry: TelemetryStore;
  ingestState: FlowIngestServerState;
  options: ConsoleHubServerOptions;
  runtimeConfig: ConsoleRuntimeConfig;
  coreSqlClient?: ConsoleSqlClient;
  uiDistDir: string;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const { telemetry, ingestState, options, runtimeConfig, coreSqlClient, uiDistDir, request, response } = input;
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

    // Session routes — handled before the auth gate and before static asset serving.
    // POST /session: validate {token, tenant} body and issue a session cookie (hosted + dist only).
    // GET /session: check cookie, return {tenantId} (exempt from gate — used by UI on startup).
    // POST /session/logout: clear the session cookie.
    if (request.method === "POST" && url.pathname === "/session") {
      await handleSessionCreate(request, response, runtimeConfig, uiDistDir);
      return;
    }

    if (request.method === "GET" && url.pathname === "/session") {
      handleSessionCheck(request, response, runtimeConfig);
      return;
    }

    if (request.method === "POST" && url.pathname === "/session/logout") {
      handleSessionLogout(response);
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
        const sessionContext = verifySessionCookie(request, runtimeConfig);
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

    const auth = authenticateRequest(request, runtimeConfig, options);
    if (!auth.ok) {
      writeApiError(response, auth.statusCode, auth.error, auth.safeMessage);
      return;
    }
    const context = auth.context;
    const hub = runtimeConfig.mode === "hosted" ? hostedHubForTenant(input.hostedHubs, options, context.tenantId, coreSqlClient) : input.localHub;
    const events = runtimeConfig.mode === "hosted" ? hostedEventsForTenant(input.hostedEvents, context.tenantId) : input.localEvents;

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
      await handleRecords(hub, events, request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/telemetry") {
      const telemetryQuery = parseTelemetryQuery(url.searchParams);
      writeJson(response, 200, await telemetry.summarize(context, telemetryQuery));
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
  const cookieValue = signSessionCookie(tokenConfig.tenantId, tokenConfig.token);
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
function handleSessionCheck(
  request: IncomingMessage,
  response: ServerResponse,
  runtimeConfig: ConsoleRuntimeConfig
): void {
  if (runtimeConfig.mode !== "hosted") {
    writeApiError(response, 404, "NOT_FOUND", "route was not found");
    return;
  }
  const sessionContext = verifySessionCookie(request, runtimeConfig);
  if (!sessionContext) {
    writeApiError(response, 401, "UNAUTHORIZED", "no valid session");
    return;
  }
  writeJson(response, 200, { tenantId: sessionContext.tenantId });
}

/**
 * POST /session/logout — clear the session cookie.
 * Always succeeds with 204 (idempotent).
 */
function handleSessionLogout(response: ServerResponse): void {
  response.writeHead(204, {
    "set-cookie": buildSessionCookieHeader("", 0),
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
 * Build a signed session cookie value for a given tenant.
 *
 * Format: base64url(tenantId) "." timestampMs "." HMAC-SHA256(hex)
 * HMAC input: "<tenantPart>.<tsPart>"
 */
export function signSessionCookie(tenantId: string, rawToken: string): string {
  const tenantPart = Buffer.from(tenantId, "utf8").toString("base64url");
  const tsPart = String(Date.now());
  const sigInput = `${tenantPart}.${tsPart}`;
  const sig = crypto.createHmac("sha256", sessionSigningKey(rawToken)).update(sigInput).digest("hex");
  return `${tenantPart}.${tsPart}.${sig}`;
}

/**
 * Verify a session cookie value against the current runtime config.
 *
 * Returns { tenantId } if valid, null otherwise.
 * Uses constant-time comparison to avoid timing side channels.
 */
export function verifySessionCookieValue(
  cookieValue: string,
  runtimeConfig: ConsoleRuntimeConfig
): { tenantId: string } | null {
  const parts = cookieValue.split(".");
  // Expect exactly three dot-separated parts (tenantPart, timestamp, sig).
  // Note: base64url uses no dots, and hex sig uses no dots, so three is correct.
  if (parts.length !== 3) return null;
  const [tenantPart, tsPart, sig] = parts;
  if (!tenantPart || !tsPart || !sig) return null;

  let tenantId: string;
  try {
    tenantId = Buffer.from(tenantPart, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!tenantId) return null;

  // Timestamp sanity — must be a positive integer; no expiry check here since
  // the cookie itself carries max-age. Revocation is via token removal from config.
  if (!/^\d+$/.test(tsPart)) return null;

  // Find a token config for this tenant.
  const tokenConfig = runtimeConfig.hostedAuthTokens.find(
    (candidate) => candidate.tenantId === tenantId
  );
  if (!tokenConfig) return null;

  // Recompute expected signature and compare in constant time.
  const sigInput = `${tenantPart}.${tsPart}`;
  const expected = crypto
    .createHmac("sha256", sessionSigningKey(tokenConfig.token))
    .update(sigInput)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(sig.length === expected.length ? sig : expected, "hex");
  const match =
    sig.length === expected.length &&
    crypto.timingSafeEqual(expectedBuf, actualBuf);

  return match ? { tenantId } : null;
}

/**
 * Parse the session cookie from the incoming request's Cookie header and
 * verify it. Returns the session context or null.
 */
function verifySessionCookie(
  request: IncomingMessage,
  runtimeConfig: ConsoleRuntimeConfig
): { tenantId: string } | null {
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

async function handleRecords(hub: Hub, events: SseBroker, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody(request);
  const record = validateRecordBody(body);
  const result = await hub.append(record);
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
  if (body.schema !== "kontour.console.event" && body.schema !== "kontour.console.projection") {
    throw requestError("INVALID_RECORD", 400, "record.schema must be kontour.console.event or kontour.console.projection");
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

function authenticateRequest(request: IncomingMessage, runtimeConfig: ConsoleRuntimeConfig, options: ConsoleHubServerOptions): { ok: true; context: ConsoleRequestContext } | { ok: false; statusCode: number; error: string; safeMessage: string } {
  if (runtimeConfig.mode !== "hosted") {
    if (!authorizeLocalRequest(request, runtimeConfig)) {
      return { ok: false, statusCode: 401, error: "UNAUTHORIZED", safeMessage: "console token is required for non-loopback clients" };
    }
    return { ok: true, context: { tenantId: runtimeConfig.defaultTenantId, runtimeMode: "local" } };
  }

  // Accept session cookie as credential (equivalent to bearer token + tenant).
  // This supports EventSource (SSE) from the browser, which cannot set headers.
  const sessionContext = verifySessionCookie(request, runtimeConfig);
  if (sessionContext) {
    return { ok: true, context: { tenantId: sessionContext.tenantId, runtimeMode: "hosted" } };
  }

  // Fall through to bearer token auth (unchanged).
  const token = apiRequestToken(request);
  if (!token) {
    return { ok: false, statusCode: 401, error: "UNAUTHORIZED", safeMessage: "authorization token is required" };
  }
  const tokenConfig = runtimeConfig.hostedAuthTokens.find((candidate) => tokenMatches(candidate.token, token));
  if (!tokenConfig) {
    return { ok: false, statusCode: 401, error: "UNAUTHORIZED", safeMessage: "authorization token is invalid" };
  }
  const requestedTenant = requestTenantId(request);
  if (requestedTenant && requestedTenant !== tokenConfig.tenantId) {
    return { ok: false, statusCode: 403, error: "TENANT_FORBIDDEN", safeMessage: "tenant is not allowed for this token" };
  }
  return { ok: true, context: { tenantId: tokenConfig.tenantId, runtimeMode: "hosted" } };
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
  const baseRoot = options.kontourRoot || options.localRoot || ".kontour";
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
  private readonly events: ConsoleEventRecord[] = [];
  /** Resolves when the initial Postgres load is done (or errored gracefully). */
  private readonly loadPromise: Promise<void>;

  constructor(
    private readonly localHub: InstanceType<typeof LocalConsoleHub>,
    sqlClient: ConsoleSqlClient,
    private readonly tenantId: string
  ) {
    this.repo = new CoreRecordsRepository(sqlClient);
    // Start the load immediately so /state benefits from it on the first
    // request without needing an explicit trigger.
    this.loadPromise = this.repo.loadRecords(tenantId).then((records) => {
      for (const record of records) {
        if (isConsoleEventRecord(record)) {
          this.events.push(record);
        }
      }
    }).catch(() => {
      // Errors are swallowed; the events array stays empty and the hub
      // degrades to an empty-state view rather than crashing.
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
    // Persist to Postgres first.  A failure returns a failed DeliveryResult
    // to the caller — we do not silently fall through to JSONL in hosted mode.
    const persisted = await this.repo.persist(record, this.tenantId, observedAt);
    if (persisted.outcome !== "accepted") return persisted;
    // Also write to the local file sink for the current session
    // (enables inspect() to show streams; harmless if disk is ephemeral).
    await this.localHub.append(record);
    // Add events to the in-memory cache for currentOperatingState().
    if (isConsoleEventRecord(record)) {
      this.events.push(record);
    }
    return persisted;
  }

  inspect(): InspectionReport {
    return this.localHub.inspect();
  }

  currentOperatingState(options: CurrentOperatingStateOptions = {}): OperatingState {
    return foundation().buildCurrentOperatingState(this.events, options);
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
