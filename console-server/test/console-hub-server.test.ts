const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyConsoleMigrations,
  createConsoleHubServer,
  inspectFixtures,
  loadConsoleMigrations
} = require("../src/console-foundation");
const { signSessionCookie, verifySessionCookieValue } = require("../src/console-foundation/console-hub-server");
const { CoreRecordsRepository } = require("../src/console-foundation/core-records");

type RawResponse = { statusCode?: number; headers: Record<string, any>; body: string };
type JsonResponse = { statusCode?: number; body: any };
type SseEvent = { event: string; data: any };
type SseHolder = { request?: any; headers?: Record<string, any> };
const LOCAL_UI_ORIGIN = "http://127.0.0.1:5173";

test("local hub server accepts records and exposes current state", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const stream = surfaceFlowHandoffStream();
    const learningEvent = advisoryLearningEvent();
    const results = [];

    for (const event of stream.events) {
      results.push(await requestJson("POST", `${baseUrl}/records`, event));
    }
    results.push(await requestJson("POST", `${baseUrl}/records`, learningEvent));

    const state = await requestJson("GET", `${baseUrl}/state`);
    const inspection = await requestJson("GET", `${baseUrl}/inspect`);
    const events = await requestJson("GET", `${baseUrl}/events`);

    assert.deepEqual(results.map((item: any) => item.statusCode), [202, 202, 202, 202, 202, 202, 202]);
    assert.equal(state.body.source.acceptedEventCount, 7);
    assert.equal(state.body.gates[0].status, "passed");
    assert.equal(state.body.claims[0].freshness.status, "fresh");
    assert.equal(state.body.actions[0].readOnly, true);
    assert.equal(state.body.actions.length, 1);
    assert.equal(state.body.currentStage, "Provider directory freshness passed; Provider directory refresh can continue.");
    assert.equal(state.body.learnings[0].id, "learning-provider-directory-operator-note");
    assert.equal(state.body.learnings[0].nonAuthority, true);
    assert.deepEqual(state.body.learnings[0].refs.map((ref: any) => `${ref.product}:${ref.kind}:${ref.id}`), [
      "flow:run:run-provider-directory-refresh",
      "surface:claim:claim-provider-directory-current"
    ]);
    assert.equal(inspection.body.validation.errors.length, 0);
    assert.equal(inspection.body.eventStreams.length, 3);
    assert.equal(events.statusCode, 200);
    assert.equal(events.body.reduce((sum: any, item: any) => sum + item.events.length, 0), 7);
  } finally {
    await close(app);
  }
});

test("local hub server streams accepted record updates over SSE", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  const streamClient: SseHolder = {};
  try {
    const baseUrl = serverUrl(app);
    const eventStream = connectSse(`${baseUrl}/stream`, streamClient);
    const ready = await eventStream.nextEvent();
    const initialState = await eventStream.nextEvent();
    const stream = surfaceFlowHandoffStream();
    const learningEvent = advisoryLearningEvent();
    const invalid = await requestJson("POST", `${baseUrl}/records`, {
      schema: "kontour.console.event",
      version: "0.1",
      id: "bad-event"
    });
    const result = await requestJson("POST", `${baseUrl}/records`, stream.events[0]);
    const update = await eventStream.nextEvent();
    const learningResult = await requestJson("POST", `${baseUrl}/records`, learningEvent);
    const learningUpdate = await eventStream.nextEvent();

    assert.equal(ready.event, "ready");
    assert.equal(initialState.event, "state");
    assert.equal(streamClient.headers!["access-control-allow-origin"], LOCAL_UI_ORIGIN);
    assert.equal(initialState.data.source.acceptedEventCount, 0);
    assert.equal(invalid.statusCode, 400);
    assert.equal(result.statusCode, 202);
    assert.equal(update.event, "record.accepted");
    assert.equal(update.data.delivery.outcome, "accepted");
    assert.equal(update.data.delivery.recordId, "evt-surface-flow-handoff-001");
    assert.equal(update.data.state.source.acceptedEventCount, 1);
    assert.equal(update.data.state.timeline[0].id, "evt-surface-flow-handoff-001");
    assert.equal(learningResult.statusCode, 202);
    assert.equal(learningUpdate.event, "record.accepted");
    assert.equal(learningUpdate.data.delivery.recordId, "evt-learning-provider-directory-operator-note");
    assert.equal(learningUpdate.data.state.learnings[0].id, "learning-provider-directory-operator-note");
    assert.equal(learningUpdate.data.state.claims.length, 0);
    assert.equal(learningUpdate.data.state.gates.length, 0);
    assert.equal(learningUpdate.data.state.actions.length, 0);
  } finally {
    if (streamClient.request) streamClient.request.destroy();
    await close(app);
  }
});

test("local hub server keeps /events as an SSE compatibility alias", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  const streamClient: SseHolder = {};
  try {
    const baseUrl = serverUrl(app);
    const eventStream = connectSse(`${baseUrl}/events`, streamClient);
    const ready = await eventStream.nextEvent();
    const initialState = await eventStream.nextEvent();
    const result = await requestJson("POST", `${baseUrl}/records`, surfaceFlowHandoffStream().events[0]);
    const update = await eventStream.nextEvent();

    assert.equal(ready.event, "ready");
    assert.equal(initialState.event, "state");
    assert.equal(result.statusCode, 202);
    assert.equal(update.event, "record.accepted");
    assert.equal(update.data.delivery.recordId, "evt-surface-flow-handoff-001");
  } finally {
    if (streamClient.request) streamClient.request.destroy();
    await close(app);
  }
});

test("local hub server keeps learning-only updates advisory over SSE", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  const streamClient: SseHolder = {};
  try {
    const baseUrl = serverUrl(app);
    const eventStream = connectSse(`${baseUrl}/events`, streamClient);
    await eventStream.nextEvent();
    await eventStream.nextEvent();

    const result = await requestJson("POST", `${baseUrl}/records`, advisoryLearningEvent());
    const update = await eventStream.nextEvent();
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(result.statusCode, 202);
    assert.equal(update.event, "record.accepted");
    assert.equal(update.data.state.currentStage, "No authoritative events replayed.");
    assert.equal(update.data.state.learnings.length, 1);
    assert.equal(update.data.state.claims.length, 0);
    assert.equal(update.data.state.gates.length, 0);
    assert.equal(update.data.state.actions.length, 0);
    assert.equal(state.body.currentStage, "No authoritative events replayed.");
    assert.equal(state.body.actions.length, 0);
  } finally {
    if (streamClient.request) streamClient.request.destroy();
    await close(app);
  }
});

test("local hub server accepts projection records through local file sink", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const projection = surfaceFlowHandoffProjection();
    const result = await requestJson("POST", `${baseUrl}/records`, projection.snapshot);
    const inspection = await requestJson("GET", `${baseUrl}/inspect`);
    const projectionPath = path.join(
      rootDir,
      ".kontourai",
      "console",
      "projections",
      projection.snapshot.producer.id,
      `${projection.snapshot.scope.kind}-${projection.snapshot.scope.id}.json`
    );

    assert.equal(result.statusCode, 202);
    assert.equal(result.body.outcome, "accepted");
    assert.equal(result.body.recordKind, "projection");
    assert.equal(fs.existsSync(projectionPath), true);
    assert.equal(inspection.body.projections.length, 1);
    assert.equal(inspection.body.projections[0].snapshot.id, projection.snapshot.id);
    assert.equal(inspection.body.validation.errors.length, 0);
  } finally {
    await close(app);
  }
});

test("local hub server allows loopback browser preflight requests", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const result = await rawRequest("OPTIONS", `${baseUrl}/records`, undefined, {
      origin: LOCAL_UI_ORIGIN,
      "access-control-request-method": "POST"
    });

    assert.equal(result.statusCode, 204);
    assert.equal(result.headers["access-control-allow-origin"], LOCAL_UI_ORIGIN);
    assert.equal(result.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
    assert.equal(result.headers["access-control-allow-headers"], "authorization, content-type, x-console-api-token, x-console-telemetry-token, x-console-tenant-id");
  } finally {
    await close(app);
  }
});

test("local hub server rejects unexpected browser origins", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const rejected = await rawRequest("POST", `${baseUrl}/records`, JSON.stringify(surfaceFlowHandoffStream().events[0]), {
      origin: "http://localhost:9999",
      "content-type": "application/json"
    });
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.headers["access-control-allow-origin"], undefined);
    assert.equal(JSON.parse(rejected.body).error, "ORIGIN_NOT_ALLOWED");
    assert.equal(state.body.source.acceptedEventCount, 0);
  } finally {
    await close(app);
  }
});

test("local hub server allows explicitly configured browser origins", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    allowedOrigins: ["http://localhost:9999"]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const allowed = await rawRequest("GET", `${baseUrl}/state`, undefined, {
      origin: "http://localhost:9999"
    });

    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:9999");
    assert.equal(JSON.parse(allowed.body).source.acceptedEventCount, 0);
  } finally {
    await close(app);
  }
});

test("local hub server summarizes telemetry logs without product-specific descriptors", async () => {
  const rootDir = tempRoot();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  const flowAgentsRoot = path.join(rootDir, "flow-agents", ".kontourai", "flow-agents");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  fs.mkdirSync(path.join(flowAgentsRoot, "telemetry-task"), { recursive: true });
  const richRecord: any = telemetryRecord("evt-telemetry-1", "tool.invoke", "session-a", "2026-06-08T12:00:00.000Z");
  richRecord.agent.version = "codex-cli 0.138.0";
  richRecord.hook = {
    event_name: "PreToolUse",
    runtime_session_id: "runtime-session-a",
    turn_id: "turn-a",
    model: "gpt-5.5"
  };
  richRecord.context = { cwd: "/workspace/kontour-console" };
  richRecord.tool = { name: "Bash", normalized_name: "execute_bash", status: "ok" };
  richRecord.delegation = { targets: ["tool-worker"] };
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), `${JSON.stringify(richRecord)}\n`, "utf8");
  fs.writeFileSync(path.join(telemetryRoot, "analytics.jsonl"), `${JSON.stringify(telemetryRecord("evt-telemetry-2", "turn.user", "session-a", "2026-06-08T12:01:00.000Z"))}\n`, "utf8");
  fs.writeFileSync(path.join(flowAgentsRoot, "telemetry-task", "state.json"), JSON.stringify({
    schema_version: "1.0",
    task_slug: "telemetry-task",
    status: "complete",
    updated_at: "2026-06-08T12:02:00.000Z"
  }), "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.totals.recordCount, 2);
    assert.equal(telemetry.body.totals.sessionCount, 1);
    assert.equal(telemetry.body.totals.eventTypeCounts["tool.invoke"], 1);
    assert.equal(telemetry.body.totals.productRecordCount, 0);
    assert.equal(telemetry.body.records.some((record: any) => record.eventId === "evt-telemetry-1"), true);
    const richSummary = telemetry.body.records.find((record: any) => record.eventId === "evt-telemetry-1");
    assert.equal(richSummary.project, "kontour-console");
    assert.equal(richSummary.cwd, "/workspace/kontour-console");
    assert.equal(richSummary.runtimeVersion, "codex-cli 0.138.0");
    assert.equal(richSummary.model, "gpt-5.5");
    assert.equal(richSummary.hookEventName, "PreToolUse");
    assert.equal(richSummary.runtimeSessionId, "runtime-session-a");
    assert.equal(richSummary.turnId, "turn-a");
    assert.equal(richSummary.delegationTarget, "tool-worker");
    assert.equal(richSummary.outcome, "ok");
    assert.equal(telemetry.body.analytics.facets.some((facet: any) => facet.id === "projects" && facet.counts.some((item: any) => item.name === "kontour-console")), true);
    assert.equal(telemetry.body.analytics.facets.some((facet: any) => facet.id === "models" && facet.counts.some((item: any) => item.name === "gpt-5.5")), true);
    assert.equal(telemetry.body.sources.some((source: any) => String(source.path).startsWith(rootDir)), false);
    assert.equal(telemetry.body.sources.some((source: any) => String(source.path).includes("..")), false);
    assert.equal(telemetry.body.records.some((record: any) => String(record.path).startsWith(rootDir)), false);
    assert.equal(telemetry.body.records.some((record: any) => String(record.path).includes("..")), false);
  } finally {
    await close(app);
  }
});

test("telemetry project facet prefers context.project over basename(context.cwd) when both are present", async () => {
  const rootDir = tempRoot();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  // context.project deliberately disagrees with basename(cwd) so the assertion
  // proves preference, not coincidence.
  const record: any = telemetryRecord("evt-project-pref", "tool.invoke", "session-project-pref", "2026-07-07T12:00:00.000Z");
  record.context = { cwd: "/workspace/some-checkout-dir", project: "kontour-console" };
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), `${JSON.stringify(record)}\n`, "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);
    const summary = telemetry.body.records.find((item: any) => item.eventId === "evt-project-pref");

    assert.equal(telemetry.statusCode, 200);
    assert.ok(summary, "the record should be summarized");
    assert.equal(summary.project, "kontour-console");
    assert.equal(summary.cwd, "/workspace/some-checkout-dir");
    assert.equal(telemetry.body.analytics.facets.some((facet: any) => facet.id === "projects" && facet.counts.some((item: any) => item.name === "kontour-console")), true);
  } finally {
    await close(app);
  }
});

