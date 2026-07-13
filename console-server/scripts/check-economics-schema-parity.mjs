#!/usr/bin/env node
// Cross-repo parity gate (#175). The console vendors flow-agents' canonical
// kontour.console.economics schema (console-server/schemas/...). Per ADR 0005,
// flow-agents authors the telemetry/economics semantics and is the SOURCE OF TRUTH.
// This fails CI if the console's vendored copy has drifted from flow-agents' canonical
// on `main` — forcing a re-vendor + a conscious reconciliation. It fails OPEN on network
// errors (an infra blip must not block CI) and CLOSED only on a confirmed semantic diff.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const VENDORED = path.join(dir, "..", "schemas", "kontour.console.economics.schema.json");
const CANONICAL_URL =
  "https://raw.githubusercontent.com/kontourai/flow-agents/main/scripts/telemetry/economics-record.schema.json";

const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
      : v;
const canon = (obj) => JSON.stringify(sortKeys(obj)); // semantic compare, formatting-agnostic

const vendored = JSON.parse(fs.readFileSync(VENDORED, "utf8"));

let canonical;
try {
  const res = await fetch(CANONICAL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  canonical = await res.json();
} catch (err) {
  console.warn(
    `[schema-parity] could not fetch flow-agents' canonical (${err.message}); skipping cross-repo check (network). ` +
      `Vendored copy unverified this run.`
  );
  process.exit(0);
}

if (canon(vendored) === canon(canonical)) {
  console.log("[schema-parity] OK — the console's vendored kontour.console.economics schema matches flow-agents' canonical.");
  process.exit(0);
}

console.error(
  "[schema-parity] DRIFT — the console's vendored economics schema no longer matches flow-agents' canonical " +
    "(the source of truth, ADR 0005)."
);
console.error("Re-vendor it:");
console.error(`  curl -sL ${CANONICAL_URL} -o console-server/schemas/kontour.console.economics.schema.json`);
console.error("then commit. If flow-agents changed the schema semantics, also update validateEconomicsRecordBody + the parity test.");
process.exit(1);
