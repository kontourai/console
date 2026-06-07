import assert from "node:assert/strict";
import test from "node:test";
import {
  connectHubEvents,
  connectStream,
  getEvents,
  getState,
  postRecord
} from "../src/hubClient";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CLOSED = 2;
  url: string;
  readyState = 1;
  listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(eventName: string, listener: Listener): void {
    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(eventName: string, data: unknown): void {
    for (const listener of this.listeners.get(eventName) || []) {
      listener({ data: JSON.stringify(data) });
    }
  }

  emitRaw(eventName: string, data: string): void {
    for (const listener of this.listeners.get(eventName) || []) {
      listener({ data });
    }
  }
}

test("hub client fetches state and events from typed endpoints", async () => {
  const fetchCalls = installFetch([
    jsonResponse({ currentStage: "Ready" }),
    jsonResponse([{ relativePath: "events/local.jsonl", events: [] }])
  ]);

  const state = await getState("http://127.0.0.1:3737");
  const events = await getEvents("http://127.0.0.1:3737");

  assert.equal(state.currentStage, "Ready");
  assert.equal(events[0].relativePath, "events/local.jsonl");
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:3737/state");
  assert.deepEqual(fetchCalls[0].init?.headers, { accept: "application/json" });
  assert.equal(fetchCalls[1].url, "http://127.0.0.1:3737/events");
});

test("hub client posts records to the records endpoint", async () => {
  const fetchCalls = installFetch([
    jsonResponse({ outcome: "accepted", recordId: "evt-1" })
  ]);

  const result = await postRecord("http://127.0.0.1:3737", {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-1",
    type: "claim.status.changed",
    occurredAt: "2026-06-07T00:00:00Z",
    producer: { product: "surface" },
    subject: { product: "surface", kind: "claim", id: "claim-1" },
    payload: {}
  });

  assert.equal("recordId" in result ? result.recordId : undefined, "evt-1");
  assert.equal(fetchCalls[0].url, "http://127.0.0.1:3737/records");
  assert.equal(fetchCalls[0].init?.method, "POST");
  assert.deepEqual(fetchCalls[0].init?.headers, { "content-type": "application/json" });
  assert.equal(JSON.parse(String(fetchCalls[0].init?.body)).schema, "kontour.console.event");
});

test("hub client opens canonical stream endpoint and handles accepted payloads", () => {
  installEventSource();
  const states: unknown[] = [];
  const accepted: unknown[] = [];
  const statuses: string[] = [];
  const connection = connectStream("http://127.0.0.1:3737", {
    onStatus: (status) => statuses.push(status),
    onState: (state) => states.push(state),
    onRecordAccepted: (event) => accepted.push(event),
    onError: () => undefined
  });
  const source = FakeEventSource.instances[0];

  source.emit("state", { currentStage: "Connected" });
  source.emit("record.accepted", {
    delivery: { recordId: "evt-1" },
    state: { currentStage: "Updated" }
  });
  connection.close();

  assert.equal(source.url, "http://127.0.0.1:3737/stream");
  assert.deepEqual(statuses, ["connecting", "disconnected"]);
  assert.deepEqual(states, [{ currentStage: "Connected" }, { currentStage: "Updated" }]);
  assert.deepEqual(accepted, [{ delivery: { recordId: "evt-1" }, state: { currentStage: "Updated" } }]);
  assert.equal(source.closed, true);
});

test("connectHubEvents delegates to the canonical stream and ignores malformed SSE JSON", () => {
  installEventSource();
  const originalWarn = console.warn;
  console.warn = () => undefined;
  const states: unknown[] = [];
  const errors: string[] = [];
  try {
    const connection = connectHubEvents("http://127.0.0.1:3737", {
      onStatus: () => undefined,
      onState: (state) => states.push(state),
      onRecordAccepted: () => undefined,
      onError: (message) => errors.push(message)
    });
    const source = FakeEventSource.instances[0];

    source.emitRaw("state", "{");
    source.listeners.get("error")?.forEach((listener) => listener({ data: "" }));
    connection.close();

    assert.equal(source.url, "http://127.0.0.1:3737/stream");
    assert.deepEqual(states, []);
    assert.deepEqual(errors, ["Event stream unavailable at http://127.0.0.1:3737/stream"]);
  } finally {
    console.warn = originalWarn;
  }
});

function installFetch(responses: Response[]): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch call");
    return Promise.resolve(response);
  }) as typeof fetch;
  return calls;
}

function installEventSource(): void {
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  } as Response;
}
