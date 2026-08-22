// Hosted-console Flow ingest endpoint — contract v1, mounted on the HTTP server.
//
// Asserts the live `POST /ingest/flow` route (and `GET /ingest/flow/:runId`):
//   - 202 { recordId } for a valid FlowIngestRequest, and the accepted record
//     fires the SSE `record.accepted` broadcast.
//   - 400 { error } on a bad shape.
//   - 401 when the bearer token is absent/invalid.
//   - Disabled (404) when no ingest token is configured (no unauthenticated writes).
//   - Idempotency: a re-POST with the same idempotencyKey returns the SAME
//     recordId and does NOT append a second record.
//   - GET /ingest/flow/:runId returns the stored read-only projection (404 when absent).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConsoleHubServer } = require("../src/console-foundation");

const INGEST_TOKEN = "ingest-secret-token";
const LOCAL_UI_ORIGIN = "http://127.0.0.1:5173";

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

function bearer(token = INGEST_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

test("POST /ingest/flow accepts a valid envelope with 202 { recordId }", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const result = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest(), bearer());
    assert.equal(result.statusCode, 202);
    assert.ok(result.body.recordId, "202 body carries a recordId");
    assert.match(result.body.recordId, /^evt-flowingest-/);

    // The wrapped record landed in the hub's operating state.
    const state = await requestJson("GET", `${baseUrl}/state`);
    assert.equal(state.body.source.acceptedEventCount, 1);
  } finally {
    await close(app);
  }
});

test("POST /ingest/flow rejects a bad shape with 400 { error }", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const bad = { ...validRequest(), contractVersion: "2" };
    const result = await requestJson("POST", `${baseUrl}/ingest/flow`, bad, bearer());
    assert.equal(result.statusCode, 400);
    assert.match(result.body.safeMessage, /contractVersion/);
  } finally {
    await close(app);
  }
});

test("POST /ingest/flow rejects a missing/invalid bearer with 401", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const missing = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest());
    assert.equal(missing.statusCode, 401);
    const wrong = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest(), bearer("nope"));
    assert.equal(wrong.statusCode, 401);
  } finally {
    await close(app);
  }
});

test("POST /ingest/flow is disabled (404) when no ingest token is configured", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    // Even with a bearer header, an unconfigured endpoint returns 404 and never
    // accepts the write.
    const result = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest(), bearer());
    assert.equal(result.statusCode, 404);
    const state = await requestJson("GET", `${baseUrl}/state`);
    assert.equal(state.body.source.acceptedEventCount, 0, "no write was accepted");
  } finally {
    await close(app);
  }
});

test("POST /ingest/flow dedups on idempotencyKey (same recordId, no second append)", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const first = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest("r", 7), bearer());
    const second = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest("r", 7), bearer());

    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.equal(first.body.recordId, second.body.recordId, "same recordId on replay");

    // Only ONE record was appended despite two POSTs.
    const state = await requestJson("GET", `${baseUrl}/state`);
    assert.equal(state.body.source.acceptedEventCount, 1, "no double-append");

    // A different idempotencyKey appends a second record.
    const other = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest("r", 8), bearer());
    assert.notEqual(other.body.recordId, first.body.recordId);
    const state2 = await requestJson("GET", `${baseUrl}/state`);
    assert.equal(state2.body.source.acceptedEventCount, 2);
  } finally {
    await close(app);
  }
});

test("an accepted ingest record fires the SSE record.accepted broadcast", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  const streamClient: { request?: any } = {};
  try {
    const baseUrl = serverUrl(app);
    const eventStream = connectSse(`${baseUrl}/stream`, streamClient);
    await eventStream.nextEvent(); // ready
    await eventStream.nextEvent(); // initial state

    const result = await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest("sse-run", 1), bearer());
    assert.equal(result.statusCode, 202);

    const update = await eventStream.nextEvent();
    assert.equal(update.event, "record.accepted");
    assert.equal(update.data.delivery.outcome, "accepted");
    assert.equal(update.data.delivery.recordId, result.body.recordId);
    assert.equal(update.data.state.source.acceptedEventCount, 1);
  } finally {
    if (streamClient.request) streamClient.request.destroy();
    await close(app);
  }
});