test("telemetry project facet falls back to basename(context.cwd) when context.project is absent (redacted cwd emitter)", async () => {
  const rootDir = tempRoot();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  const record: any = telemetryRecord("evt-project-fallback", "tool.invoke", "session-project-fallback", "2026-07-07T12:00:00.000Z");
  record.context = { cwd: "/workspace/legacy-emitter-project" };
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), `${JSON.stringify(record)}\n`, "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);
    const summary = telemetry.body.records.find((item: any) => item.eventId === "evt-project-fallback");

    assert.equal(summary.project, "legacy-emitter-project");
  } finally {
    await close(app);
  }
});

test("local hub server filters telemetry query by time, search, repeated facets, and pagination", async () => {
  const rootDir = tempRoot();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  const bashA: any = telemetryRecord("evt-query-bash-a", "tool.invoke", "session-query-a", "2026-06-08T12:00:00.000Z");
  bashA.context = { cwd: "/workspace/project-alpha" };
  bashA.tool = { name: "Bash", normalized_name: "bash", status: "ok" };
  const bashB: any = telemetryRecord("evt-query-bash-b", "tool.invoke", "session-query-b", "2026-06-08T12:05:00.000Z");
  bashB.context = { cwd: "/workspace/project-beta" };
  bashB.tool = { name: "Bash", normalized_name: "bash", status: "ok" };
  const edit: any = telemetryRecord("evt-query-edit", "tool.invoke", "session-query-c", "2026-06-08T12:10:00.000Z");
  edit.context = { cwd: "/workspace/project-alpha" };
  edit.tool = { name: "Edit", normalized_name: "edit", status: "ok" };
  const old: any = telemetryRecord("evt-query-old", "tool.invoke", "session-query-old", "2026-06-07T12:00:00.000Z");
  old.context = { cwd: "/workspace/project-alpha" };
  old.tool = { name: "Bash", normalized_name: "bash", status: "ok" };
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), [bashA, bashB, edit, old].map((record) => JSON.stringify(record)).join("\n"), "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry?preset=custom&from=2026-06-08T00%3A00%3A00.000Z&to=2026-06-09T00%3A00%3A00.000Z&q=bash&filter=tools%3Abash&filter=projects%3Aproject-alpha&filter=projects%3Aproject-beta&limit=1&offset=1&sort=asc`);

    assert.equal(telemetry.statusCode, 200);
    assert.deepEqual(telemetry.body.records.map((record: any) => record.eventId), ["evt-query-bash-b"]);
    assert.equal(telemetry.body.totals.recordCount, 2);
    assert.equal(telemetry.body.pagination.limit, 1);
    assert.equal(telemetry.body.pagination.offset, 1);
    assert.equal(telemetry.body.pagination.returnedCount, 1);
    assert.equal(telemetry.body.pagination.totalMatchedCount, 2);
    assert.equal(telemetry.body.pagination.nextOffset, undefined);
    assert.equal(telemetry.body.query.from, "2026-06-08T00:00:00.000Z");
    assert.equal(telemetry.body.query.to, "2026-06-09T00:00:00.000Z");
    assert.equal(telemetry.body.query.q, "bash");
    assert.equal(telemetry.body.analytics.facets.some((facet: any) => facet.id === "tools" && facet.counts.some((item: any) => item.name === "bash" && item.count === 2)), true);
  } finally {
    await close(app);
  }
});

test("local hub server keeps empty telemetry query compatible while adding optional metadata only for queries", async () => {
  const rootDir = tempRoot();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), `${JSON.stringify(telemetryRecord("evt-empty-query", "turn.user", "session-empty", "2026-06-08T12:00:00.000Z"))}\n`, "utf8");
  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.records.some((record: any) => record.eventId === "evt-empty-query"), true);
    assert.equal("query" in telemetry.body, false);
    assert.equal("pagination" in telemetry.body, false);
  } finally {
    await close(app);
  }
});

test("local hub server rejects malformed telemetry queries safely", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const invalid = await requestJson("GET", `${baseUrl}/api/telemetry?preset=soon&from=not-a-date&limit=1000&filter=bad-filter`);
    const tooWide = await requestJson("GET", `${baseUrl}/api/telemetry?preset=custom&from=2026-01-01T00%3A00%3A00.000Z&to=2026-03-01T00%3A00%3A00.000Z`);

    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.error, "BAD_REQUEST");
    assert.equal(invalid.body.safeMessage, "invalid telemetry query");
    assert.equal(invalid.body.validation.some((item: any) => item.path === "query.preset"), true);
    assert.equal(invalid.body.validation.some((item: any) => item.path === "query.from"), true);
    assert.equal(invalid.body.validation.some((item: any) => item.path === "query.limit"), true);
    assert.equal(invalid.body.validation.some((item: any) => item.path === "query.filter[0]"), true);
    assert.equal(tooWide.statusCode, 400);
    assert.equal(tooWide.body.validation.some((item: any) => item.path === "query.to" && String(item.message).includes("31 days")), true);
  } finally {
    await close(app);
  }
});

test("local hub server keeps newest telemetry log records when logs are over the read limit", async () => {
  const rootDir = tempRoot();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  const flowAgentsRoot = path.join(rootDir, "flow-agents", ".kontourai", "flow-agents");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  const records = Array.from({ length: 5001 }, (_, index) => {
    const id = `evt-overflow-${String(index + 1).padStart(4, "0")}`;
    return JSON.stringify(telemetryRecord(id, "tool.invoke", `session-${index + 1}`, "2026-06-08T12:00:00.000Z"));
  });
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), `${records.join("\n")}\n`, "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.records.some((record: any) => record.eventId === "evt-overflow-0001"), false);
    assert.equal(telemetry.body.records.some((record: any) => record.eventId === "evt-overflow-5001"), true);
    assert.equal(telemetry.body.warnings.some((warning: any) => String(warning.message).includes("truncated")), true);
  } finally {
    await close(app);
  }
});

test("local hub server accepts telemetry records and includes them in process lifetime summary", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const record = telemetryRecord("evt-accepted-telemetry", "session.stop", "session-post", "2026-06-08T12:03:00.000Z");
    const accepted = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const telemetry = await requestJson("GET", `${baseUrl}/api/telemetry`);
    const sinkPath = path.join(rootDir, ".kontourai", "console", "telemetry", "records.jsonl");

    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.outcome, "accepted");
    assert.equal(accepted.body.recordKind, "telemetry");
    assert.equal(accepted.body.recordId, "evt-accepted-telemetry");
    assert.equal("destination" in accepted.body, false);
    assert.equal(fs.existsSync(sinkPath), true);
    assert.equal(fs.readFileSync(sinkPath, "utf8").includes("\"event_id\":\"evt-accepted-telemetry\""), true);
    assert.equal(telemetry.body.records.some((item: any) => item.eventId === "evt-accepted-telemetry"), true);
  } finally {
    await close(app);
  }
});

test("local hub server reads accepted telemetry records back from local-jsonl storage", async () => {
  const rootDir = tempRoot();
  const firstApp = createConsoleHubServer({ rootDir, port: 0 });
  await listen(firstApp);
  try {
    const record = telemetryRecord("evt-restarted-telemetry", "session.stop", "session-restart", "2026-06-08T12:03:00.000Z");
    const accepted = await requestJson("POST", `${serverUrl(firstApp)}/api/telemetry/records`, record);
    assert.equal(accepted.statusCode, 202);
  } finally {
    await close(firstApp);
  }

  const secondApp = createConsoleHubServer({ rootDir, port: 0 });
  await listen(secondApp);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(secondApp)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.records.some((item: any) => item.eventId === "evt-restarted-telemetry"), true);
    assert.equal(telemetry.body.sources.some((source: any) => source.id === "local-accepted-jsonl" && source.recordCount === 1), true);
  } finally {
    await close(secondApp);
  }
});

test("local hub server honors explicit local-jsonl telemetry adapter", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0, telemetryStorageAdapter: "local-jsonl" });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const record = telemetryRecord("evt-explicit-local-telemetry", "session.stop", "session-local", "2026-06-08T12:03:00.000Z");
    const accepted = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const sinkPath = path.join(rootDir, ".kontourai", "console", "telemetry", "records.jsonl");

    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.outcome, "accepted");
    assert.equal(fs.existsSync(sinkPath), true);
  } finally {
    await close(app);
  }
});

test("local hub server persists telemetry through sqlite storage", async () => {
  const rootDir = tempRoot();
  const databasePath = path.join(rootDir, "telemetry.sqlite");
  const firstApp = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryStorageAdapter: "sqlite",
    telemetryDatabaseUrl: databasePath
  });
  await listen(firstApp);
  try {
    const baseUrl = serverUrl(firstApp);
    const record: any = telemetryRecord("evt-sqlite-telemetry", "tool.invoke", "session-sqlite", "2026-06-08T12:03:00.000Z");
    record.tool = { name: "Bash", normalized_name: "bash", status: "ok" };
    const accepted = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const sinkPath = path.join(rootDir, ".kontourai", "console", "telemetry", "records.jsonl");

    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.outcome, "accepted");
    assert.equal(accepted.body.sinkId, "sqlite-telemetry-api");
    assert.equal(fs.existsSync(databasePath), true);
    assert.equal(fs.existsSync(sinkPath), false);
  } finally {
    await close(firstApp);
  }

  const secondApp = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryStorageAdapter: "sqlite",
    telemetryDatabaseUrl: databasePath
  });
  await listen(secondApp);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(secondApp)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.records.some((item: any) => item.eventId === "evt-sqlite-telemetry"), true);
    assert.equal(telemetry.body.sources.some((source: any) => source.id === "sqlite-telemetry-events" && source.recordCount === 1), true);
  } finally {
    await close(secondApp);
  }
});

test("sqlite telemetry defaults its database under .kontourai/console", async () => {
  const rootDir = tempRoot();
  const databasePath = path.join(rootDir, ".kontourai", "console", "telemetry", "console.sqlite");
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryStorageAdapter: "sqlite"
  });
  await listen(app);
  try {
    const record = telemetryRecord("evt-sqlite-default-root", "session.stop", "session-sqlite-default", "2026-06-08T12:03:00.000Z");
    const accepted = await requestJson("POST", `${serverUrl(app)}/api/telemetry/records`, record);

    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.sinkId, "sqlite-telemetry-api");
    assert.equal(fs.existsSync(databasePath), true);
    assert.equal(fs.existsSync(path.join(rootDir, ".kontour", "telemetry", "console.sqlite")), false);
  } finally {
    await close(app);
  }
});

test("local hub server selects sqlite telemetry adapter from env", async () => {
  const rootDir = tempRoot();
  const databasePath = path.join(rootDir, "env-telemetry.sqlite");
  const originalStorage = process.env.CONSOLE_TELEMETRY_STORAGE;
  const originalDatabaseUrl = process.env.CONSOLE_DATABASE_URL;
  process.env.CONSOLE_TELEMETRY_STORAGE = "sqlite";
  process.env.CONSOLE_DATABASE_URL = databasePath;
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const record = telemetryRecord("evt-sqlite-env-telemetry", "session.stop", "session-sqlite-env", "2026-06-08T12:03:00.000Z");
    const accepted = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const telemetry = await requestJson("GET", `${baseUrl}/api/telemetry`);
    const sinkPath = path.join(rootDir, ".kontourai", "console", "telemetry", "records.jsonl");

    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.sinkId, "sqlite-telemetry-api");
    assert.equal(fs.existsSync(databasePath), true);
    assert.equal(fs.existsSync(sinkPath), false);
    assert.equal(telemetry.body.records.some((item: any) => item.eventId === "evt-sqlite-env-telemetry"), true);
  } finally {
    if (originalStorage === undefined) delete process.env.CONSOLE_TELEMETRY_STORAGE;
    else process.env.CONSOLE_TELEMETRY_STORAGE = originalStorage;
    if (originalDatabaseUrl === undefined) delete process.env.CONSOLE_DATABASE_URL;
    else process.env.CONSOLE_DATABASE_URL = originalDatabaseUrl;
    await close(app);
  }
});

test("local hub server fails safely for explicit postgres telemetry adapter without local side effects", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0, telemetryStorageAdapter: "postgres" });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const record = telemetryRecord("evt-postgres-telemetry", "session.stop", "session-postgres", "2026-06-08T12:03:00.000Z");
    const rejected = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const telemetry = await requestJson("GET", `${baseUrl}/api/telemetry`);
    const sinkPath = path.join(rootDir, ".kontourai", "console", "telemetry", "records.jsonl");

    assert.equal(rejected.statusCode, 500);
    assert.equal(rejected.body.error, "TELEMETRY_STORAGE_NOT_CONFIGURED");
    assert.equal(rejected.body.safeMessage, "telemetry SQL storage is selected but no database URL is configured");
    assert.equal(fs.existsSync(sinkPath), false);
    assert.equal(telemetry.body.records.some((item: any) => item.eventId === "evt-postgres-telemetry"), false);
    assert.equal(telemetry.body.sources.some((source: any) => source.id === "postgres-telemetry-storage"), true);
  } finally {
    await close(app);
  }
});

