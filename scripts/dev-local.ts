#!/usr/bin/env -S node --import tsx

const net = require("node:net");
const { spawn } = require("node:child_process");

type ChildProcess = import("node:child_process").ChildProcess;

type DevLocalArgs = {
  host: string;
  hubPort: number;
  uiPort: number;
};

type DevLocalConfig = DevLocalArgs & {
  browserHost: string;
  hubUrl: string;
  uiUrl: string;
  allowedOrigins: string[];
};

type IsPortAvailable = (host: string, port: number) => Promise<boolean>;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_HUB_PORT = 3738;
const DEFAULT_UI_PORT = 5175;
const MAX_PORT_PROBES = 50;

function parseDevLocalArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): DevLocalArgs {
  const args: DevLocalArgs = {
    host: env.CONSOLE_HOST || DEFAULT_HOST,
    hubPort: env.CONSOLE_PORT ? Number(env.CONSOLE_PORT) : DEFAULT_HUB_PORT,
    uiPort: env.CONSOLE_UI_PORT ? Number(env.CONSOLE_UI_PORT) : DEFAULT_UI_PORT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      args.host = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--hub-port") {
      args.hubPort = parsePort(requiredValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--ui-port") {
      args.uiPort = parsePort(requiredValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  args.hubPort = parsePort(String(args.hubPort), "--hub-port");
  args.uiPort = parsePort(String(args.uiPort), "--ui-port");
  return args;
}

async function buildDevLocalConfig(
  args: Partial<DevLocalArgs> = {},
  env: NodeJS.ProcessEnv = process.env,
  isAvailable: IsPortAvailable = isPortAvailableOnHost,
): Promise<DevLocalConfig> {
  const host = args.host || env.CONSOLE_HOST || DEFAULT_HOST;
  const preferredHubPort = args.hubPort ?? (env.CONSOLE_PORT ? Number(env.CONSOLE_PORT) : DEFAULT_HUB_PORT);
  const preferredUiPort = args.uiPort ?? (env.CONSOLE_UI_PORT ? Number(env.CONSOLE_UI_PORT) : DEFAULT_UI_PORT);
  const hubPort = await nextAvailablePort(host, parsePort(String(preferredHubPort), "--hub-port"), isAvailable);
  const uiPort = await nextAvailablePort(host, parsePort(String(preferredUiPort), "--ui-port"), isAvailable, new Set([hubPort]));
  const browserHost = browserHostForBindHost(host);
  const allowedOrigins = mergeAllowedOrigins(env.CONSOLE_ALLOWED_ORIGINS, uiOrigins(browserHost, uiPort));

  return {
    host,
    browserHost,
    hubPort,
    uiPort,
    hubUrl: `http://${browserHost}:${hubPort}`,
    uiUrl: `http://${browserHost}:${uiPort}/`,
    allowedOrigins,
  };
}

async function nextAvailablePort(
  host: string,
  preferredPort: number,
  isAvailable: IsPortAvailable = isPortAvailableOnHost,
  reservedPorts: Set<number> = new Set(),
): Promise<number> {
  for (let offset = 0; offset <= MAX_PORT_PROBES; offset += 1) {
    const port = preferredPort + offset;
    if (port > 65535) break;
    if (reservedPorts.has(port)) continue;
    if (await isAvailable(host, port)) return port;
  }

  throw new Error(`No available port found near ${preferredPort} on ${host}`);
}

function mergeAllowedOrigins(existing: string | undefined, requiredOrigins: string[]): string[] {
  const values = [
    ...(existing || "").split(","),
    ...requiredOrigins,
  ];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uiOrigins(host: string, port: number): string[] {
  const origins = [`http://${host}:${port}`];
  if (host === "127.0.0.1") origins.push(`http://localhost:${port}`);
  return origins;
}

function browserHostForBindHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

function isPortAvailableOnHost(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function startDevServers(config: DevLocalConfig): ChildProcess[] {
  console.log(`Console hub: ${config.hubUrl}`);
  console.log(`Console UI:  ${config.uiUrl}`);
  console.log(`Allowed origins: ${config.allowedOrigins.join(",")}`);

  const hub = spawn(
    "npm",
    ["run", "serve", "--", "--host", config.host, "--port", String(config.hubPort)],
    {
      env: {
        ...process.env,
        CONSOLE_ALLOWED_ORIGINS: config.allowedOrigins.join(","),
      },
      stdio: "inherit",
    },
  );

  const ui = spawn(
    "npm",
    [
      "--workspace",
      "@kontourai/console-ui",
      "run",
      "dev",
      "--",
      "--host",
      config.host,
      "--port",
      String(config.uiPort),
      "--strictPort",
    ],
    {
      env: {
        ...baseUiEnv(process.env),
        VITE_CONSOLE_HUB_URL: config.hubUrl,
      },
      stdio: "inherit",
    },
  );

  return [hub, ui];
}

function baseUiEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = [
    "CI",
    "FORCE_COLOR",
    "HOME",
    "NO_COLOR",
    "NODE_OPTIONS",
    "PATH",
    "SHELL",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "npm_config_cache",
    "npm_config_prefix",
    "npm_config_user_agent",
  ];
  return Object.fromEntries(keys.flatMap((key) => {
    const value = env[key];
    return value === undefined ? [] : [[key, value]];
  }));
}

function watchChildren(children: ChildProcess[]): void {
  let shuttingDown = false;

  const shutdown = (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
    process.exitCode = exitCode;
  };

  process.once("SIGINT", () => shutdown(130));
  process.once("SIGTERM", () => shutdown(143));

  for (const child of children) {
    child.once("exit", (code, signal) => {
      if (shuttingDown) return;
      if (code && code !== 0) {
        console.error(`A dev server exited with code ${code}.`);
        shutdown(code);
      } else if (signal) {
        console.error(`A dev server exited from ${signal}.`);
        shutdown(1);
      } else {
        shutdown(0);
      }
    });
  }
}

function parsePort(value: string, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer from 1 to 65535`);
  }
  return port;
}

function requiredValue(args: string[], index: number, label: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${label} requires a value`);
  }
  return value;
}

function printUsage(): void {
  console.log("Usage: npm run dev:local -- [--host 127.0.0.1] [--hub-port 3738] [--ui-port 5175]");
}

async function main(): Promise<void> {
  try {
    const args = parseDevLocalArgs(process.argv.slice(2));
    const config = await buildDevLocalConfig(args);
    watchChildren(startDevServers(config));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDevLocalConfig,
  mergeAllowedOrigins,
  nextAvailablePort,
  parseDevLocalArgs,
};
