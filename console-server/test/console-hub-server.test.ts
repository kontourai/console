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
      ".kontour",
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
  const flowAgentsRoot = path.join(rootDir, "flow-agents", ".flow-agents");
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

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot, telemetryFlowAgentsRoot: flowAgentsRoot });
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

test("local hub server keeps newest telemetry log records when logs are over the read limit", async () => {
  const rootDir = tempRoot();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  const flowAgentsRoot = path.join(rootDir, "flow-agents", ".flow-agents");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  const records = Array.from({ length: 5001 }, (_, index) => {
    const id = `evt-overflow-${String(index + 1).padStart(4, "0")}`;
    return JSON.stringify(telemetryRecord(id, "tool.invoke", `session-${index + 1}`, "2026-06-08T12:00:00.000Z"));
  });
  fs.writeFileSync(path.join(telemetryRoot, "full.jsonl"), `${records.join("\n")}\n`, "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot, telemetryFlowAgentsRoot: flowAgentsRoot });
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
    const sinkPath = path.join(rootDir, ".kontour", "telemetry", "records.jsonl");

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
    const sinkPath = path.join(rootDir, ".kontour", "telemetry", "records.jsonl");

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
    const sinkPath = path.join(rootDir, ".kontour", "telemetry", "records.jsonl");

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
    const sinkPath = path.join(rootDir, ".kontour", "telemetry", "records.jsonl");

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
    const sinkPath = path.join(rootDir, ".kontour", "telemetry", "records.jsonl");

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
    const sinkPath = path.join(rootDir, ".kontour", "telemetry", "records.jsonl");

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
    const wrongTenant = await requestJson("GET", `${baseUrl}/api/telemetry`, undefined, {
      authorization: "Bearer token-a",
      "x-console-tenant-id": "tenant-b"
    });
    const sinkPath = path.join(rootDir, ".kontour", "telemetry", "records.jsonl");

    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(acceptedA.statusCode, 202);
    assert.equal(acceptedB.statusCode, 202);
    assert.equal(fs.existsSync(sinkPath), false);
    assert.equal(tenantA.body.records.some((item: any) => item.eventId === "evt-tenant-a"), true);
    assert.equal(tenantA.body.records.some((item: any) => item.eventId === "evt-tenant-b"), false);
    assert.equal(tenantB.body.records.some((item: any) => item.eventId === "evt-tenant-b"), true);
    assert.equal(tenantB.body.records.some((item: any) => item.eventId === "evt-tenant-a"), false);
    assert.equal(wrongTenant.statusCode, 403);
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
  const flowAgentsRoot = path.join(flowAgentsRepo, ".flow-agents");
  fs.mkdirSync(path.join(flowAgentsRoot, "shape-provider-settings"), { recursive: true });
  fs.writeFileSync(path.join(flowAgentsRepo, "console.telemetry.json"), JSON.stringify({
    recordSources: [{
      id: "flow-agents-workflows",
      root: "product:.flow-agents",
      files: ["state.json"],
      attributes: {
        taskSlug: "task_slug",
        status: "status",
        title: "summary",
        observedAt: "updated_at"
      }
    }],
    facets: [{ id: "workflow-status", label: "Workflow status", attribute: "status" }],
    flows: [{ id: "builder.shape", label: "Builder shape", match: { attribute: "taskSlug", includes: "shape" }, titleAttribute: "title" }]
  }), "utf8");
  fs.writeFileSync(path.join(flowAgentsRoot, "shape-provider-settings", "state.json"), JSON.stringify({
    schema_version: "1.0",
    task_slug: "shape-provider-settings",
    status: "done",
    summary: "Shape provider settings",
    updated_at: "2026-06-08T12:02:00.000Z"
  }), "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot: path.join(rootDir, ".telemetry"), telemetryFlowAgentsRoot: flowAgentsRoot });
  await listen(app);
  try {
    const telemetry = await requestJson("GET", `${serverUrl(app)}/api/telemetry`);

    assert.equal(telemetry.statusCode, 200);
    assert.equal(telemetry.body.analytics.facets[0].id, "workflow-status");
    assert.equal(telemetry.body.analytics.flows[0].id, "builder.shape");
    assert.equal(telemetry.body.analytics.flows[0].total, 1);
    assert.equal(telemetry.body.analytics.flows[0].items[0].title, "Shape provider settings");
  } finally {
    await close(app);
  }
});

test("local hub server rejects descriptor record source symlink escapes", async () => {
  const rootDir = tempRoot();
  const flowAgentsRepo = path.join(rootDir, "flow-agents");
  const flowAgentsRoot = path.join(flowAgentsRepo, ".flow-agents");
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
      root: "product:.flow-agents",
      files: ["state.json"],
      attributes: {
        taskSlug: "task_slug",
        status: "status"
      }
    }]
  }), "utf8");

  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot: path.join(rootDir, ".telemetry"), telemetryFlowAgentsRoot: flowAgentsRoot });
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

test("local hub server reports missing descriptor record sources without failing telemetry summary", async () => {
  const rootDir = tempRoot();
  fs.writeFileSync(path.join(rootDir, "console.telemetry.json"), JSON.stringify({
    recordSources: [{
      id: "missing-product-records",
      root: "product:missing-dir",
      files: ["state.json"]
    }]
  }), "utf8");
  const app = createConsoleHubServer({ rootDir, port: 0, telemetryRoot: path.join(rootDir, ".telemetry"), telemetryFlowAgentsRoot: path.join(rootDir, "missing-product", ".flow-agents") });
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

function connectSse(url: any, holder: SseHolder = {}) {
  const queue: SseEvent[] = [];
  const waiting: Array<(event: SseEvent) => void> = [];
  let buffer = "";
  let currentEvent: string | null = null;
  let currentData: string[] = [];

  const request = http.request(url, { method: "GET", headers: { accept: "text/event-stream", origin: LOCAL_UI_ORIGIN } }, (response: any) => {
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
  migrations = new Set<string>();

  async query(text: string, values: any[] = []) {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized === "begin" || normalized === "commit" || normalized === "rollback" || normalized.startsWith("create table")) {
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
      return {
        rows: this.rows.filter((row) => row.tenant_id === tenantId).map((row) => ({
          event_id: row.event_id,
          event_type: row.event_type,
          session_id: row.session_id,
          observed_at: row.observed_at,
          received_at: row.received_at,
          payload: row.payload
        })),
        rowCount: this.rows.length
      };
    }
    return { rows: [], rowCount: 0 };
  }
}