test("local hub server selects sql telemetry adapter from env without local side effects", async () => {
  const rootDir = tempRoot();
  const originalStorage = process.env.CONSOLE_TELEMETRY_STORAGE;
  const originalDatabaseUrl = process.env.CONSOLE_TELEMETRY_DATABASE_URL;
  process.env.CONSOLE_TELEMETRY_STORAGE = "sql";
  process.env.CONSOLE_TELEMETRY_DATABASE_URL = "postgres://example.invalid/console";
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const record = telemetryRecord("evt-sql-env-telemetry", "session.stop", "session-sql", "2026-06-08T12:03:00.000Z");
    const rejected = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const sinkPath = path.join(rootDir, ".kontourai", "console", "telemetry", "records.jsonl");

    assert.equal(rejected.statusCode, 500);
    assert.equal(rejected.body.error, "TELEMETRY_STORAGE_NOT_CONFIGURED");
    assert.equal(rejected.body.safeMessage, "telemetry SQL storage is selected but no SQL telemetry client is wired");
    assert.equal(fs.existsSync(sinkPath), false);
  } finally {
    if (originalStorage === undefined) delete process.env.CONSOLE_TELEMETRY_STORAGE;
    else process.env.CONSOLE_TELEMETRY_STORAGE = originalStorage;
    if (originalDatabaseUrl === undefined) delete process.env.CONSOLE_TELEMETRY_DATABASE_URL;
    else process.env.CONSOLE_TELEMETRY_DATABASE_URL = originalDatabaseUrl;
    await close(app);
  }
});

test("hosted hub server persists postgres telemetry through injected SQL client with tenant isolation", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [
      { token: "token-a", tenantId: "tenant-a" },
      { token: "token-b", tenantId: "tenant-b" }
    ],
    allowedOrigins: ["https://console.example.test"]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const unauthenticated = await requestJson("GET", `${baseUrl}/api/telemetry`);
    const acceptedA = await requestJson("POST", `${baseUrl}/api/telemetry/records`, telemetryRecord("evt-tenant-a", "tool.invoke", "session-a", "2026-06-08T12:03:00.000Z"), {
      authorization: "Bearer token-a",
      "x-console-tenant-id": "tenant-a"
    });
    const acceptedB = await requestJson("POST", `${baseUrl}/api/telemetry/records`, telemetryRecord("evt-tenant-b", "tool.invoke", "session-b", "2026-06-08T12:04:00.000Z"), {
      authorization: "Bearer token-b",
      "x-console-tenant-id": "tenant-b"
    });
    const tenantA = await requestJson("GET", `${baseUrl}/api/telemetry`, undefined, {
      authorization: "Bearer token-a"
    });
    const tenantB = await requestJson("GET", `${baseUrl}/api/telemetry`, undefined, {
      authorization: "Bearer token-b"
    });
    const tenantAQuery = await requestJson("GET", `${baseUrl}/api/telemetry?preset=custom&from=2026-06-08T12%3A02%3A00.000Z&limit=1&sort=asc`, undefined, {
      authorization: "Bearer token-a"
    });
    const wrongTenant = await requestJson("GET", `${baseUrl}/api/telemetry`, undefined, {
      authorization: "Bearer token-a",
      "x-console-tenant-id": "tenant-b"
    });
    const sinkPath = path.join(rootDir, ".kontourai", "console", "telemetry", "records.jsonl");

    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(acceptedA.statusCode, 202);
    assert.equal(acceptedB.statusCode, 202);
    assert.equal(fs.existsSync(sinkPath), false);
    assert.equal(tenantA.body.records.some((item: any) => item.eventId === "evt-tenant-a"), true);
    assert.equal(tenantA.body.records.some((item: any) => item.eventId === "evt-tenant-b"), false);
    assert.equal(tenantB.body.records.some((item: any) => item.eventId === "evt-tenant-b"), true);
    assert.equal(tenantB.body.records.some((item: any) => item.eventId === "evt-tenant-a"), false);
    assert.equal(tenantAQuery.statusCode, 200);
    assert.deepEqual(tenantAQuery.body.records.map((item: any) => item.eventId), ["evt-tenant-a"]);
    assert.equal(tenantAQuery.body.pagination.totalMatchedCount, 1);
    assert.equal(sqlClient.selects.some((select: any) => select.values.includes("tenant-a") && select.values.includes("2026-06-08T12:02:00.000Z") && select.values.includes(1)), true);
    assert.equal(wrongTenant.statusCode, 403);
  } finally {
    await close(app);
  }
});

test("hosted hub server reads a full bounded SQL window before app-side search and facet filters", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    for (let index = 0; index < 3; index += 1) {
      const record: any = telemetryRecord(`evt-sql-common-${index}`, "tool.invoke", `session-common-${index}`, `2026-06-08T12:0${index}:00.000Z`);
      record.context = { cwd: "/workspace/common-project" };
      record.tool = { normalized_name: "common" };
      await requestJson("POST", `${baseUrl}/api/telemetry/records`, record, { authorization: "Bearer token-a" });
    }
    const rare: any = telemetryRecord("evt-sql-rare", "tool.invoke", "session-rare", "2026-06-08T11:59:00.000Z");
    rare.context = { cwd: "/workspace/rare-project" };
    rare.tool = { normalized_name: "rare_tool" };
    await requestJson("POST", `${baseUrl}/api/telemetry/records`, rare, { authorization: "Bearer token-a" });

    const telemetry = await requestJson("GET", `${baseUrl}/api/telemetry?q=rare_tool&filter=tools%3Arare_tool&limit=1`, undefined, { authorization: "Bearer token-a" });

    assert.equal(telemetry.statusCode, 200);
    assert.deepEqual(telemetry.body.records.map((record: any) => record.eventId), ["evt-sql-rare"]);
    assert.equal(telemetry.body.pagination.totalMatchedCount, 1);
    assert.equal(sqlClient.selects.at(-1)?.values.at(-1), 5000);
  } finally {
    await close(app);
  }
});

test("hosted hub server fails fast when required hosted configuration is missing", () => {
  const rootDir = tempRoot();

  assert.throws(() => createConsoleHubServer({ rootDir, runtimeMode: "hosted" }), /hosted mode requires postgres telemetry storage/);
});

test("hosted hub server exposes health and readiness without secrets", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://user:pass@example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const health = await requestJson("GET", `${baseUrl}/healthz`);
    const ready = await requestJson("GET", `${baseUrl}/readyz`);

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.mode, "hosted");
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.body.ok, true);
    assert.equal(JSON.stringify(ready.body).includes("pass@example"), false);
  } finally {
    await close(app);
  }
});

test("hosted hub server uses explicit hosted CORS origins only", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }],
    allowedOrigins: ["https://console.example.test"]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const localRejected = await rawRequest("OPTIONS", `${baseUrl}/api/telemetry`, undefined, {
      origin: LOCAL_UI_ORIGIN,
      "access-control-request-method": "GET"
    });
    const hostedAllowed = await rawRequest("OPTIONS", `${baseUrl}/api/telemetry`, undefined, {
      origin: "https://console.example.test",
      "access-control-request-method": "GET"
    });

    assert.equal(localRejected.statusCode, 403);
    assert.equal(hostedAllowed.statusCode, 204);
    assert.equal(hostedAllowed.headers["access-control-allow-origin"], "https://console.example.test");
  } finally {
    await close(app);
  }
});

test("hosted hub server partitions core hub records by tenant", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [
      { token: "token-a", tenantId: "tenant/a" },
      { token: "token-b", tenantId: "tenant-a" }
    ]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const eventA = { ...surfaceFlowHandoffStream().events[0], id: "evt-tenant-a-core" };
    const eventB = { ...surfaceFlowHandoffStream().events[0], id: "evt-tenant-b-core" };
    const acceptedA = await requestJson("POST", `${baseUrl}/records`, eventA, { authorization: "Bearer token-a" });
    const acceptedB = await requestJson("POST", `${baseUrl}/records`, eventB, { authorization: "Bearer token-b" });
    const stateA = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-a" });
    const stateB = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-b" });
    const inspectA = await requestJson("GET", `${baseUrl}/inspect`, undefined, { authorization: "Bearer token-a" });

    assert.equal(acceptedA.statusCode, 202);
    assert.equal(acceptedB.statusCode, 202);
    assert.equal(stateA.body.source.acceptedEventCount, 1);
    assert.equal(stateB.body.source.acceptedEventCount, 1);
    assert.equal(stateA.body.timeline.some((item: any) => item.id === "evt-tenant-a-core"), true);
    assert.equal(stateA.body.timeline.some((item: any) => item.id === "evt-tenant-b-core"), false);
    assert.equal(stateB.body.timeline.some((item: any) => item.id === "evt-tenant-b-core"), true);
    assert.equal(inspectA.body.eventStreams.some((stream: any) => String(stream.relativePath).includes("tenant-b")), false);
  } finally {
    await close(app);
  }
});

function livenessRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema: "kontour.console.liveness",
    version: "0.1",
    type: "claim",
    subjectId: "task-alpha",
    actor: "actor-1",
    // Fresh timestamp: GET /state reads through the real Date.now() clock (no
    // injected `now` over HTTP), so a live-posted record must be within its TTL.
    at: new Date().toISOString(),
    ttlSeconds: 900,
    ...overrides
  };
}

test("local hub server accepts a liveness claim and it appears active in /state", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const accepted = await requestJson("POST", `${baseUrl}/records`, livenessRecord());
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(accepted.statusCode, 202);
    assert.equal(state.body.actors.length, 1);
    assert.equal(state.body.actors[0].actor, "actor-1");
    assert.equal(state.body.actors[0].subjectId, "task-alpha");
    assert.equal(state.body.actors[0].status, "active");
  } finally {
    await close(app);
  }
});

test("local hub server: a liveness release removes the actor from /state", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const claimAt = new Date(Date.now() - 1000).toISOString();
    const releaseAt = new Date().toISOString();
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ at: claimAt }));
    const releaseResult = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "release", at: releaseAt }));
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(releaseResult.statusCode, 202);
    assert.equal(state.body.actors.length, 0);
  } finally {
    await close(app);
  }
});

test("local hub server ignores a stale heartbeat posted after release without resurrecting the actor", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const now = Date.now();
    const claim = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ at: new Date(now - 120_000).toISOString() }));
    const release = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "release", at: new Date(now - 60_000).toISOString() }));
    const stale = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "heartbeat", at: new Date(now - 90_000).toISOString() }));
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(claim.statusCode, 202);
    assert.equal(release.statusCode, 202);
    assert.equal(stale.statusCode, 202);
    assert.equal(state.body.actors.length, 0);
  } finally {
    await close(app);
  }
});

test("local hub server rejects a liveness record missing subjectId/actor with 400 INVALID_RECORD", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const missingSubject = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ subjectId: undefined }));
    const missingActor = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ actor: "" }));
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(missingSubject.statusCode, 400);
    assert.equal(missingSubject.body.error, "INVALID_RECORD");
    assert.equal(missingActor.statusCode, 400);
    assert.equal(state.body.actors.length, 0);
  } finally {
    await close(app);
  }
});

test("hosted hub server partitions liveness actors by tenant (never leaks across tenants)", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [
      { token: "token-a", tenantId: "tenant-a" },
      { token: "token-b", tenantId: "tenant-b" }
    ]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const acceptedA = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ actor: "actor-a", subjectId: "task-a" }), { authorization: "Bearer token-a" });
    const acceptedB = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ actor: "actor-b", subjectId: "task-b" }), { authorization: "Bearer token-b" });
    const stateA = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-a" });
    const stateB = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-b" });

    assert.equal(acceptedA.statusCode, 202);
    assert.equal(acceptedB.statusCode, 202);
    assert.equal(stateA.body.actors.length, 1);
    assert.equal(stateA.body.actors[0].actor, "actor-a");
    assert.equal(stateB.body.actors.length, 1);
    assert.equal(stateB.body.actors[0].actor, "actor-b");
    // Neither tenant's /state ever shows the other tenant's actor.
    assert.equal(stateA.body.actors.some((a: any) => a.actor === "actor-b"), false);
    assert.equal(stateB.body.actors.some((a: any) => a.actor === "actor-a"), false);
  } finally {
    await close(app);
  }
});

test("hosted hub: a claim then N heartbeats for one session persist exactly ONE Postgres row (no per-heartbeat growth)", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    // Claim + 3 heartbeats for the SAME (actor, subjectId), each with a distinct
    // `at` — the collapsed id (which omits type + at) upserts them all in place.
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "claim" }), { authorization: "Bearer token-a" });
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "heartbeat" }), { authorization: "Bearer token-a" });
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "heartbeat" }), { authorization: "Bearer token-a" });
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "heartbeat" }), { authorization: "Bearer token-a" });

    const livenessRows = sqlClient.coreRows.filter((row: any) => row.tenant_id === "tenant-a" && row.schema === "kontour.console.liveness");
    assert.equal(livenessRows.length, 1, "one persisted liveness row per session, not one per heartbeat");

    const state = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-a" });
    assert.equal(state.body.actors.length, 1);
    assert.equal(state.body.actors[0].actor, "actor-1");
  } finally {
    await close(app);
  }
});