test("GET /ingest/flow/:runId returns the stored projection (404 when absent)", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    // Not recorded yet -> 404.
    const missing = await requestJson("GET", `${baseUrl}/ingest/flow/run-x`, undefined, bearer());
    assert.equal(missing.statusCode, 404);

    // After ingest, the read endpoint serves the stored FlowConsoleProjection.
    await requestJson("POST", `${baseUrl}/ingest/flow`, validRequest("read-run", 0), bearer());
    const found = await requestJson("GET", `${baseUrl}/ingest/flow/read-run`, undefined, bearer());
    assert.equal(found.statusCode, 200);
    assert.equal(found.body.run.run_id, "read-run");
    assert.deepEqual(found.body, fakeProjection("read-run"));

    // The read endpoint is also bearer-guarded.
    const unauth = await requestJson("GET", `${baseUrl}/ingest/flow/read-run`);
    assert.equal(unauth.statusCode, 401);
  } finally {
    await close(app);
  }
});

// ── gate scorecard read surface (console #277/#278) ───────────────────────────
//
// The scorecard projection is FED at POST /ingest/flow and READ at
// GET /api/gates/scorecard — the wiring review round 1 found missing entirely
// (BLOCKING-2: the fold existed but nothing instantiated or served it). These
// tests drive the REAL route with REAL producer-captured payloads.

const scorecardFixture = (name: string) => JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "gate-scorecard", `${name}.json`), "utf8"),
);

test("GET /api/gates/scorecard serves the fold of everything accepted at POST /ingest/flow", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    // Before any ingest: an EMPTY scorecard, not an error — nothing ran is a
    // statement the panel can render honestly.
    const empty = await requestJson("GET", `${baseUrl}/api/gates/scorecard`);
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.body.entries, []);
    assert.equal(empty.body.runs_folded, 0);

    // Ingest a real producer projection through the real route.
    const snapshotA = scorecardFixture("builder-demo.snapshot-a");
    const post = await requestJson("POST", `${baseUrl}/ingest/flow`, {
      contractVersion: "1",
      source: "flow",
      type: "flow.console.projection.0.1",
      idempotencyKey: "builder-demo:1",
      occurredAt: "2026-08-22T00:00:00.000Z",
      payload: snapshotA,
    }, bearer());
    assert.equal(post.statusCode, 202);

    const card = await requestJson("GET", `${baseUrl}/api/gates/scorecard`);
    assert.equal(card.statusCode, 200);
    assert.deepEqual(card.body.flows_observed, ["builder.demo"]);
    assert.equal(card.body.runs_folded, 1);
    const planReview = card.body.entries.find((e: any) => e.gate_id === "plan.review");
    assert.equal(planReview.state, "invoked");
    assert.equal(planReview.route_backs, 1);

    // A LATER snapshot of the SAME run (new idempotencyKey) supersedes: still one
    // run folded, and the entries reflect the newer snapshot.
    const snapshotB = scorecardFixture("builder-demo.snapshot-b");
    await requestJson("POST", `${baseUrl}/ingest/flow`, {
      contractVersion: "1",
      source: "flow",
      type: "flow.console.projection.0.1",
      idempotencyKey: "builder-demo:2",
      occurredAt: "2026-08-22T00:01:00.000Z",
      payload: snapshotB,
    }, bearer());
    const updated = await requestJson("GET", `${baseUrl}/api/gates/scorecard`);
    assert.equal(updated.body.runs_folded, 1, "same run superseded, not double-counted");
    const planAfter = updated.body.entries.find((e: any) => e.gate_id === "plan.review");
    assert.equal(planAfter.refusals, 0, "snapshot B's pass verdict superseded A's route-back");
    assert.equal(planAfter.route_backs, 1);
    // The orphan expectation carried by snapshot B's evidence is SHOWN, not dropped.
    assert.equal(updated.body.unattributable.length, 1);
    assert.equal(updated.body.unattributable[0].expectation_id, "ghost.expectation");
  } finally {
    await close(app);
  }
});

