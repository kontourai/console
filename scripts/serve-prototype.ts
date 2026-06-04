#!/usr/bin/env -S node --import tsx

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

type IncomingMessage = import("node:http").IncomingMessage;
type ServerResponse = import("node:http").ServerResponse;

const rootArg = process.argv[2];
const root = path.resolve(process.cwd(), rootArg || "docs/prototypes/handoff-replay");
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "127.0.0.1";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function contained(candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const server = http.createServer((request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const decoded = decodeURIComponent(url.pathname);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(root, `.${requested}`);

  if (!contained(filePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error: NodeJS.ErrnoException | null, content: Buffer) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
});

server.listen(port, host, () => {
  console.log(`Kontour handoff prototype: http://${host}:${port}/`);
  console.log(`Serving ${root}`);
});