test("hosted hub ignores a stale heartbeat after release and preserves the timestamp-newest persisted row", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const now = Date.now();
    const headers = { authorization: "Bearer token-a" };
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ at: new Date(now - 120_000).toISOString() }), headers);
    const releaseAt = new Date(now - 60_000).toISOString();
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "release", at: releaseAt }), headers);
    const stale = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "heartbeat", at: new Date(now - 90_000).toISOString() }), headers);
    const equal = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "claim", at: releaseAt }), headers);
    const state = await requestJson("GET", `${baseUrl}/state`, undefined, headers);

    assert.equal(stale.statusCode, 202);
    assert.equal(stale.body.status, "stale_liveness_ignored");
    assert.equal(equal.statusCode, 202);
    assert.equal(equal.body.status, "stale_liveness_ignored");
    assert.equal(state.body.actors.length, 0);
    const rows = sqlClient.coreRows.filter((row: any) => row.tenant_id === "tenant-a" && row.schema === "kontour.console.liveness");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.type, "release");
    assert.equal(rows[0].payload.at, releaseAt);
  } finally {
    await close(app);
  }
});

test("hosted equal-time release precedence is identical in both arrival orders and after cold rebuild", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const serverOptions = {
    rootDir, port: 0, runtimeMode: "hosted" as const,
    telemetryStorageAdapter: "postgres" as const,
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  };
  const app = createConsoleHubServer(serverOptions);
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const headers = { authorization: "Bearer token-a" };
    const at = new Date(Date.now() - 60_000).toISOString();
    const activeA = livenessRecord({ actor: "actor-a", subjectId: "task-a", type: "heartbeat", at });
    const releaseA = livenessRecord({ actor: "actor-a", subjectId: "task-a", type: "release", at });
    const activeB = livenessRecord({ actor: "actor-b", subjectId: "task-b", type: "heartbeat", at });
    const releaseB = livenessRecord({ actor: "actor-b", subjectId: "task-b", type: "release", at });
    await requestJson("POST", `${baseUrl}/records`, activeA, headers);
    await requestJson("POST", `${baseUrl}/records`, releaseA, headers);
    await requestJson("POST", `${baseUrl}/records`, releaseB, headers);
    const ignoredActive = await requestJson("POST", `${baseUrl}/records`, activeB, headers);
    const live = await requestJson("GET", `${baseUrl}/state`, undefined, headers);

    assert.equal(ignoredActive.body.status, "stale_liveness_ignored");
    assert.equal(live.body.actors.length, 0);
    const rows = sqlClient.coreRows.filter((row: any) => row.schema === "kontour.console.liveness");
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row: any) => row.payload.type === "release"), true);
  } finally {
    await close(app);
  }
  const restarted = createConsoleHubServer(serverOptions);
  await listen(restarted);
  try {
    const cold = await requestJson("GET", `${serverUrl(restarted)}/state`, undefined, { authorization: "Bearer token-a" });
    assert.equal(cold.body.actors.length, 0);
  } finally {
    await close(restarted);
  }
});

test("hosted atomic liveness upsert keeps a newer release when a concurrent stale heartbeat completes last", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const serverOptions = {
    rootDir, port: 0, runtimeMode: "hosted" as const,
    telemetryStorageAdapter: "postgres" as const,
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  };
  const app = createConsoleHubServer(serverOptions);
  await listen(app);
  let unblockStale!: () => void;
  let staleStarted!: () => void;
  const staleGate = new Promise<void>((resolve) => { unblockStale = resolve; });
  const staleEntered = new Promise<void>((resolve) => { staleStarted = resolve; });
  try {
    const baseUrl = serverUrl(app);
    const headers = { authorization: "Bearer token-a" };
    const now = Date.now();
    await requestJson("POST", `${baseUrl}/records`, livenessRecord({ at: new Date(now - 120_000).toISOString() }), headers);
    sqlClient.beforeCoreInsert = async (payload: any) => {
      if (payload.type === "heartbeat") { staleStarted(); await staleGate; }
    };
    const stalePromise = requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "heartbeat", at: new Date(now - 90_000).toISOString() }), headers);
    await staleEntered;
    const release = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "release", at: new Date(now - 60_000).toISOString() }), headers);
    unblockStale();
    const stale = await stalePromise;
    sqlClient.beforeCoreInsert = undefined;
    const live = await requestJson("GET", `${baseUrl}/state`, undefined, headers);
    assert.equal(release.statusCode, 202);
    assert.equal(stale.body.status, "stale_liveness_ignored");
    assert.equal(live.body.actors.length, 0);
    assert.equal(sqlClient.coreRows.find((row: any) => row.schema === "kontour.console.liveness").payload.type, "release");
  } finally {
    unblockStale();
    await close(app);
  }
  const restarted = createConsoleHubServer(serverOptions);
  await listen(restarted);
  try {
    const cold = await requestJson("GET", `${serverUrl(restarted)}/state`, undefined, { authorization: "Bearer token-a" });
    assert.equal(cold.body.actors.length, 0);
  } finally {
    await close(restarted);
  }
});

test("hosted liveness persistence fails closed after initial core-record load failure", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const now = Date.now();
  const release = { ...livenessRecord({ type: "release", at: new Date(now - 60_000).toISOString() }), id: "liveness:actor-1:task-alpha" };
  sqlClient.coreRows.push({ tenant_id: "tenant-a", record_id: release.id, schema: release.schema, type: release.type, observed_at: release.at, sequence: 1, payload: release, liveness_order_ms: Date.parse(release.at) });
  sqlClient.failNextCoreLoad = true;
  const app = createConsoleHubServer({ rootDir, port: 0, runtimeMode: "hosted", telemetryStorageAdapter: "postgres", telemetryDatabaseUrl: "postgres://example.invalid/console", telemetrySqlClient: sqlClient, hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }] });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const stale = await requestJson("POST", `${baseUrl}/records`, livenessRecord({ type: "heartbeat", at: new Date(now - 90_000).toISOString() }), { authorization: "Bearer token-a" });
    const state = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-a" });
    assert.equal(stale.statusCode, 202);
    assert.equal(stale.body.status, "stale_liveness_ignored");
    assert.equal(sqlClient.coreRows[0].payload.type, "release");
    assert.equal(state.body.actors.length, 0);
  } finally {
    await close(app);
  }
});

test("hosted hub: cold-start replay of a lone heartbeat row reconstructs an ACTIVE actor", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  // Simulate a hub that has been up a while: the heartbeat row has already
  // overwritten the original claim row (collapsed id), so the ONLY row Postgres
  // holds for this session is a `heartbeat`. A fresh process cold-loads it.
  const heartbeat = {
    schema: "kontour.console.liveness",
    version: "0.1",
    id: "liveness:actor-cold:task-cold",
    type: "heartbeat",
    subjectId: "task-cold",
    actor: "actor-cold",
    at: new Date().toISOString(),
    ttlSeconds: 900,
    tenant_id: "tenant-a"
  };
  sqlClient.coreRows.push({
    tenant_id: "tenant-a",
    record_id: heartbeat.id,
    schema: heartbeat.schema,
    type: heartbeat.type,
    occurred_at: null,
    observed_at: heartbeat.at,
    sequence: 1,
    payload: heartbeat
  });

  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const state = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-a" });
    assert.equal(state.body.actors.length, 1, "a lone heartbeat row must reconstruct an active actor on cold replay");
    assert.equal(state.body.actors[0].actor, "actor-cold");
    assert.equal(state.body.actors[0].status, "active");
  } finally {
    await close(app);
  }
});

test("hosted ingest stamps tenant from the principal when the body omits tenant_id", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const event = { ...surfaceFlowHandoffStream().events[0], id: "evt-stamp-none" };
    assert.equal("tenant_id" in event, false);

    const accepted = await requestJson("POST", `${baseUrl}/records`, event, { authorization: "Bearer token-a" });
    const inspection = await requestJson("GET", `${baseUrl}/inspect`, undefined, { authorization: "Bearer token-a" });

    assert.equal(accepted.statusCode, 202);
    const stored = storedRecordById(inspection.body, "evt-stamp-none");
    assert.ok(stored, "record should be persisted");
    assert.equal(stored.tenant_id, "tenant-a");
  } finally {
    await close(app);
  }
});

test("hosted ingest accepts a record whose body tenant_id agrees with the principal", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "token-a", tenantId: "tenant-a" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const event = { ...surfaceFlowHandoffStream().events[0], id: "evt-stamp-agree", tenant_id: "tenant-a" };

    const accepted = await requestJson("POST", `${baseUrl}/records`, event, { authorization: "Bearer token-a" });
    const inspection = await requestJson("GET", `${baseUrl}/inspect`, undefined, { authorization: "Bearer token-a" });

    assert.equal(accepted.statusCode, 202);
    const stored = storedRecordById(inspection.body, "evt-stamp-agree");
    assert.ok(stored, "record should be persisted");
    assert.equal(stored.tenant_id, "tenant-a");
  } finally {
    await close(app);
  }
});

test("hosted ingest rejects a record whose body tenant_id disagrees with the principal (403 TENANT_MISMATCH) and does not append it", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [
      { token: "token-a", tenantId: "tenant-a" },
      { token: "token-b", tenantId: "tenant-b" }
    ]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    // Principal is tenant-a, but the body claims tenant-b — a cross-tenant write attempt.
    const spoof = { ...surfaceFlowHandoffStream().events[0], id: "evt-stamp-mismatch", tenant_id: "tenant-b" };

    const rejected = await requestJson("POST", `${baseUrl}/records`, spoof, { authorization: "Bearer token-a" });
    const inspectA = await requestJson("GET", `${baseUrl}/inspect`, undefined, { authorization: "Bearer token-a" });
    const inspectB = await requestJson("GET", `${baseUrl}/inspect`, undefined, { authorization: "Bearer token-b" });

    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.body.error, "TENANT_MISMATCH");
    assert.equal(rejected.body.safeMessage, "record tenant does not match the authenticated principal");
    // Not appended for either tenant — no cross-tenant write, no self write.
    assert.equal(storedRecordById(inspectA.body, "evt-stamp-mismatch"), undefined);
    assert.equal(storedRecordById(inspectB.body, "evt-stamp-mismatch"), undefined);
  } finally {
    await close(app);
  }
});

test("hosted ingest keeps two principals isolated even when each stamps their own tenant", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [
      { token: "token-a", tenantId: "tenant-a" },
      { token: "token-b", tenantId: "tenant-b" }
    ]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const eventA = { ...surfaceFlowHandoffStream().events[0], id: "evt-iso-a", tenant_id: "tenant-a" };
    const eventB = { ...surfaceFlowHandoffStream().events[0], id: "evt-iso-b", tenant_id: "tenant-b" };

    const [acceptedA, acceptedB] = await Promise.all([
      requestJson("POST", `${baseUrl}/records`, eventA, { authorization: "Bearer token-a" }),
      requestJson("POST", `${baseUrl}/records`, eventB, { authorization: "Bearer token-b" })
    ]);
    const inspectA = await requestJson("GET", `${baseUrl}/inspect`, undefined, { authorization: "Bearer token-a" });
    const inspectB = await requestJson("GET", `${baseUrl}/inspect`, undefined, { authorization: "Bearer token-b" });
    const stateB = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-b" });

    assert.equal(acceptedA.statusCode, 202);
    assert.equal(acceptedB.statusCode, 202);
    // Each tenant sees only its own record, stamped with its own tenant.
    assert.equal(storedRecordById(inspectA.body, "evt-iso-a").tenant_id, "tenant-a");
    assert.equal(storedRecordById(inspectA.body, "evt-iso-b"), undefined);
    assert.equal(storedRecordById(inspectB.body, "evt-iso-b").tenant_id, "tenant-b");
    assert.equal(storedRecordById(inspectB.body, "evt-iso-a"), undefined);
    // A's record never leaks into B's operating-state timeline.
    assert.equal(stateB.body.timeline.some((item: any) => item.id === "evt-iso-a"), false);
  } finally {
    await close(app);
  }
});

test("local (non-hosted) ingest stamps the default tenant and is not regressed", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const event = { ...surfaceFlowHandoffStream().events[0], id: "evt-local-stamp" };

    const accepted = await requestJson("POST", `${baseUrl}/records`, event);
    const inspection = await requestJson("GET", `${baseUrl}/inspect`);

    assert.equal(accepted.statusCode, 202);
    const stored = storedRecordById(inspection.body, "evt-local-stamp");
    assert.ok(stored, "record should be persisted");
    // Local mode has a single default tenant; the record is stamped with it.
    assert.equal(typeof stored.tenant_id, "string");
    assert.ok(stored.tenant_id.length > 0);
  } finally {
    await close(app);
  }
});

test("hosted hub server rejects auth tokens outside tenant allowlist", () => {
  const rootDir = tempRoot();

  assert.throws(() => createConsoleHubServer({
    rootDir,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedTenantIds: ["tenant-a"],
    hostedAuthTokens: [{ token: "token-b", tenantId: "tenant-b" }]
  }), /tenant outside the allowlist/);
});

