// Hosted-console ingest stub — Flow ingest contract v1 (provisional).
//
// Asserts the `POST /ingest/flow` handler:
//   - 202 { recordId } for a valid FlowIngestRequest envelope, AND that the
//     wrapped record is a well-formed kontour.console.event wrapping the payload.
//   - 4xx { error } for bad contractVersion / bad shape.
// Console validates the body against Flow's EXPORTED FlowIngestRequest type
// (dependency direction console -> flow) — see flow-ingest.ts imports.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  handleFlowIngest,
  validateFlowIngestRequest,
  wrapFlowIngestRecord,
} = require("../src/console-foundation/flow-ingest");

function fakeProjection(runId = "ingest-run") {
  return {
    schema_version: "0.1",
    run: {
      run_id: runId,
      definition_id: "demo",
      definition_version: "1",
      subject: "checkout-banner",
      status: "active",
      current_step: "verify",
      updated_at: "2026-06-16T00:00:00.000Z",
      params: {},
    },
    definition: { id: "demo", version: "1", title: null, description: null, raw: {} },
    steps: [],
    current_step: "verify",
    open_gates: [],
    gates: [],
    expectations: [],
    evidence: [],
    exceptions: [],
    transitions: [],
    route_backs: [],
    external_links: [],
    next_action: null,
    continuation: "",
    report: null,
  };
}

function validRequest(runId = "ingest-run", seq = 0) {
  return {
    contractVersion: "1",
    source: "flow",
    type: "flow.console.projection.0.1",
    idempotencyKey: `${runId}:${seq}`,
    occurredAt: "2026-06-16T00:00:00.000Z",
    payload: fakeProjection(runId),
  };
}

test("handleFlowIngest accepts a valid v1 envelope with 202 { recordId }", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const result = await handleFlowIngest(validRequest(), (record: Record<string, unknown>) => {
    captured.push(record);
  });

  assert.equal(result.status, 202);
  assert.ok(result.body.recordId, "202 body carries a recordId");

  // The wrapped record was handed to onRecord and is a well-formed
  // kontour.console.event envelope around the Flow-owned payload.
  assert.equal(captured.length, 1);
  const record = captured[0] as Record<string, any>;
  assert.equal(record.schema, "kontour.console.event");
  assert.equal(record.version, "0.1");
  assert.equal(record.id, result.body.recordId);
  assert.equal(record.type, "flow.console.projection.0.1");
  assert.equal(record.occurredAt, "2026-06-16T00:00:00.000Z");
  assert.equal(record.subject.product, "flow");
  assert.equal(record.subject.kind, "run");
  assert.equal(record.subject.id, "run-ingest-run");
  assert.equal(record.producer.product, "flow");
  // Console owns the envelope; Flow owns the wrapped payload, recorded read-only.
  assert.deepEqual(record.payload.after, fakeProjection());
});

test("recordId is derived from idempotencyKey (re-POST dedups deterministically)", async () => {
  const first = await handleFlowIngest(validRequest("r", 3));
  const second = await handleFlowIngest(validRequest("r", 3));
  assert.equal(first.body.recordId, second.body.recordId);
  // A different idempotencyKey yields a different record id.
  const other = await handleFlowIngest(validRequest("r", 4));
  assert.notEqual(first.body.recordId, other.body.recordId);
});

test("handleFlowIngest rejects a bad contractVersion with 4xx { error }", async () => {
  const bad = { ...validRequest(), contractVersion: "2" };
  const result = await handleFlowIngest(bad);
  assert.equal(result.status, 400);
  assert.match(result.body.error, /contractVersion/);
});

test("handleFlowIngest rejects a non-flow source", async () => {
  const result = await handleFlowIngest({ ...validRequest(), source: "surface" });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /source/);
});

test("handleFlowIngest rejects a malformed payload (not a FlowConsoleProjection)", async () => {
  const result = await handleFlowIngest({ ...validRequest(), payload: { not: "a projection" } });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /FlowConsoleProjection|run\.run_id/);
});

test("handleFlowIngest rejects a missing idempotencyKey", async () => {
  const bad = validRequest();
  delete (bad as Record<string, unknown>).idempotencyKey;
  const result = await handleFlowIngest(bad);
  assert.equal(result.status, 400);
  assert.match(result.body.error, /idempotencyKey/);
});

test("handleFlowIngest rejects a non-object body", async () => {
  assert.equal((await handleFlowIngest(null)).status, 400);
  assert.equal((await handleFlowIngest("nope")).status, 400);
  assert.equal((await handleFlowIngest([])).status, 400);
});

test("validateFlowIngestRequest returns the typed request on success", () => {
  const validation = validateFlowIngestRequest(validRequest());
  assert.equal(validation.ok, true);
});

test("wrapFlowIngestRecord produces a deterministic, id-safe record id", () => {
  const record = wrapFlowIngestRecord(validRequest("dev/7", 1));
  // idempotencyKey "dev/7:1" — slashes sanitized into an id-safe token.
  assert.match(record.id, /^evt-flowingest-/);
  assert.doesNotMatch(record.id, /\//);
});
