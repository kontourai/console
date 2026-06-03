const http = require("node:http");
const { LocalConsoleHub } = require("./console-hub");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3737;
const MAX_BODY_BYTES = 1024 * 1024;

function createConsoleHubServer(options = {}) {
  const hub = options.hub || new LocalConsoleHub(options);
  const server = http.createServer((request, response) => {
    routeRequest(hub, request, response);
  });

  return {
    hub,
    server,
    listen(listenOptions = {}, callback) {
      const host = listenOptions.host || options.host || DEFAULT_HOST;
      const port = Number(listenOptions.port ?? options.port ?? DEFAULT_PORT);
      return server.listen(port, host, callback);
    },
    close(callback) {
      return server.close(callback);
    }
  };
}

async function routeRequest(hub, request, response) {
  const url = new URL(request.url, `http://${request.headers.host || DEFAULT_HOST}`);

  try {
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
      writeJson(response, result.outcome === "accepted" ? 202 : 400, result);
      return;
    }

    if (["/state", "/inspect", "/records"].includes(url.pathname)) {
      writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }

    writeJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    writeJson(response, error.statusCode || 400, {
      error: error.code || "BAD_REQUEST",
      safeMessage: error.safeMessage || "request could not be processed"
    });
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    let rejected = false;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) return;
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        const error = new Error("request body too large");
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
        const invalid = new Error("invalid JSON body");
        invalid.code = "INVALID_JSON";
        invalid.statusCode = 400;
        invalid.safeMessage = "invalid JSON body";
        reject(invalid);
      }
    });
    request.on("error", reject);
  });
}

function writeJson(response, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createConsoleHubServer
};
