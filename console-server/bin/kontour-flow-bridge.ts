#!/usr/bin/env node
// Bridges local Flow runs (.kontourai/flow/runs/*) into a Console hub as
// kontour.console.event records. Read-only over Flow files; idempotent via
// hub-side event-id deduplication. --watch polls for run-state changes so the
// operating plane follows live work.
const path = require("node:path");
const {
  bridgeFlowRun,
  buildFlowBridgeSink,
  DEFAULT_FLOW_ROOT,
  discoverFlowRuns,
} = require("../src/console-foundation/flow-bridge");
import type { Sink } from "../src/console-foundation/types";

interface BridgeOptions {
  flowRoot: string;
  hubUrl: string;
  localRoot: string | null;
  authToken?: string;
  tenantId?: string;
  watch: boolean;
  intervalMs: number;
  scopeId?: string;
  scopeLabel?: string;
}

function printUsage(): void {
  process.stdout.write(
    `Usage: kontour-flow-bridge [--flow-root ${DEFAULT_FLOW_ROOT}] [--hub http://127.0.0.1:3737]\n` +
    "                           [--local-root .kontour] [--no-local] [--tenant <id>]\n" +
    "                           [--watch] [--interval-ms 2000] [--scope <id>] [--scope-label <label>]\n" +
    "\n" +
    "Auth: set CONSOLE_AUTH_TOKEN to authenticate against a hosted console.\n",
  );
}

function parseOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): BridgeOptions {
  const options: BridgeOptions = {
    flowRoot: DEFAULT_FLOW_ROOT,
    hubUrl: "http://127.0.0.1:3737",
    localRoot: ".kontour",
    authToken: env.CONSOLE_AUTH_TOKEN || env.CONSOLE_TELEMETRY_TOKEN,
    tenantId: env.CONSOLE_TENANT_ID,
    watch: false,
    intervalMs: 2000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") { options.watch = true; continue; }
    if (arg === "--no-local") { options.localRoot = null; continue; }
    if (arg === "--help" || arg === "-h") { printUsage(); process.exit(0); }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    if (arg === "--flow-root") options.flowRoot = value;
    else if (arg === "--hub") options.hubUrl = value;
    else if (arg === "--local-root") options.localRoot = value;
    else if (arg === "--tenant") options.tenantId = value;
    else if (arg === "--interval-ms") options.intervalMs = Number(value);
    else if (arg === "--scope") options.scopeId = value;
    else if (arg === "--scope-label") options.scopeLabel = value;
    else throw new Error(`unknown option: ${arg}`);
    index += 1;
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 250) {
    throw new Error("--interval-ms must be a number >= 250");
  }
  return options;
}

const sentIds = new Set<string>();

function bridgeSink(options: BridgeOptions): Sink {
  // Resolve config once, applied to whichever sinks are active. Local mirror is
  // always on (unless --no-local); the hosted ApiSink is added only when a hub
  // is configured — local-only work is unchanged when no token/hub is set.
  return buildFlowBridgeSink({
    localRoot: options.localRoot === null ? null : path.resolve(process.cwd(), options.localRoot),
    hubUrl: options.hubUrl,
    authToken: options.authToken,
    tenantId: options.tenantId,
  }, sentIds);
}

async function bridgeOnce(options: BridgeOptions, sink: Sink): Promise<void> {
  const flowRoot = path.resolve(process.cwd(), options.flowRoot);
  const discovery = discoverFlowRuns(flowRoot);
  const runDirs = discovery.runDirs;
  if (runDirs.length === 0) {
    process.stdout.write(`no Flow runs under ${flowRoot}\n`);
    return;
  }
  for (const runDir of runDirs) {
    const delivery = await bridgeFlowRun(runDir, sink, {
      scopeId: options.scopeId,
      scopeLabel: options.scopeLabel,
      allowedRunsRoot: discovery.allowedRunsRoot,
    }, sentIds);
    process.stdout.write(
      `${path.basename(runDir)}: ${delivery.events} events ` +
      `(${delivery.accepted} accepted, ${delivery.duplicates} duplicate, ${delivery.failed} failed)\n`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sink = bridgeSink(options);
  await bridgeOnce(options, sink);
  if (!options.watch) return;
  process.stdout.write(`watching ${options.flowRoot} every ${options.intervalMs}ms; Ctrl+C to stop\n`);
  // Poll instead of fs.watch: Flow rewrites state.json atomically and the hub
  // dedupes, so a periodic full rescan is simple and correct.
  setInterval(() => {
    bridgeOnce(options, sink).catch((error: Error) => {
      process.stderr.write(`bridge pass failed: ${error.message}\n`);
    });
  }, options.intervalMs);
}

main().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

export {};
