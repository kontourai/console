import http = require("node:http");
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createSseBroker, openSseResponse, writeSse, type SseBroker } from "./sse-stream";
import type {
  ConsoleRecord,
  ConsoleHubServer,
  ConsoleHubServerOptions,
  DeliveryResult,
  Hub,
  ListenOptions,
  OpenRecord,
  RequestError,
  ValidationIssue
} from "./types";

const { LocalConsoleHub } = require("./console-hub");

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3737;
const MAX_BODY_BYTES = 1024 * 1024;
const KNOWN_ROUTES = ["/events", "/stream", "/state", "/inspect", "/records"];
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173"
];

export function createConsoleHubServer(options: ConsoleHubServerOptions = {}): ConsoleHubServer {
  const hub = options.hub || new LocalConsoleHub(options);
  const events = createSseBroker();
  const server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
    routeRequest(hub, events, options, request, response);
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
      events.closeAll();
      return server.close(callback);
    }
  };
}

async function routeRequest(hub: Hub, events: SseBroker, options: ConsoleHubServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", `http://${request.headers.host || DEFAULT_HOST}`);
  if (!applyCorsPolicy(request, response, options)) return;

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && (url.pathname === "/stream" || url.pathname === "/events")) {
      handleEvents(hub, events, request, response, url.pathname);
      return;
    }

    if (request.method === "GET" && url.pathname === "/state") {
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
    "access-control-allow-headers": "content-type",
    "vary": "origin"
  });
}

function isOpenRecord(value: unknown): value is OpenRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function prefersSse(request: IncomingMessage): boolean {
  return String(request.headers.accept || "").split(",").some((value: string) => value.trim().toLowerCase().startsWith("text/event-stream"));
}

function applyCorsPolicy(request: IncomingMessage, response: ServerResponse, options: ConsoleHubServerOptions): boolean {
  const origin = request.headers.origin;
  if (Array.isArray(origin) || !isAllowedOrigin(origin, options.allowedOrigins)) {
    writeApiError(response, 403, "ORIGIN_NOT_ALLOWED", "origin is not allowed for the local console hub");
    return false;
  }
  writeCorsHeaders(response, origin);
  return true;
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[] = []): boolean {
  if (!origin) return true;
  return DEFAULT_ALLOWED_ORIGINS.concat(allowedOrigins).includes(origin);
}

function isKnownRoute(pathname: string): boolean {
  return KNOWN_ROUTES.includes(pathname);
}

function compactHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
