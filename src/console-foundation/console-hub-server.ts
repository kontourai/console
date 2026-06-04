import http = require("node:http");
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { LocalConsoleHub } from "./console-hub";
import { createSseBroker, openSseResponse, writeSse, type SseBroker } from "./sse-stream";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3737;
const MAX_BODY_BYTES = 1024 * 1024;

interface ConsoleHubServerOptions {
  hub?: Hub;
  rootDir?: string;
  kontourRoot?: string;
  localRoot?: string;
  host?: string;
  port?: number;
}

interface ListenOptions {
  host?: string;
  port?: number;
}

interface Hub {
  append(record: unknown): Promise<DeliveryResult>;
  inspect(): unknown;
  currentOperatingState(): unknown;
}

interface DeliveryResult {
  outcome: string;
  [key: string]: unknown;
}

interface ConsoleHubServer {
  hub: Hub;
  server: Server;
  listen(listenOptions?: ListenOptions, callback?: () => void): Server;
  close(callback?: (error?: Error) => void): Server;
}

interface RequestError extends Error {
  code?: string;
  statusCode?: number;
  safeMessage?: string;
}

export function createConsoleHubServer(options: ConsoleHubServerOptions = {}): ConsoleHubServer {
  const hub = options.hub || new LocalConsoleHub(options);
  const events = createSseBroker();
  const server = http.createServer((request, response) => {
    routeRequest(hub, events, request, response);
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

async function routeRequest(hub: Hub, events: SseBroker, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", `http://${request.headers.host || DEFAULT_HOST}`);
  writeCorsHeaders(response);

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      openEventStream(hub, events, request, response);
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
      const record = await readJsonBody(request);
      const result = await hub.append(record);
      if (result.outcome === "accepted") {
        events.broadcast("record.accepted", {
          delivery: result,
          state: hub.currentOperatingState()
        });
      }
      writeJson(response, result.outcome === "accepted" ? 202 : 400, result);
      return;
    }

    if (["/events", "/state", "/inspect", "/records"].includes(url.pathname)) {
      writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }

    writeJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const requestError = error as RequestError;
    writeJson(response, requestError.statusCode || 400, {
      error: requestError.code || "BAD_REQUEST",
      safeMessage: requestError.safeMessage || "request could not be processed"
    });
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
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

function openEventStream(hub: Hub, events: SseBroker, request: IncomingMessage, response: ServerResponse): void {
  openSseResponse(response, corsHeaders());
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
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function writeCorsHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(corsHeaders())) {
    response.setHeader(name, value);
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin"
  };
}
