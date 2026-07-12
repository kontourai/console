// Binds the console's hand-coded validateEconomicsRecordBody to the canonical
// kontour.console.economics JSON Schema so the validator cannot silently drift from
// the contract (#175).
//
// Boundary (ADR 0005): flow-agents authors the telemetry/economics semantics and owns
// the canonical schema (scripts/telemetry/economics-record.schema.json). The console is a
// CONFORMING CONSUMER — `schemas/kontour.console.economics.schema.json` is a byte-identical
// vendored copy of that canonical, and this test asserts the console's ingest validator
// honors every field the schema marks required. A cross-repo check that the vendored copy
// still matches flow-agents' canonical is the remaining #175 slice.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateEconomicsRecordBody } = require("../src/console-foundation");

const SCHEMA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "schemas", "kontour.console.economics.schema.json"), "utf8")
);
const loadFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "economics", name), "utf8"));
const VALID = loadFixture("valid-record.json");

// `schema` (the discriminator) is enforced by the router that dispatches to this validator,
// not by the validator itself — so it's excluded from the per-field loop below.
const VALIDATOR_OWNED_REQUIRED: string[] = (SCHEMA.required as string[]).filter((f) => f !== "schema");

test("parity: the vendored schema declares the expected required fields", () => {
  // Guards against the vendored copy being replaced with something shapeless.
  for (const f of ["schema", "version", "run_id", "cost", "time", "iterations", "defects"]) {
    assert.ok((SCHEMA.required as string[]).includes(f), `canonical schema must require '${f}'`);
  }
});

test("parity: validateEconomicsRecordBody accepts a canonical valid record", () => {
  assert.doesNotThrow(() => validateEconomicsRecordBody(VALID));
});

test("parity: every schema-required field is enforced by the console validator (no drift)", () => {
  for (const field of VALIDATOR_OWNED_REQUIRED) {
    const missing = { ...VALID };
    delete (missing as Record<string, unknown>)[field];
    assert.throws(
      () => validateEconomicsRecordBody(missing),
      (err: any) => Boolean(err) && err.statusCode === 400,
      `validator/schema drift: a record missing required field '${field}' must be rejected 400`
    );
  }
});
