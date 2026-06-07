#!/usr/bin/env -S node --import tsx

const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  createConsoleHubServer
} = require("../src/console-foundation/console-hub-server");
const path = require("node:path");
import type { ConsoleHubServer } from "../src/console-foundation";

interface ServeOptions {
  host: string;
  port: number;
  kontourRoot?: string;
}

function main(argv: string[]) {
  const command = argv[2] || "help";
  if (command === "serve") {
    serve(parseServeOptions(argv.slice(3)));
    return;
  }

  printUsage();
  process.exitCode = command === "help" || command === "--help" || command === "-h" ? 0 : 2;
}

function serve(options: ServeOptions): void {
  const app = createConsoleHubServer({
    rootDir: repoRoot(),
    kontourRoot: options.kontourRoot,
    host: options.host,
    port: options.port
  });
  app.listen({}, () => {
    const address = app.server.address();
    const resolved = address as ReturnType<ConsoleHubServer["server"]["address"]>;
    if (!resolved || typeof resolved === "string") return;
    console.log(`Kontour local hub: http://${resolved.address}:${resolved.port}`);
    console.log("POST /records  GET /state  GET /inspect  GET /events");
  });
}

function repoRoot() {
  return process.env.KONTOUR_REPO_ROOT
    ? path.resolve(process.cwd(), process.env.KONTOUR_REPO_ROOT)
    : process.cwd();
}

function parseServeOptions(args: string[]): ServeOptions {
  const options: ServeOptions = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") {
      options.host = requiredValue(args, index, arg);
      index += 1;
    } else if (arg === "--port") {
      options.port = Number(requiredValue(args, index, arg));
      index += 1;
    } else if (arg === "--kontour-root") {
      options.kontourRoot = requiredValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    console.error("--port must be an integer from 0 to 65535");
    process.exit(2);
  }

  return options;
}

function requiredValue(args: string[], index: number, label: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${label} requires a value`);
    process.exit(2);
  }
  return value;
}

function printUsage() {
  console.error("Usage: kontour serve [--host 127.0.0.1] [--port 3737] [--kontour-root .kontour]");
}

main(process.argv);