test("console migrations are versioned and idempotent through SQL client", async () => {
  const sqlClient = new FakeTelemetrySqlClient();
  const migrations = loadConsoleMigrations();

  const first = await applyConsoleMigrations(sqlClient, migrations);
  const second = await applyConsoleMigrations(sqlClient, migrations);

  assert.equal(migrations.some((migration: any) => migration.name === "0001_telemetry_events.sql"), true);
  assert.equal(first.some((result: any) => result.name === "0001_telemetry_events.sql" && result.applied), true);
  assert.equal(second.every((result: any) => result.applied === false), true);
});

test("local hub server streams telemetry updates over SSE", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  const streamClient: SseHolder = {};
  try {
    const baseUrl = serverUrl(app);
    const eventStream = connectSse(`${baseUrl}/stream`, streamClient);
    await eventStream.nextEvent();
    await eventStream.nextEvent();

    const record = telemetryRecord("evt-live-telemetry", "tool.invoke", "session-live", "2026-06-08T12:03:00.000Z");
    const accepted = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const update = await eventStream.nextEvent();

    assert.equal(accepted.statusCode, 202);
    assert.equal(update.event, "telemetry.updated");
    assert.equal("delivery" in update.data, false);
    assert.equal(update.data.telemetry.recordCount, 1);
    assert.equal("records" in update.data.telemetry, false);
  } finally {
    if (streamClient.request) streamClient.request.destroy();
    await close(app);
  }
});

test("local hub server applies product-owned telemetry descriptors", async () => {
  const rootDir = tempRoot();
  const flowAgentsRepo = path.join(rootDir, "flow-agents");
  const flowAgentsRoot = path.join(flowAgentsRepo, ".kontourai", "flow-agents");
  const widgetRepo = path.join(rootDir, "widget-product");
  const widgetRoot = path.join(widgetRepo, ".workflows");
  const telemetryRoot = path.join(rootDir, ".telemetry");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  fs.mkdirSync(path.join(flowAgentsRoot, "shape-provider-settings"), { recursive: true });
  fs.mkdirSync(path.join(flowAgentsRoot, "deliver-console-telemetry"), { recursive: true });
  fs.mkdirSync(path.join(widgetRoot, "release-forecast"), { recursive: true });
  fs.writeFileSync(path.join(flowAgentsRepo, "console.telemetry.json"), JSON.stringify({
    recordSources: [{
      id: "flow-agents-workflows",
      root: "product:flow-agents:.kontourai/flow-agents",
      files: ["state.json", "acceptance.json"],
      attributes: {
        taskSlug: "task_slug",
        status: "status",
        title: "summary",
        skill: "skill_id",
        tool: "tool_id",
        flow: "flow_id",
        project: "project",
        runtime: "runtime",
        cwd: "cwd",
        secretToken: "secret_token",
        leakyTitle: "secret_token",
        observedAt: "updated_at"
      }
    }],
    facets: [
      { id: "skills", label: "Skills", attribute: "skill" },
      { id: "tools", label: "Tools", attribute: "tool" },
      { id: "flows", label: "Flows", attribute: "flow" },
      { id: "projects", label: "Projects", attribute: "project" },
      { id: "runtimes", label: "Runtimes", attribute: "runtime" },
      { id: "cwd", label: "Working directories", attribute: "cwd" },
      { id: "workflow-status", label: "Workflow status", attribute: "status" }
    ],
    flows: [{
      id: "builder.shape",
      label: "Builder shape",
      match: { attribute: "taskSlug", includes: "shape" },
      titleAttribute: "title",
      detailAttributes: {
        Project: "project",
        Skill: "skill",
        Status: "status"
      }
    }, {
      id: "malformed.detail",
      label: "Malformed detail",
      match: { attribute: "taskSlug", includes: "shape" },
      detailAttributes: {
        Project: ["project"]
      }
    }]
  }), "utf8");
  fs.writeFileSync(path.join(widgetRepo, "console.telemetry.json"), JSON.stringify({
    recordSources: [{
      id: "widget-workflows",
      root: "product:widget:.workflows",
      files: ["state.json"],
      attributes: {
        taskSlug: "slug",
        status: "state",
        title: "title",
        project: "project",
        observedAt: "updated"
      }
    }],
    facets: [{ id: "widget-projects", label: "Widget projects", attribute: "project" }],
    flows: [{
      id: "widget.release",
      label: "Widget release",
      match: { attribute: "project", equals: "widget-console" },
      titleAttribute: "title",
      detailAttributes: {
        Project: "project",
        State: "status"
      }
    }]
  }), "utf8");
  fs.writeFileSync(path.join(flowAgentsRoot, "shape-provider-settings", "state.json"), JSON.stringify({
    schema_version: "1.0",
    task_slug: "shape-provider-settings",
    status: "done",
    summary: "Shape provider settings",
    skill_id: "builder-shape",
    tool_id: "tool-planner",
    flow_id: "deliver",
    project: "kontour-console",
    runtime: "codex",
    cwd: "/workspace/kontour-console",
    secret_token: "super-secret-workflow-token",
    updated_at: "2026-06-08T12:02:00.000Z"
  }), "utf8");
  fs.writeFileSync(path.join(flowAgentsRoot, "deliver-console-telemetry", "acceptance.json"), JSON.stringify({
    schema_version: "1.0",
    task_slug: "deliver-console-telemetry",
    status: "verified",
    summary: "Deliver Console telemetry",
    skill_id: "deliver",
    tool_id: "tool-worker",
    flow_id: "deliver",
    project: "kontour-console",
    runtime: "codex",
    cwd: "/workspace/kontour-console",
    updated_at: "2026-06-08T12:04:00.000Z"
  }), "utf8");
  fs.writeFileSync(path.join(widgetRoot, "release-forecast", "state.json"), JSON.stringify({
    slug: "release-forecast",
    state: "ready",
    title: "Release forecast",
    project: "widget-console",
    updated: "2026-06-08T12:01:00.000Z"
  }), "utf8");
  const runtimeRecord: any = telemetryRecord("evt-descriptor-tool", "tool.invoke", "session-tool", "2026-06-08T12:03:00.000Z");
  runtimeRecord.context = { cwd: "/workspace/descriptor-project" };
  runtimeRecord.tool = { normalized_name: "bash" };
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), `${JSON.stringify(runtimeRecord)}\n`, "utf8");

  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryRoot,
    telemetryDescriptorPaths: ["product:flow-agents:console.telemetry.json"],
    telemetryProductRoots: {
      "flow-agents": flowAgentsRepo,
      widget: widgetRepo
    }
  });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);
    const genericFilter = await requestJson("GET", `${serverUrl(app)}/api/telemetry?filter=tools%3Atool-worker`);
    const workflowRecord = telemetry.body.records.find((record: any) => record.eventId === "shape-provider-settings:state.json");
    const facetCount = (facetId: string, name: string) => telemetry.body.analytics.facets
      .find((facet: any) => facet.id === facetId)?.counts
      .find((item: any) => item.name === name)?.count;

    assert.equal(telemetry.statusCode, 200);
    assert.equal(facetCount("skills", "builder-shape"), 1);
    assert.equal(facetCount("tools", "tool-worker"), 1);
    assert.equal(facetCount("flows", "deliver"), 2);
    assert.equal(facetCount("projects", "kontour-console"), 2);
    assert.equal(facetCount("runtimes", "codex"), 3);
    assert.equal(facetCount("cwd", "/workspace/kontour-console"), 2);
    assert.equal(facetCount("widget-projects", "widget-console"), 1);
    assert.equal(telemetry.body.analytics.flows[0].id, "builder.shape");
    assert.equal(telemetry.body.analytics.flows[0].total, 1);
    assert.equal(telemetry.body.analytics.flows[0].items[0].title, "Shape provider settings");
    assert.equal(telemetry.body.analytics.flows.filter((flow: any) => flow.id === "builder.shape").length, 1);
    assert.deepEqual(telemetry.body.analytics.flows[0].items[0].details, [
      { label: "Project", value: "kontour-console" },
      { label: "Skill", value: "builder-shape" },
      { label: "Status", value: "done" }
    ]);
    const widgetFlow = telemetry.body.analytics.flows.find((flow: any) => flow.id === "widget.release");
    assert.deepEqual(widgetFlow.items[0].details, [
      { label: "Project", value: "widget-console" },
      { label: "State", value: "ready" }
    ]);
    assert.equal(telemetry.body.analytics.flows.some((flow: any) => flow.id === "malformed.detail"), false);
    assert.equal(workflowRecord.attributes.secretToken, "[redacted]");
    assert.equal(workflowRecord.attributes.leakyTitle, "[redacted]");
    assert.equal(JSON.stringify(telemetry.body).includes("super-secret-workflow-token"), false);
    assert.equal(genericFilter.statusCode, 200);
    assert.deepEqual(genericFilter.body.records.map((record: any) => record.eventId), ["deliver-console-telemetry:acceptance.json"]);
  } finally {
    await close(app);
  }
});

test("local hub server ignores legacy descriptors hidden under .kontour", async () => {
  const rootDir = tempRoot();
  const productRoot = path.join(rootDir, "legacy-product");
  const workRoot = path.join(productRoot, "work");
  fs.mkdirSync(path.join(productRoot, ".kontour"), { recursive: true });
  fs.mkdirSync(workRoot, { recursive: true });
  fs.writeFileSync(path.join(workRoot, "state.json"), JSON.stringify({
    task_slug: "legacy-hidden-descriptor",
    status: "complete"
  }), "utf8");
  fs.writeFileSync(path.join(productRoot, ".kontour", "console.telemetry.json"), JSON.stringify({
    recordSources: [{
      id: "legacy-hidden-source",
      root: "product:legacy:work",
      files: ["state.json"],
      attributes: { taskSlug: "task_slug", status: "status" }
    }]
  }), "utf8");
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryProductRoots: { legacy: productRoot }
  });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.records.some((record: any) => record.taskSlug === "legacy-hidden-descriptor"), false);
  } finally {
    await close(app);
  }
});

test("local hub server rejects descriptor record source symlink escapes", async () => {
  const rootDir = tempRoot();
  const flowAgentsRepo = path.join(rootDir, "flow-agents");
  const flowAgentsRoot = path.join(flowAgentsRepo, ".kontourai", "flow-agents");
  const outsideRoot = path.join(rootDir, "outside");
  fs.mkdirSync(flowAgentsRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.mkdirSync(path.join(flowAgentsRoot, "escape"), { recursive: true });
  fs.writeFileSync(path.join(outsideRoot, "state.json"), JSON.stringify({
    task_slug: "escaped-task",
    status: "leaked"
  }), "utf8");
  fs.symlinkSync(path.join(outsideRoot, "state.json"), path.join(flowAgentsRoot, "escape", "state.json"));
  fs.writeFileSync(path.join(flowAgentsRepo, "console.telemetry.json"), JSON.stringify({
    recordSources: [{
      id: "flow-agents-workflows",
      root: "product:.kontourai/flow-agents",
      files: ["state.json"],
      attributes: {
        taskSlug: "task_slug",
        status: "status"
      }
    }]
  }), "utf8");

  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryRoot: path.join(rootDir, ".telemetry"),
    telemetryProductRoots: { "flow-agents": flowAgentsRepo }
  });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.records.some((record: any) => record.taskSlug === "escaped-task"), false);
    assert.equal(telemetry.body.warnings.some((warning: any) => warning.message === "descriptor record escaped source root"), true);
  } finally {
    await close(app);
  }
});

test("local hub server ignores auto-discovered descriptor symlink escapes", async () => {
  const rootDir = tempRoot();
  const productRoot = path.join(rootDir, "product");
  const outsideRoot = path.join(rootDir, "outside");
  fs.mkdirSync(productRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(outsideRoot, "console.telemetry.json"), JSON.stringify({
    facets: [{ id: "escaped", label: "Escaped descriptor", attribute: "status" }]
  }), "utf8");
  fs.symlinkSync(path.join(outsideRoot, "console.telemetry.json"), path.join(productRoot, "console.telemetry.json"));

  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryRoot: path.join(rootDir, ".telemetry"),
    telemetryProductRoots: {
      product: productRoot
    }
  });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.analytics.facets.some((facet: any) => facet.id === "escaped"), false);
  } finally {
    await close(app);
  }
});

test("local hub server reports missing descriptor record sources without failing telemetry summary", async () => {
  const rootDir = tempRoot();
  fs.writeFileSync(path.join(rootDir, "console.telemetry.json"), JSON.stringify({
    recordSources: [{
      id: "missing-product-records",
      root: "product:missing-dir",
      files: ["state.json"]
    }]
  }), "utf8");
  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot: path.join(rootDir, ".telemetry") });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.sources.some((source: any) => source.id === "missing-product-records"), true);
    assert.equal(telemetry.body.warnings.some((warning: any) => warning.message === "descriptor record source not found"), true);
  } finally {
    await close(app);
  }
});

