#!/usr/bin/env node
// Bridges flow-agents' local workflow-trust projection envelopes
// (.kontourai/console/projections/<producer>/*.json, written by the
// `flow-agents-console-trust-projection` CLI -- flow-agents#891) into a
// Console hub as `kontour.console.event` records. Read-only over the
// producer's envelope files; idempotent via content-addressed event ids +
// hub-side deduplication (console#254). --watch polls for envelope changes so
// the board's evidence/claims planes follow a flow-agents workflow's
// trust.bundle updates. Mirrors bin/kontour-process-bridge.ts.
const path = require("node:path");
const { DEFAULT_CONSOLE_RUNTIME_ROOT } = require("../src/console-foundation/runtime-root");
const {
  bridgeWorkflowTrustProjection,
  buildWorkflowTrustBridgeSink,
  DEFAULT_WORKFLOW_TRUST_PROJECTION_ROOT,
  discoverWorkflowTrustProjections,
} = require("../src/console-foundation/workflow-trust-bridge");
import type { Sink } from "../src/console-foundation/types";

interface BridgeOptions {
  projectionRoot: string;
  hubUrl: string;
  localRoot: string | null;
  authToken?: string;
  tenantId?: string;
  watch: boolean;
  intervalMs: number;
  scopeLabel?: string;
}

function printUsage(): void {
  process.stdout.write(
    `Usage: kontour-trust-bridge [--projection-root ${DEFAULT_WORKFLOW_TRUST_PROJECTION_ROOT}] [--hub http://127.0.0.1:3737]\n` +
    `                            [--local-root ${DEFAULT_CONSOLE_RUNTIME_ROOT}] [--no-local] [--tenant <id>]\n` +
    "                            [--watch] [--interval-ms 2000] [--scope-label <label>]\n" +
    "\n" +
    "Auth: set CONSOLE_AUTH_TOKEN to authenticate against a hosted console.\n",
  );
}

function parseOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): BridgeOptions {
  const options: BridgeOptions = {
    projectionRoot: DEFAULT_WORKFLOW_TRUST_PROJECTION_ROOT,
    hubUrl: "http://127.0.0.1:3737",
    localRoot: DEFAULT_CONSOLE_RUNTIME_ROOT,
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
    if (arg === "--projection-root") options.projectionRoot = value;
    else if (arg === "--hub") options.hubUrl = value;
    else if (arg === "--local-root") options.localRoot = value;
    else if (arg === "--tenant") options.tenantId = value;
    else if (arg === "--interval-ms") options.intervalMs = Number(value);
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
  return buildWorkflowTrustBridgeSink({
    localRoot: options.localRoot === null ? null : path.resolve(process.cwd(), options.localRoot),
    hubUrl: options.hubUrl,
    authToken: options.authToken,
    tenantId: options.tenantId,
  }, sentIds);
}

async function bridgeOnce(options: BridgeOptions, sink: Sink): Promise<void> {
  const projectionRoot = path.resolve(process.cwd(), options.projectionRoot);
  const discovery = discoverWorkflowTrustProjections(projectionRoot);
  const envelopePaths = discovery.envelopePaths;
  if (envelopePaths.length === 0) {
    process.stdout.write(`no workflow-trust projections under ${projectionRoot}\n`);
    return;
  }
  for (const envelopePath of envelopePaths) {
    try {
      const delivery = await bridgeWorkflowTrustProjection(envelopePath, sink, {
        scopeLabel: options.scopeLabel,
        allowedRoot: discovery.allowedRoot,
      }, sentIds);
      for (const warning of delivery.warnings) {
        process.stderr.write(`warning: ${path.basename(envelopePath)}: ${warning}\n`);
      }
      process.stdout.write(
        `${path.basename(envelopePath)}: ${delivery.events} events ` +
        `(${delivery.accepted} accepted, ${delivery.duplicates} duplicate, ${delivery.failed} failed)\n`,
      );
    } catch (error) {
      process.stderr.write(`${path.basename(envelopePath)}: ${(error as Error).message}\n`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const sink = bridgeSink(options);
  await bridgeOnce(options, sink);
  if (!options.watch) return;
  process.stdout.write(`watching ${options.projectionRoot} every ${options.intervalMs}ms; Ctrl+C to stop\n`);
  // Poll instead of fs.watch: the producer CLI rewrites envelope files atomically
  // and the sink/hub dedupes unchanged content, so a periodic full rescan is
  // simple and correct.
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
