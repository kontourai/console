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

test("local hub server accepts records and exposes current state", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  try {
    const baseUrl = serverUrl(app);
    const stream = surfaceFlowHandoffStream();
    const results = [];

    for (const event of stream.events) {
      results.push(await requestJson("POST", `${baseUrl}/records`, event));
    }

    const state = await requestJson("GET", `${baseUrl}/state`);
    const inspection = await requestJson("GET", `${baseUrl}/inspect`);

    assert.deepEqual(results.map((item) => item.statusCode), [202, 202, 202, 202, 202, 202]);
    assert.equal(state.body.source.acceptedEventCount, 6);
    assert.equal(state.body.gates[0].status, "passed");
    assert.equal(state.body.claims[0].freshness.status, "fresh");
    assert.equal(state.body.actions[0].readOnly, true);
    assert.equal(state.body.currentStage, "Provider directory freshness passed; Provider directory refresh can continue.");
    assert.equal(inspection.body.validation.errors.length, 0);
    assert.equal(inspection.body.eventStreams.length, 2);
  } finally {
    await close(app);
  }
});

test("local hub server streams accepted record updates over SSE", async () => {
  const rootDir = tempRoot();
  const app = createConsoleHubServer({ rootDir, port: 0 });
  await listen(app);
  const streamClient = { request: null };
  try {
    const baseUrl = serverUrl(app);
    const eventStream = connectSse(`${baseUrl}/events`, streamClient);
    const ready = await eventStream.nextEvent();
    const initialState = await eventStream.nextEvent();
    const stream = surfaceFlowHandoffStream();
    const invalid = await requestJson("POST", `${baseUrl}/records`, {
      schema: "kontour.console.event",
      version: "0.1",
      id: "bad-event"
    });
    const result = await requestJson("POST", `${baseUrl}/records`, stream.events[0]);
    const update = await eventStream.nextEvent();

    assert.equal(ready.event, "ready");
    assert.equal(initialState.event, "state");
    assert.equal(initialState.data.source.acceptedEventCount, 0);
    assert.equal(invalid.statusCode, 400);
    assert.equal(result.statusCode, 202);
    assert.equal(update.event, "record.accepted");
    assert.equal(update.data.delivery.outcome, "accepted");
    assert.equal(update.data.delivery.recordId, "evt-surface-flow-handoff-001");
    assert.equal(update.data.state.source.acceptedEventCount, 1);
    assert.equal(update.data.state.timeline[0].id, "evt-surface-flow-handoff-001");
  } finally {
    if (streamClient.request) streamClient.request.destroy();
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
    assert.equal(invalidRecord.statusCode, 400);
    assert.equal(invalidRecord.body.outcome, "failed");
    assert.equal(invalidRecord.body.errorCode, "INVALID_RECORD");
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
  const report = inspectFixtures({ rootDir: process.cwd() });
  return report.eventStreams.find((item) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
}

function listen(app) {
  return new Promise((resolve) => app.listen({ port: 0 }, resolve));
}

function close(app) {
  return new Promise((resolve, reject) => {
    app.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function serverUrl(app) {
  const address = app.server.address();
  return `http://${address.address}:${address.port}`;
}

function requestJson(method, url, payload) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return rawRequest(method, url, body).then((result) => ({
    statusCode: result.statusCode,
    body: JSON.parse(result.body)
  }));
}

function rawRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: body === undefined
        ? undefined
        : {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        }
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: responseBody
        });
      });
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function connectSse(url, holder = {}) {
  const queue = [];
  const waiting = [];
  let buffer = "";
  let currentEvent = null;
  let currentData = [];

  const request = http.request(url, { method: "GET" }, (response) => {
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
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
    nextEvent() {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiting.push(resolve));
    }
  };

  function enqueueEvent(event) {
    if (waiting.length) waiting.shift()(event);
    else queue.push(event);
  }
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kontour-console-http-"));
}