test("local hub server reports telemetry persistence failures", async () => {
  const rootDir = tempRoot();
  const badSinkRoot = path.join(rootDir, "not-a-directory");
  fs.writeFileSync(badSinkRoot, "file blocks directory creation", "utf8");
  const app = createConsoleHubServer({ rootDir, port: 0, telemetrySinkRoot: badSinkRoot });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const record = telemetryRecord("evt-rejected-telemetry", "session.stop", "session-post", "2026-06-08T12:03:00.000Z");
    const rejected = await requestJson("POST", `${baseUrl}/api/telemetry/records`, record);
    const telemetry = await requestJson("GET", `${baseUrl}/api/telemetry`);

    assert.equal(rejected.statusCode, 500);
    assert.equal(rejected.body.error, "TELEMETRY_PERSISTENCE_FAILED");
    assert.equal(rejected.body.safeMessage, "telemetry record could not be persisted");
    assert.equal(String(rejected.body.safeMessage).includes(rootDir), false);
    assert.equal(telemetry.body.records.some((item: any) => item.eventId === "evt-rejected-telemetry"), false);
  } finally {
    await close(app);
  }
});

test("local hub server rejects malformed telemetry records safely", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const nonObjectBody = await rawRequest("POST", `${baseUrl}/api/telemetry/records`, "\"not-object\"");
    const invalidRecord = await requestJson("POST", `${baseUrl}/api/telemetry/records`, {
      schema_version: "0.3.0",
      event_type: "turn.user",
      session_id: "session-missing-event-id"
    });
    const wrongMethod = await requestJson("POST", `${baseUrl}/api/telemetry`, {});

    assert.equal(nonObjectBody.statusCode, 400);
    assert.equal(JSON.parse(nonObjectBody.body).error, "INVALID_BODY");
    assert.equal(invalidRecord.statusCode, 400);
    assert.equal(invalidRecord.body.error, "INVALID_TELEMETRY_RECORD");
    assert.equal(invalidRecord.body.validation[0].path, "record.event_id");
    assert.equal(wrongMethod.statusCode, 405);
  } finally {
    await close(app);
  }
});

test("local hub server rejects malformed requests safely", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const invalidJson = await rawRequest("POST", `${baseUrl}/records`, "{");
    const nonObjectBody = await rawRequest("POST", `${baseUrl}/records`, "\"not-object\"");
    const invalidSchema = await requestJson("POST", `${baseUrl}/records`, {
      schema: "kontour.console.unknown",
      version: "0.1",
      id: "bad-schema"
    });
    const invalidRecord = await requestJson("POST", `${baseUrl}/records`, {
      schema: "kontour.console.event",
      version: "0.1",
      id: "bad-event"
    });
    const oversized = await rawRequest("POST", `${baseUrl}/records`, JSON.stringify({ payload: "x".repeat(1024 * 1024) }));
    const missing = await requestJson("GET", `${baseUrl}/missing`);
    const wrongMethod = await requestJson("POST", `${baseUrl}/state`, {});
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(invalidJson.statusCode, 400);
    assert.equal(JSON.parse(invalidJson.body).error, "INVALID_JSON");
    assert.equal(nonObjectBody.statusCode, 400);
    assert.equal(JSON.parse(nonObjectBody.body).error, "INVALID_BODY");
    assert.equal(invalidSchema.statusCode, 400);
    assert.equal(invalidSchema.body.error, "INVALID_RECORD");
    assert.equal(invalidRecord.statusCode, 400);
    assert.equal(invalidRecord.body.error, "INVALID_RECORD");
    assert.equal(invalidRecord.body.safeMessage, "record validation failed");
    assert.equal(invalidRecord.body.validation.some((item: any) => item.path === "record.type"), true);
    assert.equal(oversized.statusCode, 413);
    assert.equal(JSON.parse(oversized.body).error, "BODY_TOO_LARGE");
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error, "NOT_FOUND");
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.body.error, "METHOD_NOT_ALLOWED");
    assert.equal(state.body.source.acceptedEventCount, 0);
  } finally {
    await close(app);
  }
});

