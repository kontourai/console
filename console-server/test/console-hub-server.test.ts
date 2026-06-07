const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createConsoleHubServer,
  inspectFixtures
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
    assert.equal(result.headers["access-control-allow-headers"], "content-type");
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
    scope: { kind: "repo", id: "kontour-console" },
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

function requestJson(method: any, url: any, payload?: any): Promise<JsonResponse> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return rawRequest(method, url, body).then((result: any) => ({
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "kontour-console-http-"));
}
