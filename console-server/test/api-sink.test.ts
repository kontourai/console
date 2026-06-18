const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ApiSink } = require("../src/console-foundation");

function validEvent(overrides: any = {}) {
  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: "event-api-sink-1",
    type: "claim.updated",
    occurredAt: "2026-06-18T16:00:00Z",
    producer: { product: "surface", id: "surface-producer" },
    scope: { product: "surface", kind: "tenant", id: "acme" },
    subject: { product: "surface", kind: "claim", id: "claim-1" },
    payload: { status: "verified" },
    links: [],
    ...overrides,
  };
}

// A scripted fetch double: records every call and replies from a queue of
// responses (status codes), so retry/backoff and header routing are observable.
function fetchDouble(statuses: number[]) {
  const calls: Array<{ url: string; init: any }> = [];
  let index = 0;
  const fetchImpl = async (url: string, init: any) => {
    calls.push({ url, init });
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return { ok: status >= 200 && status < 300, status, text: async () => "" };
  };
  return { calls, fetchImpl };
}

const noSleep = async () => {};

test("ApiSink POSTs the record to <hub>/records and reports accepted", async () => {
  const { calls, fetchImpl } = fetchDouble([200]);
  const sink = new ApiSink("https://console.kontourai.io/", "tok-123", { fetch: fetchImpl, sleep: noSleep });

  const result = await sink.deliver(validEvent());

  assert.equal(result.outcome, "accepted");
  assert.equal(result.sinkRole, "ApiSink");
  assert.equal(result.recordId, "event-api-sink-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://console.kontourai.io/records");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).id, "event-api-sink-1");
});

test("ApiSink sends a Bearer auth header (and x-console-api-token)", async () => {
  const { calls, fetchImpl } = fetchDouble([200]);
  const sink = new ApiSink("https://hub", "secret-token", { fetch: fetchImpl, sleep: noSleep });

  await sink.deliver(validEvent());

  assert.equal(calls[0].init.headers.authorization, "Bearer secret-token");
  assert.equal(calls[0].init.headers["x-console-api-token"], "secret-token");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
});

test("ApiSink routes the tenant header when a tenantId is configured", async () => {
  const { calls, fetchImpl } = fetchDouble([200]);
  const sink = new ApiSink("https://hub", "tok", { tenantId: "acme", fetch: fetchImpl, sleep: noSleep });

  await sink.deliver(validEvent());

  assert.equal(calls[0].init.headers["x-console-tenant"], "acme");
  assert.equal(calls[0].init.headers["x-console-tenant-id"], "acme");
});

test("ApiSink is idempotent: a re-delivered record is skipped, not re-POSTed", async () => {
  const { calls, fetchImpl } = fetchDouble([200]);
  const sentIds = new Set<string>();
  const sink = new ApiSink("https://hub", "tok", { fetch: fetchImpl, sleep: noSleep, sentIds });

  const first = await sink.deliver(validEvent());
  const second = await sink.deliver(validEvent());

  assert.equal(first.outcome, "accepted");
  assert.equal(second.outcome, "skipped");
  assert.equal(calls.length, 1, "second delivery must not POST again");
  assert.equal(sentIds.has("event-api-sink-1"), true);
});

test("ApiSink retries on a 5xx then succeeds", async () => {
  const { calls, fetchImpl } = fetchDouble([503, 200]);
  const sink = new ApiSink("https://hub", "tok", { fetch: fetchImpl, sleep: noSleep, maxAttempts: 3 });

  const result = await sink.deliver(validEvent());

  assert.equal(result.outcome, "accepted");
  assert.equal(calls.length, 2, "should retry once after the 503");
});

test("ApiSink surfaces failure in DeliveryResult after exhausting retries", async () => {
  const { calls, fetchImpl } = fetchDouble([500, 500, 500]);
  const sink = new ApiSink("https://hub", "tok", { fetch: fetchImpl, sleep: noSleep, maxAttempts: 3 });

  const result = await sink.deliver(validEvent());

  assert.equal(result.outcome, "failed");
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, "HTTP_500");
  assert.equal(calls.length, 3);
  assert.match(String(result.safeMessage), /3 attempts/);
});

test("ApiSink does not retry a 4xx — surfaced immediately as non-retryable", async () => {
  const { calls, fetchImpl } = fetchDouble([400, 200]);
  const sink = new ApiSink("https://hub", "tok", { fetch: fetchImpl, sleep: noSleep, maxAttempts: 3 });

  const result = await sink.deliver(validEvent());

  assert.equal(result.outcome, "failed");
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, "HTTP_400");
  assert.equal(calls.length, 1, "4xx must not be retried");
});

test("ApiSink retries transient network (fetch throw) failures", async () => {
  const calls: any[] = [];
  let attempt = 0;
  const fetchImpl = async (url: string, init: any) => {
    calls.push({ url, init });
    attempt += 1;
    if (attempt === 1) throw new Error("ECONNREFUSED");
    return { ok: true, status: 202, text: async () => "" };
  };
  const sink = new ApiSink("https://hub", "tok", { fetch: fetchImpl, sleep: noSleep, maxAttempts: 3 });

  const result = await sink.deliver(validEvent());

  assert.equal(result.outcome, "accepted");
  assert.equal(calls.length, 2);
});

test("ApiSink rejects invalid records before any POST", async () => {
  const { calls, fetchImpl } = fetchDouble([200]);
  const sink = new ApiSink("https://hub", "tok", { fetch: fetchImpl, sleep: noSleep });

  const result = await sink.deliver({ schema: "kontour.console.event", version: "0.1" } as any);

  assert.equal(result.outcome, "failed");
  assert.equal(result.errorCode, "INVALID_RECORD");
  assert.equal(calls.length, 0);
});

test("ApiSink omits auth headers when no token is configured (loopback hub)", async () => {
  const { calls, fetchImpl } = fetchDouble([200]);
  const sink = new ApiSink("http://127.0.0.1:3737", "", { fetch: fetchImpl, sleep: noSleep });

  await sink.deliver(validEvent());

  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].init.headers["x-console-api-token"], undefined);
});