test("hub server serves index.html at / when ui dist directory is present", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist");
  fs.mkdirSync(path.join(uiDist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>Console UI</body></html>", "utf8");
  fs.writeFileSync(path.join(uiDist, "assets", "main.abc123.js"), "// bundle", "utf8");
  fs.writeFileSync(path.join(uiDist, "assets", "main.abc123.css"), "body{}", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const index = await rawRequest("GET", `${baseUrl}/`);
    const telemetryPage = await rawRequest("GET", `${baseUrl}/telemetry`);
    const environmentPage = await rawRequest("GET", `${baseUrl}/environment`);
    const jsAsset = await rawRequest("GET", `${baseUrl}/assets/main.abc123.js`);
    const cssAsset = await rawRequest("GET", `${baseUrl}/assets/main.abc123.css`);

    assert.equal(index.statusCode, 200);
    assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(index.headers["cache-control"], "no-store");
    assert.equal(index.body.includes("Console UI"), true);
    assert.equal(telemetryPage.statusCode, 200);
    assert.equal(telemetryPage.body.includes("Console UI"), true);
    assert.equal(environmentPage.statusCode, 200);
    assert.equal(environmentPage.body.includes("Console UI"), true);
    assert.equal(jsAsset.statusCode, 200);
    assert.equal(jsAsset.headers["content-type"], "application/javascript; charset=utf-8");
    assert.equal(String(jsAsset.headers["cache-control"]).includes("max-age=31536000"), true);
    assert.equal(cssAsset.statusCode, 200);
    assert.equal(cssAsset.headers["content-type"], "text/css; charset=utf-8");
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("hub server keeps api error behavior for unknown routes when ui dist is absent", async () => {
  const rootDir = tempRoot();
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = path.join(rootDir, "nonexistent-ui-dist");
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const missing = await requestJson("GET", `${baseUrl}/missing`);
    const health = await requestJson("GET", `${baseUrl}/healthz`);
    const ready = await requestJson("GET", `${baseUrl}/readyz`);

    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error, "NOT_FOUND");
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.ok, true);
    assert.equal(ready.statusCode, 200);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("hub server keeps healthz and readyz working when ui dist is present", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-health");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>UI</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const health = await requestJson("GET", `${baseUrl}/healthz`);
    const ready = await requestJson("GET", `${baseUrl}/readyz`);

    assert.equal(health.statusCode, 200);
    assert.equal(health.body.ok, true);
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.body.ok, true);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("hub server resolveUiDistDir uses CONSOLE_UI_DIST env override", () => {
  const { resolveUiDistDir } = require("../src/console-foundation/console-hub-server");
  const customPath = "/custom/ui/dist";
  const resolved = resolveUiDistDir({ CONSOLE_UI_DIST: customPath });
  assert.equal(resolved, customPath);
});

test("hub server resolveUiDistDir defaults to console-ui/dist relative to __dirname", () => {
  const { resolveUiDistDir } = require("../src/console-foundation/console-hub-server");
  const resolved = resolveUiDistDir({});
  assert.equal(resolved.endsWith(path.join("console-ui", "dist")), true);
  assert.equal(!resolved.includes(".."), true);
});

test("hub server rejects path traversal in static asset requests", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-traversal");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>UI</body></html>", "utf8");
  const sensitiveDir = path.join(rootDir, "sensitive");
  fs.mkdirSync(sensitiveDir, { recursive: true });
  fs.writeFileSync(path.join(sensitiveDir, "secret.txt"), "secret-content", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    // Traversal attempt should fall back to index.html, not expose files outside dist
    const traversal = await rawRequest("GET", `${baseUrl}/../sensitive/secret.txt`);
    assert.equal(traversal.body.includes("secret-content"), false);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("hub server keeps /state as an API route even when ui dist is present", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-api");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>UI</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const state = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(state.statusCode, 200);
    assert.ok("source" in state.body, "/state should return JSON API response");
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("hub server CONSOLE_SERVE_UI=0 disables static file serving", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-noui");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>UI</body></html>", "utf8");
  const originalDist = process.env.CONSOLE_UI_DIST;
  const originalServeUi = process.env.CONSOLE_SERVE_UI;
  process.env.CONSOLE_UI_DIST = uiDist;
  process.env.CONSOLE_SERVE_UI = "0";
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const index = await requestJson("GET", `${baseUrl}/`);

    // Without UI serving the root path should 404 (not found, no index.html fallback).
    assert.equal(index.statusCode, 404);
    assert.equal(index.body.error, "NOT_FOUND");
  } finally {
    if (originalDist === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalDist;
    if (originalServeUi === undefined) delete process.env.CONSOLE_SERVE_UI;
    else process.env.CONSOLE_SERVE_UI = originalServeUi;
    await close(app);
  }
});

test("hub server serveUi: false option disables static file serving", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-noui-opt");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>UI</body></html>", "utf8");
  const originalDist = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({ rootDir, port: 0, serveUi: false });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const index = await requestJson("GET", `${baseUrl}/`);

    assert.equal(index.statusCode, 404);
    assert.equal(index.body.error, "NOT_FOUND");
  } finally {
    if (originalDist === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalDist;
    await close(app);
  }
});


test("local hub mode serves index.html at / without any session gate", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-local");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>Console UI</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const index = await rawRequest("GET", `${baseUrl}/`);
    const telemetryPage = await rawRequest("GET", `${baseUrl}/telemetry`);

    // Local mode: no gate, index.html served directly.
    assert.equal(index.statusCode, 200);
    assert.equal(index.body.includes("Console UI"), true);
    assert.equal(telemetryPage.statusCode, 200);
    assert.equal(telemetryPage.body.includes("Console UI"), true);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("hosted hub mode returns session gate page for unauthenticated / when dist present", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-gate");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<!DOCTYPE html><html><body>Console UI</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "tok-hosted", tenantId: "tenant-hosted" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const index = await rawRequest("GET", `${baseUrl}/`);
    const telemetryPage = await rawRequest("GET", `${baseUrl}/telemetry`);
    const envPage = await rawRequest("GET", `${baseUrl}/environment`);

    // Gate page returned, NOT the app, with no product info.
    assert.equal(index.statusCode, 200);
    assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(String(index.headers["x-frame-options"]), "DENY");
    assert.match(String(index.headers["content-security-policy"]), /frame-ancestors 'none'/);
    assert.equal(index.body.includes("Console UI"), false);
    assert.equal(index.body.includes("<form"), true);
    assert.equal(index.body.includes("Token"), true);
    assert.equal(telemetryPage.statusCode, 200);
    assert.equal(telemetryPage.body.includes("Console UI"), false);
    assert.equal(envPage.statusCode, 200);
    assert.equal(envPage.body.includes("Console UI"), false);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("hosted hub mode serves JS and CSS assets without a session cookie", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-assets");
  fs.mkdirSync(path.join(uiDist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<html><body>App</body></html>", "utf8");
  fs.writeFileSync(path.join(uiDist, "assets", "main.abc.js"), "// bundle", "utf8");
  fs.writeFileSync(path.join(uiDist, "assets", "main.abc.css"), "body{}", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "tok-asset", tenantId: "tenant-asset" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const jsAsset = await rawRequest("GET", `${baseUrl}/assets/main.abc.js`);
    const cssAsset = await rawRequest("GET", `${baseUrl}/assets/main.abc.css`);

    // Static hashed assets served without auth (no product info in bundles).
    assert.equal(jsAsset.statusCode, 200);
    assert.equal(jsAsset.headers["content-type"], "application/javascript; charset=utf-8");
    assert.equal(String(jsAsset.headers["cache-control"]).includes("max-age=31536000"), true);
    assert.equal(cssAsset.statusCode, 200);
    assert.equal(cssAsset.headers["content-type"], "text/css; charset=utf-8");
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("POST /session rejects bad credentials with 401 without revealing which field failed", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-session-bad");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<html><body>App</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "tok-session", tenantId: "tenant-session" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const wrongToken = await requestJson("POST", `${baseUrl}/session`, { token: "wrong-token", tenant: "tenant-session" });
    const wrongTenant = await requestJson("POST", `${baseUrl}/session`, { token: "tok-session", tenant: "wrong-tenant" });
    const noToken = await requestJson("POST", `${baseUrl}/session`, { tenant: "tenant-session" });
    const malformed = await rawRequest("POST", `${baseUrl}/session`, "not-json");

    assert.equal(wrongToken.statusCode, 401);
    assert.equal(wrongToken.body.error, "UNAUTHORIZED");
    assert.equal(wrongToken.body.safeMessage, "credentials are invalid");
    assert.equal(wrongTenant.statusCode, 401);
    assert.equal(wrongTenant.body.error, "UNAUTHORIZED");
    assert.equal(noToken.statusCode, 401);
    assert.equal(malformed.statusCode, 400);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("POST /session issues a signed cookie and cookie grants access to state and stream", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-session-ok");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<html><body>App</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const streamClient: SseHolder = {};
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    allowedOrigins: [LOCAL_UI_ORIGIN],
    hostedAuthTokens: [{ token: "tok-cookie", tenantId: "tenant-cookie" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);

    // POST /session with correct credentials.
    const sessionResp = await rawRequest("POST", `${baseUrl}/session`, JSON.stringify({ token: "tok-cookie", tenant: "tenant-cookie" }));
    assert.equal(sessionResp.statusCode, 204);
    const setCookie = sessionResp.headers["set-cookie"];
    assert.ok(setCookie, "set-cookie header must be present");
    const cookieValue = String(setCookie).match(/console_session=([^;]+)/)?.[1];
    assert.ok(cookieValue, "console_session cookie value must be present");
    assert.ok(String(setCookie).includes("HttpOnly"), "cookie must be HttpOnly");
    assert.ok(String(setCookie).includes("SameSite=Strict"), "cookie must be SameSite=Strict");
    assert.ok(String(setCookie).includes("Secure"), "cookie must have Secure");
    assert.ok(String(setCookie).includes("Path=/"), "cookie must be Path=/");

    // Cookie grants access to /state.
    const stateWithCookie = await requestJson("GET", `${baseUrl}/state`, undefined, { cookie: `console_session=${cookieValue}` });
    assert.equal(stateWithCookie.statusCode, 200);
    assert.ok("source" in stateWithCookie.body);

    // Cookie grants access to the hosted app shell with HTML hardening headers.
    const appShell = await rawRequest("GET", `${baseUrl}/`, undefined, { cookie: `console_session=${cookieValue}` });
    assert.equal(appShell.statusCode, 200);
    assert.equal(appShell.body.includes("App"), true);
    assert.equal(String(appShell.headers["x-frame-options"]), "DENY");
    assert.match(String(appShell.headers["content-security-policy"]), /default-src 'self'/);
    assert.match(String(appShell.headers["content-security-policy"]), /frame-ancestors 'none'/);

    // Cookie grants access to /stream (SSE).
    const eventStream = connectSse(`${baseUrl}/stream`, streamClient, { cookie: `console_session=${cookieValue}` });
    const ready = await eventStream.nextEvent();
    const initialState = await eventStream.nextEvent();
    assert.equal(ready.event, "ready");
    assert.equal(initialState.event, "state");

    // GET /session returns {tenantId} when cookie is present.
    const sessionCheck = await requestJson("GET", `${baseUrl}/session`, undefined, { cookie: `console_session=${cookieValue}` });
    assert.equal(sessionCheck.statusCode, 200);
    assert.equal(sessionCheck.body.tenantId, "tenant-cookie");
  } finally {
    if (streamClient.request) streamClient.request.destroy();
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("bearer token continues to work unchanged in hosted mode with dist present", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-bearer");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<html><body>App</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "tok-bearer", tenantId: "tenant-bearer" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const withBearer = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer tok-bearer" });
    const noAuth = await requestJson("GET", `${baseUrl}/state`);

    assert.equal(withBearer.statusCode, 200);
    assert.ok("source" in withBearer.body);
    assert.equal(noAuth.statusCode, 401);
    assert.equal(noAuth.body.error, "UNAUTHORIZED");
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("POST /session/logout sets Max-Age=0 to clear the session cookie", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-logout");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<html><body>App</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "tok-logout", tenantId: "tenant-logout" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);

    // Create a session.
    const sessionResp = await rawRequest("POST", `${baseUrl}/session`, JSON.stringify({ token: "tok-logout" }));
    assert.equal(sessionResp.statusCode, 204);
    const cookieValue = String(sessionResp.headers["set-cookie"]).match(/console_session=([^;]+)/)?.[1];
    assert.ok(cookieValue);

    // Verify cookie grants access.
    const withCookie = await requestJson("GET", `${baseUrl}/state`, undefined, { cookie: `console_session=${cookieValue}` });
    assert.equal(withCookie.statusCode, 200);

    // Logout.
    const logoutResp = await rawRequest("POST", `${baseUrl}/session/logout`);
    assert.equal(logoutResp.statusCode, 204);
    const clearCookie = String(logoutResp.headers["set-cookie"]);
    assert.ok(clearCookie.includes("Max-Age=0"), "logout must set Max-Age=0 to clear cookie");
    assert.ok(clearCookie.includes("console_session="), "logout must target the session cookie");

    // GET /session without any cookie returns 401.
    const sessionCheckNoAuth = await requestJson("GET", `${baseUrl}/session`);
    assert.equal(sessionCheckNoAuth.statusCode, 401);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(app);
  }
});

test("signSessionCookie and verifySessionCookieValue are consistent", () => {
  const tenantId = "test-tenant";
  const rawToken = "test-secret-token";
  const fakeConfig: any = {
    mode: "hosted",
    allowedOrigins: [],
    defaultTenantId: tenantId,
    hostedTenantIds: [tenantId],
    hostedAuthTokens: [{ token: rawToken, tenantId }],
    telemetryStorageAdapter: "postgres",
    validation: []
  };

  const cookieValue = signSessionCookie(tenantId, fakeConfig);
  const result = verifySessionCookieValue(cookieValue, fakeConfig);
  assert.ok(result, "valid cookie must verify");
  assert.equal(result.tenantId, tenantId);

  // Tampered signature should fail.
  const parts = cookieValue.split(".");
  const tampered = parts[0] + "." + parts[1] + "." + "a".repeat(parts[2].length);
  assert.equal(verifySessionCookieValue(tampered, fakeConfig), null);

  // Unknown tenant should fail.
  const fakeConfig2 = { ...fakeConfig, hostedAuthTokens: [{ token: rawToken, tenantId: "other" }] };
  assert.equal(verifySessionCookieValue(cookieValue, fakeConfig2), null);
});

test("GET /session returns 401 when no cookie present and 404 in local mode", async () => {
  const rootDir = tempRoot();
  const uiDist = path.join(rootDir, "ui-dist-session-check");
  fs.mkdirSync(uiDist, { recursive: true });
  fs.writeFileSync(path.join(uiDist, "index.html"), "<html><body>App</body></html>", "utf8");
  const originalEnv = process.env.CONSOLE_UI_DIST;
  process.env.CONSOLE_UI_DIST = uiDist;

  // Hosted mode.
  const hostedApp = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: new FakeTelemetrySqlClient(),
    hostedAuthTokens: [{ token: "tok-check", tenantId: "tenant-check" }]
  });
  await listen(hostedApp);

  // Local mode.
  const localApp = createConsoleHubServer({ rootDir: tempRoot(), port: 0 });
  await listen(localApp);

  try {
    const hostedUrl = serverUrl(hostedApp);
    const localUrl = serverUrl(localApp);

    const hostedNoSession = await requestJson("GET", `${hostedUrl}/session`);
    const localSession = await requestJson("GET", `${localUrl}/session`);

    assert.equal(hostedNoSession.statusCode, 401);
    assert.equal(localSession.statusCode, 404);
  } finally {
    if (originalEnv === undefined) delete process.env.CONSOLE_UI_DIST;
    else process.env.CONSOLE_UI_DIST = originalEnv;
    await close(hostedApp);
    await close(localApp);
  }
});



test("hosted hub server persists accepted core records to postgres and survives simulated restart", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const hostedOptions = {
    rootDir,
    port: 0 as const,
    runtimeMode: "hosted" as const,
    telemetryStorageAdapter: "postgres" as const,
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-records", tenantId: "tenant-records" }]
  };
  const firstApp = createConsoleHubServer(hostedOptions);
  await listen(firstApp);
  try {
    const baseUrl = serverUrl(firstApp);
    const event = { ...surfaceFlowHandoffStream().events[0], id: "evt-persist-check" };
    const accepted = await requestJson("POST", `${baseUrl}/records`, event, { authorization: "Bearer token-records" });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.outcome, "accepted");
    assert.equal(accepted.body.sinkId, "postgres-core-records");
    // Postgres row must exist for this tenant+record combination.
    assert.equal(sqlClient.coreRows.some((row: any) => row.tenant_id === "tenant-records" && row.record_id === "evt-persist-check"), true);
  } finally {
    await close(firstApp);
  }

  // Simulate a redeploy: second server with a fresh in-memory state but the same
  // shared FakeTelemetrySqlClient (which retains the previously inserted row).
  const secondApp = createConsoleHubServer(hostedOptions);
  await listen(secondApp);
  try {
    const state = await requestJson("GET", `${serverUrl(secondApp)}/state`, undefined, { authorization: "Bearer token-records" });
    assert.equal(state.statusCode, 200);
    assert.equal(state.body.source.acceptedEventCount, 1);
    assert.equal(state.body.timeline.some((item: any) => item.id === "evt-persist-check"), true);
  } finally {
    await close(secondApp);
  }
});

test("hosted hub server returns accepted-as-duplicate for a duplicate core record POST", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    runtimeMode: "hosted",
    telemetryStorageAdapter: "postgres",
    telemetryDatabaseUrl: "postgres://example.invalid/console",
    telemetrySqlClient: sqlClient,
    hostedAuthTokens: [{ token: "token-dup", tenantId: "tenant-dup" }]
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const event = { ...surfaceFlowHandoffStream().events[0], id: "evt-duplicate-core" };
    const first = await requestJson("POST", `${baseUrl}/records`, event, { authorization: "Bearer token-dup" });
    const second = await requestJson("POST", `${baseUrl}/records`, event, { authorization: "Bearer token-dup" });
    const state = await requestJson("GET", `${baseUrl}/state`, undefined, { authorization: "Bearer token-dup" });

    assert.equal(first.statusCode, 202);
    assert.equal(first.body.outcome, "accepted");
    // Second POST of the same record is also accepted (on-conflict update).
    assert.equal(second.statusCode, 202);
    assert.equal(second.body.outcome, "accepted");
    // Only one row in DB for this record_id.
    assert.equal(sqlClient.coreRows.filter((row: any) => row.record_id === "evt-duplicate-core").length, 1);
    // State reflects the single deduplicated event.
    assert.equal(state.body.source.acceptedEventCount >= 1, true);
  } finally {
    await close(app);
  }
});

test("local hub server does not write core records to postgres in local mode", async () => {
  const rootDir = tempRoot();
  const sqlClient = new FakeTelemetrySqlClient();
  // Local mode even when a sql client is injected for telemetry — core records
  // must NOT be written to postgres in local mode.
  const app = createConsoleHubServer({
    rootDir,
    port: 0,
    telemetryStorageAdapter: "local-jsonl",
    telemetrySqlClient: sqlClient
  });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const event = surfaceFlowHandoffStream().events[0];
    const accepted = await requestJson("POST", `${baseUrl}/records`, event);
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.body.outcome, "accepted");
    // No core record rows must have been written to the fake SQL client.
    assert.equal(sqlClient.coreRows.length, 0);
  } finally {
    await close(app);
  }
});

test("console migrations include the core-records migration", async () => {
  const migrations = loadConsoleMigrations();
  assert.equal(migrations.some((m: any) => m.name === "0002_core_records.sql"), true);
  assert.equal(migrations.some((m: any) => m.name === "0003_liveness_ordering.sql"), true);
});

