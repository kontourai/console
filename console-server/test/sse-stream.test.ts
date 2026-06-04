// @ts-nocheck
import assert = require("node:assert/strict");
import test = require("node:test");
import { createSseBroker, writeSse } from "../src/console-foundation/sse-stream";

test("writes server-sent event frames as JSON data", () => {
  const response = fakeResponse();

  writeSse(response, "state", { acceptedEventCount: 2 });

  assert.equal(response.body, "event: state\ndata: {\"acceptedEventCount\":2}\n\n");
});

test("broadcasts to active SSE clients and removes closed clients", () => {
  const broker = createSseBroker();
  const first = fakeResponse();
  const second = fakeResponse();

  broker.add(first);
  broker.add(second);
  broker.remove(first);
  broker.broadcast("record.accepted", { id: "evt-1" });
  broker.closeAll();

  assert.equal(first.body, "");
  assert.equal(first.ended, false);
  assert.equal(second.body, "event: record.accepted\ndata: {\"id\":\"evt-1\"}\n\n");
  assert.equal(second.ended, true);
  assert.equal(broker.clients.size, 0);
});

test("removes failed SSE clients without failing broadcast", () => {
  const broker = createSseBroker();
  const failed = {
    write() {
      throw new Error("client disconnected");
    },
    end() {}
  };
  const active = fakeResponse();

  broker.add(failed);
  broker.add(active);
  broker.broadcast("record.accepted", { id: "evt-1" });

  assert.equal(active.body, "event: record.accepted\ndata: {\"id\":\"evt-1\"}\n\n");
  assert.equal(broker.clients.has(failed), false);
  assert.equal(broker.clients.has(active), true);
});

function fakeResponse() {
  return {
    body: "",
    ended: false,
    write(chunk: string) {
      this.body += chunk;
      return true;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}
