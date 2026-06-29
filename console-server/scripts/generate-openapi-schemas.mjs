#!/usr/bin/env node
// Generates JSON Schemas for the console API from the TypeScript types
// (src/console-foundation/types.ts), so the OpenAPI spec's data shapes are
// DERIVED FROM CODE rather than hand-authored. Output:
//   src/console-foundation/openapi/schemas.generated.json
//
// Run: npm run generate:openapi -w console-server
// The CI drift test (openapi.test.ts) re-runs this and fails if the committed
// file is stale.
//
// We generate per root type (not "*") because one node in types.ts isn't
// parseable by the generator; per-type traversal only visits referenced types
// and merges their definitions.
import { createGenerator } from "ts-json-schema-generator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const consoleServerDir = path.resolve(scriptDir, "..");
const typesPath = path.join(consoleServerDir, "src/console-foundation/types.ts");
const tsconfig = path.join(consoleServerDir, "tsconfig.openapi.json");
const outPath = process.env.OPENAPI_SCHEMAS_OUT
  ? path.resolve(process.env.OPENAPI_SCHEMAS_OUT)
  : path.join(consoleServerDir, "src/console-foundation/openapi/schemas.generated.ts");

// Root API types whose reference-closure covers the documented request/response shapes.
const ROOT_TYPES = [
  "TelemetrySummary",
  "TelemetryRecord",
  "DeliveryResult",
  "TelemetryAnalyticsSummary",
  "TelemetryUsageTotals",
  "ValidationIssue"
];

const base = { path: typesPath, tsconfig, skipTypeCheck: true, additionalProperties: false };
const definitions = {};
const generated = [];
const skipped = [];
for (const type of ROOT_TYPES) {
  try {
    const schema = createGenerator({ ...base, type }).createSchema(type);
    Object.assign(definitions, schema.definitions || {});
    generated.push(type);
  } catch (err) {
    skipped.push(`${type}: ${err.message}`);
  }
}

const sortedDefs = {};
for (const key of Object.keys(definitions).sort()) sortedDefs[key] = definitions[key];

const header = "// GENERATED from src/console-foundation/types.ts by scripts/generate-openapi-schemas.mjs.\n"
  + "// Do not edit by hand. Run: npm run generate:openapi -w console-server\n"
  + "// JSON Schema (draft-07) definitions for the console API types; consumed by openapi.ts.\n";
const body = `export const GENERATED_DEFINITIONS: Record<string, unknown> = ${JSON.stringify(sortedDefs, null, 2)};\n`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header + body);
console.log(`generated ${generated.length} root types, ${Object.keys(sortedDefs).length} definitions -> ${path.relative(consoleServerDir, outPath)}`);
if (skipped.length) console.warn("skipped:", skipped.join("; "));