test("liveness ordering migration backfills relaxed UTC-Z timestamps at integer-millisecond precision", () => {
  const migration = loadConsoleMigrations().find((item: any) => item.name === "0003_liveness_ordering.sql");
  assert.ok(migration);
  assert.match(migration.sql, /\(\[\.\]\[0-9\]\{1,9\}\)\?Z\$/);
  assert.match(migration.sql, /left\(rpad\(coalesce\(substring\(payload ->> 'at' from '\[\.\]\(\[0-9\]\{1,9\}\)Z\$'\), ''\), 3, '0'\), 3\)/);
  assert.match(migration.sql, /floor\(extract\(epoch from candidate\.at_ms::timestamptz\) \* 1000\)::bigint/);
  assert.match(migration.sql, /substring\(payload ->> 'at' from 1 for 4\) <> '0000'/);
  assert.match(migration.sql, /isfinite\(candidate\.at_ms::timestamptz\)/);
  assert.match(migration.sql, /to_char\(candidate\.at_ms::timestamptz at time zone 'UTC'.*HH24:MI:SS'\)\s+= substring\(candidate\.at from 1 for 19\)/s);
  assert.match(migration.sql, /exception when others then\s+null;/);
  assert.match(migration.sql, /liveness_order_rank = case when payload ->> 'type' = 'release' then 1 else 0 end/);

  const migrationMillisecondInput = (at: string) => {
    const fraction = (at.match(/[.]([0-9]{1,9})Z$/)?.[1] ?? "").padEnd(3, "0").slice(0, 3);
    return `${at.slice(0, 19)}.${fraction}Z`;
  };
  const roundingEdge = migrationMillisecondInput("2026-07-10T05:33:49.123999999Z");
  assert.equal(roundingEdge, "2026-07-10T05:33:49.123Z");
  assert.equal(Date.parse(roundingEdge), Date.parse("2026-07-10T05:33:49.123Z"));
  const secondEdge = migrationMillisecondInput("2026-07-10T05:33:49.999999999Z");
  assert.equal(secondEdge, "2026-07-10T05:33:49.999Z");
  assert.equal(new Date(Date.parse(secondEdge)).toISOString(), "2026-07-10T05:33:49.999Z");
  for (const rejected of ["infinity", "now", "+00:00"]) {
    assert.equal(migration.sql.includes(rejected), false, `migration must not special-case ${rejected} into the canonical domain`);
  }
});

test("core-record upsert rejects cross-schema ID collisions in both directions", async () => {
  const sqlClient = new FakeTelemetrySqlClient();
  const repo = new CoreRecordsRepository(sqlClient);
  const observedAt = "2026-07-10T05:34:00.000Z";
  const at = "2026-07-10T05:33:49.123Z";
  const firstId = "liveness:actor-1:task-alpha";
  const release = { ...livenessRecord({ type: "release", at }), id: firstId };
  const ordinaryCollision = { schema: "kontour.console.event", version: "0.1", id: firstId, type: "collision" };

  assert.equal((await repo.persist(release, "tenant-a", observedAt)).status, "persisted");
  assert.equal((await repo.persist(ordinaryCollision as any, "tenant-a", observedAt)).status, "record_id_collision_ignored");
  const protectedLiveness = sqlClient.coreRows.find((row: any) => row.record_id === firstId);
  assert.equal(protectedLiveness.schema, "kontour.console.liveness");
  assert.equal(protectedLiveness.payload.type, "release");
  assert.equal(protectedLiveness.liveness_order_ms, Date.parse(at));

  const secondId = "liveness:actor-2:task-beta";
  const ordinaryFirst = { ...ordinaryCollision, id: secondId, type: "ordinary-first" };
  const collidingLiveness = {
    ...livenessRecord({ actor: "actor-2", subjectId: "task-beta", type: "release", at }),
    id: secondId
  };
  assert.equal((await repo.persist(ordinaryFirst as any, "tenant-a", observedAt)).status, "persisted");
  assert.equal((await repo.persist(collidingLiveness, "tenant-a", observedAt)).status, "stale_liveness_ignored");
  const protectedOrdinary = sqlClient.coreRows.find((row: any) => row.record_id === secondId);
  assert.equal(protectedOrdinary.schema, "kontour.console.event");
  assert.equal(protectedOrdinary.payload.type, "ordinary-first");
  assert.equal(protectedOrdinary.liveness_order_ms, null);

  const ordinaryUpdate = { ...ordinaryFirst, type: "ordinary-updated" };
  assert.equal((await repo.persist(ordinaryUpdate as any, "tenant-a", observedAt)).status, "persisted");
  assert.equal(sqlClient.coreRows.find((row: any) => row.record_id === secondId).payload.type, "ordinary-updated");
});

test("core-record CAS treats noncanonical timestamps as oldest and release as canonical equality winner", async () => {
  const sqlClient = new FakeTelemetrySqlClient();
  const repo = new CoreRecordsRepository(sqlClient);
  const at = "2026-07-07T10:00:00.123Z";
  const release = { ...livenessRecord({ type: "release", at }), id: "liveness:actor-1:task-alpha" };
  assert.equal((await repo.persist(release, "tenant-a", at)).status, "persisted");

  for (const rejectedAt of [
    "infinity", "-infinity", "now",
    "2026-07-07T04:00:00.123-06:00",
    "2026-07-07T10:00:00+02:00",
    "0000-01-01T00:00:00Z",
    "2026-07-07T24:00:00.000Z"
  ]) {
    const active = { ...livenessRecord({ type: "heartbeat", at: rejectedAt }), id: release.id };
    assert.equal((await repo.persist(active, "tenant-a", at)).status, "stale_liveness_ignored");
  }
  const equalActive = { ...livenessRecord({ type: "claim", at }), id: release.id };
  assert.equal((await repo.persist(equalActive, "tenant-a", at)).status, "stale_liveness_ignored");
  assert.equal(sqlClient.coreRows[0].payload.type, "release");
  assert.equal(sqlClient.coreRows[0].liveness_order_ms, Date.parse(at));

  const secondId = "liveness:actor-2:task-beta";
  const activeFirst = { ...livenessRecord({ actor: "actor-2", subjectId: "task-beta", type: "heartbeat", at }), id: secondId };
  const releaseSecond = { ...activeFirst, type: "release" };
  assert.equal((await repo.persist(activeFirst, "tenant-a", at)).status, "persisted");
  assert.equal((await repo.persist(releaseSecond, "tenant-a", at)).status, "persisted");
  assert.equal(sqlClient.coreRows.find((row: any) => row.record_id === secondId).payload.type, "release");
});

test("console migrations apply core-records migration idempotently", async () => {
  const sqlClient = new FakeTelemetrySqlClient();
  const migrations = loadConsoleMigrations();

  const first = await applyConsoleMigrations(sqlClient, migrations);
  const second = await applyConsoleMigrations(sqlClient, migrations);

  assert.equal(first.some((r: any) => r.name === "0002_core_records.sql" && r.applied), true);
  assert.equal(first.some((r: any) => r.name === "0003_liveness_ordering.sql" && r.applied), true);
  assert.equal(second.every((r: any) => r.applied === false), true);
});

function surfaceFlowHandoffStream() {
  const report = inspectFixtures({ rootDir: process.env.KONTOUR_REPO_ROOT || process.cwd() });
  return report.eventStreams.find((item: any) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
}

function surfaceFlowHandoffProjection() {
  const report = inspectFixtures({ rootDir: process.env.KONTOUR_REPO_ROOT || process.cwd() });
  return report.projections.find((item: any) => item.relativePath.endsWith("surface-flow-handoff-current.json"));
}

function advisoryLearningEvent() {
  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-learning-provider-directory-operator-note",
    type: "learning.recorded",
    sequence: 99,
    occurredAt: "2026-06-04T12:03:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    subject: { product: "flow-agents", kind: "workflow-learning", id: "learning-provider-directory-operator-note" },
    payload: {
      summary: "Operators need advisory context separate from provider-owned claim and gate state.",
      refs: [
        { product: "surface", kind: "claim", id: "claim-provider-directory-current", label: "Provider directory current" },
        { product: "flow", kind: "run", id: "run-provider-directory-refresh", label: "Provider directory refresh" }
      ],
      actions: [
        {
          id: "action-learning-should-not-project",
          label: "Learning action should stay advisory",
          status: "available",
          authority: { product: "flow-agents", command: "learning.apply" }
        }
      ],
      after: {
        nextActionRefs: [{ product: "flow", kind: "action", id: "action-learning-next-should-not-project" }]
      },
      data: {
        id: "learning-provider-directory-operator-note",
        family: "workflow",
        nonAuthority: true,
        confidence: 0.84,
        sourceRef: { product: "flow", kind: "run", id: "run-provider-directory-refresh", label: "Provider directory refresh" }
      }
    }
  };
}

function telemetryRecord(eventId: string, eventType: string, sessionId: string, timestamp: string) {
  return {
    schema_version: "0.3.0",
    timestamp,
    session_id: sessionId,
    event_id: eventId,
    event_type: eventType,
    agent: { name: "dev", runtime: "codex" }
  };
}

// Find a persisted record by id across a tenant's inspected event streams.
// Records reload from disk, so the stamped tenant_id survives round-trip.
function storedRecordById(inspection: any, id: string): any {
  for (const stream of inspection.eventStreams || []) {
    for (const event of stream.events || []) {
      if (event.id === id) return event;
    }
  }
  return undefined;
}

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

function requestJson(method: any, url: any, payload?: any, extraHeaders: Record<string, string> = {}): Promise<JsonResponse> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return rawRequest(method, url, body, extraHeaders).then((result: any) => ({
    statusCode: result.statusCode,
    body: JSON.parse(result.body)
  }));
}

function rawRequest(method: any, url: any, body?: any, extraHeaders: Record<string, string> = {}): Promise<RawResponse> {
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
      response.on("data", (chunk: any) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: responseBody
        });
      });
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function connectSse(url: any, holder: SseHolder = {}, extraHeaders: Record<string, string> = {}) {
  const queue: SseEvent[] = [];
  const waiting: Array<(event: SseEvent) => void> = [];
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
          enqueueEvent({
            event: currentEvent,
            data: JSON.parse(currentData.join("\n") || "{}")
          });
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
    nextEvent(): Promise<SseEvent> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      return new Promise((resolve: any) => waiting.push(resolve));
    }
  };

  function enqueueEvent(event: SseEvent) {
    if (waiting.length) waiting.shift()!(event);
    else queue.push(event);
  }
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "console-http-"));
}

class FakeTelemetrySqlClient {
  rows: any[] = [];
  coreRows: any[] = [];
  migrations = new Set<string>();
  selects: Array<{ text: string; values: any[] }> = [];
  private coreSequence = 1;
  failNextCoreLoad = false;
  beforeCoreInsert?: (payload: any) => Promise<void>;

  async query(text: string, values: any[] = []) {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized === "begin" || normalized === "commit" || normalized === "rollback" || normalized.startsWith("create table") || normalized.startsWith("create index")) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select 1")) {
      return { rows: [{ ok: 1 }], rowCount: 1 };
    }
    if (normalized.startsWith("select version from console_schema_migrations")) {
      const version = values[0];
      return { rows: this.migrations.has(version) ? [{ version }] : [], rowCount: this.migrations.has(version) ? 1 : 0 };
    }
    if (normalized.startsWith("insert into console_schema_migrations")) {
      this.migrations.add(values[0]);
      return { rows: [], rowCount: 1 };
    }
    // Core records insert (on conflict update = upsert)
    if (normalized.startsWith("insert into console_core_records")) {
      const [tenantId, recordId, schema, type, occurredAt, observedAt, payload, livenessOrderMs, livenessOrderRank] = values;
      if (this.beforeCoreInsert) await this.beforeCoreInsert(payload);
      const existingIndex = this.coreRows.findIndex((row: any) => row.tenant_id === tenantId && row.record_id === recordId);
      if (existingIndex >= 0) {
        const existingSchema = this.coreRows[existingIndex].schema;
        const existingOrderMs = this.coreRows[existingIndex].liveness_order_ms;
        const existingOrderRank = this.coreRows[existingIndex].liveness_order_rank ?? 0;
        if (schema !== existingSchema
          || (schema === "kontour.console.liveness"
            && (typeof livenessOrderMs !== "number"
              || (typeof existingOrderMs === "number"
                && (livenessOrderMs < existingOrderMs
                  || (livenessOrderMs === existingOrderMs && livenessOrderRank <= existingOrderRank)))))) {
          return { rows: [], rowCount: 0 };
        }
        // on conflict do update — preserve sequence
        this.coreRows[existingIndex] = {
          ...this.coreRows[existingIndex],
          schema,
          type,
          occurred_at: occurredAt,
          observed_at: observedAt,
          payload,
          liveness_order_ms: livenessOrderMs,
          liveness_order_rank: livenessOrderRank
        };
      } else {
        this.coreRows.push({
          tenant_id: tenantId,
          record_id: recordId,
          schema,
          type,
          occurred_at: occurredAt,
          observed_at: observedAt,
          sequence: this.coreSequence++,
          payload,
          liveness_order_ms: livenessOrderMs,
          liveness_order_rank: livenessOrderRank
        });
      }
      return { rows: [{ record_id: recordId }], rowCount: 1 };
    }
    // Core records select ordered by sequence
    if (normalized.startsWith("select payload from console_core_records")) {
      if (this.failNextCoreLoad) {
        this.failNextCoreLoad = false;
        throw new Error("forced core load failure");
      }
      const tenantId = values[0];
      const rows = this.coreRows
        .filter((row: any) => row.tenant_id === tenantId)
        .sort((a: any, b: any) => a.sequence - b.sequence)
        .map((row: any) => ({ payload: row.payload }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("insert into console_telemetry_events")) {
      const [tenantId, eventId, schemaVersion, eventType, sessionId, observedAt, receivedAt, payload] = values;
      const existingIndex = this.rows.findIndex((row) => row.tenant_id === tenantId && row.event_id === eventId);
      const row = {
        tenant_id: tenantId,
        event_id: eventId,
        schema_version: schemaVersion,
        event_type: eventType,
        session_id: sessionId,
        observed_at: observedAt,
        received_at: receivedAt,
        payload
      };
      if (existingIndex >= 0) this.rows[existingIndex] = row;
      else this.rows.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("select event_id, event_type, session_id, observed_at, received_at, payload from console_telemetry_events")) {
      const tenantId = values[0];
      const hasFrom = normalized.includes("coalesce(observed_at, received_at) >= ");
      const hasTo = normalized.includes("coalesce(observed_at, received_at) <= ");
      const from = hasFrom ? String(values[1]) : undefined;
      const to = hasTo ? String(values[hasFrom ? 2 : 1]) : undefined;
      const limit = Number(values[values.length - 1]);
      const direction = normalized.includes(" order by coalesce(observed_at, received_at) asc ") ? "asc" : "desc";
      this.selects.push({ text, values });
      const sorted = this.rows
        .filter((row) => row.tenant_id === tenantId)
        .filter((row) => !from || String(row.observed_at || row.received_at) >= from)
        .filter((row) => !to || String(row.observed_at || row.received_at) <= to)
        .sort((left, right) => direction === "asc"
          ? String(left.observed_at || left.received_at).localeCompare(String(right.observed_at || right.received_at))
          : String(right.observed_at || right.received_at).localeCompare(String(left.observed_at || left.received_at)))
        .slice(0, limit);
      return {
        rows: sorted.map((row) => ({
          event_id: row.event_id,
          event_type: row.event_type,
          session_id: row.session_id,
          observed_at: row.observed_at,
          received_at: row.received_at,
          payload: row.payload
        })),
        rowCount: sorted.length
      };
    }
    return { rows: [], rowCount: 0 };
  }
}