test("GET /api/gates/scorecard rejects an unparseable since with 400 and accepts a valid one", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0, ingestToken: INGEST_TOKEN });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const bad = await requestJson("GET", `${baseUrl}/api/gates/scorecard?since=yesterday-ish`);
    assert.equal(bad.statusCode, 400);

    await requestJson("POST", `${baseUrl}/ingest/flow`, {
      contractVersion: "1",
      source: "flow",
      type: "flow.console.projection.0.1",
      idempotencyKey: "builder-demo:window",
      occurredAt: "2026-08-22T00:00:00.000Z",
      payload: scorecardFixture("builder-demo.snapshot-b"),
    }, bearer());
    // A window in the future: the run falls out of it, but the flow's declared
    // gates stay visible as `unexercised` (scope DERIVED from retained runs).
    const windowed = await requestJson("GET", `${baseUrl}/api/gates/scorecard?since=2100-01-01T00:00:00.000Z`);
    assert.equal(windowed.statusCode, 200);
    assert.equal(windowed.body.runs_folded, 0);
    assert.equal(windowed.body.window.since, "2100-01-01T00:00:00.000Z");
    assert.equal(windowed.body.entries.every((e: any) => e.state === "unexercised"), true);
    assert.equal(windowed.body.entries.length, 3);
  } finally {
    await close(app);
  }
});

// ── helpers (mirror console-hub-server.test.ts) ────────────────────────────────

function listen(app: any) {
  return new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
}

function close(app: any) {
  return new Promise((resolve: any, reject: any) => {
    app.close((error: any) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function serverUrl(app: any) {
  const address = app.server.address();
  return `http://${address.address}:${address.port}`;
}

function requestJson(method: any, url: any, payload?: any, extraHeaders: Record<string, string> = {}): Promise<{ statusCode?: number; body: any }> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return rawRequest(method, url, body, extraHeaders).then((result: any) => ({
    statusCode: result.statusCode,
    body: JSON.parse(result.body)
  }));
}

function rawRequest(method: any, url: any, body?: any, extraHeaders: Record<string, string> = {}): Promise<{ statusCode?: number; headers: any; body: string }> {
  return new Promise((resolve: any, reject: any) => {
    const request = http.request(url, {
      method,
      headers: body === undefined
        ? extraHeaders
        : {
          ...extraHeaders,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        }
    }, (response: any) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: any) => { responseBody += chunk; });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode, headers: response.headers, body: responseBody });
      });
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function connectSse(url: any, holder: { request?: any; headers?: any } = {}, extraHeaders: Record<string, string> = {}) {
  const queue: Array<{ event: string; data: any }> = [];
  const waiting: Array<(event: { event: string; data: any }) => void> = [];
  let buffer = "";
  let currentEvent: string | null = null;
  let currentData: string[] = [];

  const request = http.request(url, { method: "GET", headers: { accept: "text/event-stream", origin: LOCAL_UI_ORIGIN, ...extraHeaders } }, (response: any) => {
    holder.headers = response.headers;
    response.setEncoding("utf8");
    response.on("data", (chunk: any) => {
      buffer += chunk;
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event: ")) currentEvent = line.slice("event: ".length);
          if (line.startsWith("data: ")) currentData.push(line.slice("data: ".length));
        }
        if (currentEvent) {
          enqueueEvent({ event: currentEvent, data: JSON.parse(currentData.join("\n") || "{}") });
        }
        currentEvent = null;
        currentData = [];
        boundary = buffer.indexOf("\n\n");
      }
    });
  });
  holder.request = request;
  request.end();

  return {
    nextEvent(): Promise<{ event: string; data: any }> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      return new Promise((resolve: any) => waiting.push(resolve));
    }
  };

  function enqueueEvent(event: { event: string; data: any }) {
    if (waiting.length) waiting.shift()!(event);
    else queue.push(event);
  }
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "console-ingest-"));
}
