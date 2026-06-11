#!/usr/bin/env node
// Bridges local Flow runs (.flow/runs/*) into a Console hub as
// kontour.console.event records. Read-only over Flow files; idempotent via
// hub-side event-id deduplication. --watch polls for run-state changes so the
// operating plane follows live work.
const path = require("node:path");
const {
  bridgeFlowRun,
  listFlowRunDirs,
} = require("../src/console-foundation/flow-bridge");

interface BridgeOptions {
  flowRoot: string;
  hubUrl: string;
  watch: boolean;
  intervalMs: number;
  scopeId?: string;
  scopeLabel?: string;
}

function printUsage(): void {
  process.stdout.write(
    "Usage: kontour-flow-bridge [--flow-root .flow] [--hub http://127.0.0.1:3737]\n" +
    "                           [--watch] [--interval-ms 2000] [--scope <id>] [--scope-label <label>]\n",
  );
}

function parseOptions(argv: string[]): BridgeOptions {
  const options: BridgeOptions = {
    flowRoot: ".flow",
    hubUrl: "http://127.0.0.1:3737",
    watch: false,
    intervalMs: 2000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") { options.watch = true; continue; }
    if (arg === "--help" || arg === "-h") { printUsage(); process.exit(0); }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    if (arg === "--flow-root") options.flowRoot = value;
    else if (arg === "--hub") options.hubUrl = value;
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

async function bridgeOnce(options: BridgeOptions): Promise<void> {
  const flowRoot = path.resolve(process.cwd(), options.flowRoot);
  const runDirs = listFlowRunDirs(flowRoot);
  if (runDirs.length === 0) {
    process.stdout.write(`no Flow runs under ${flowRoot}\n`);
    return;
  }
  for (const runDir of runDirs) {
    const delivery = await bridgeFlowRun(runDir, options.hubUrl, {
      scopeId: options.scopeId,
      scopeLabel: options.scopeLabel,
    }, sentIds);
    process.stdout.write(
      `${path.basename(runDir)}: ${delivery.events} events ` +
      `(${delivery.accepted} accepted, ${delivery.duplicates} duplicate, ${delivery.failed} failed)\n`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await bridgeOnce(options);
  if (!options.watch) return;
  process.stdout.write(`watching ${options.flowRoot} every ${options.intervalMs}ms; Ctrl+C to stop\n`);
  // Poll instead of fs.watch: Flow rewrites state.json atomically and the hub
  // dedupes, so a periodic full rescan is simple and correct.
  setInterval(() => {
    bridgeOnce(options).catch((error: Error) => {
      process.stderr.write(`bridge pass failed: ${error.message}\n`);
    });
  }, options.intervalMs);
}

main().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

export {};
