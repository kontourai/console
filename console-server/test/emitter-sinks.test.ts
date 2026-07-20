const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  KontourEmitter,
  LocalFileSink,
  CompositeSink,
  DEFAULT_CONSOLE_RUNTIME_ROOT,
  InMemorySink,
  classifyRecord,
  inspectLocalKontour,
  loadProjectionSnapshots
} = require("../src/console-foundation");

test("default generated state root is .kontourai/console", () => {
  assert.equal(DEFAULT_CONSOLE_RUNTIME_ROOT, path.join(".kontourai", "console"));
  assert.equal(new LocalFileSink().root, path.resolve(".kontourai", "console"));
});

test("event fanout delivers the same event id to local JSONL and memory sinks", async () => {
  const root = tempRoot();
  const event = validEvent();
  const memory = new InMemorySink({ sinkId: "memory-test" });
  const emitter = new KontourEmitter({
    sink: new CompositeSink([
      new LocalFileSink({ root }),
      memory
    ])
  });

  const result = await emitter.emitEvent(event);

  assert.equal(result.outcome, "accepted");
  assert.equal(result.children.length, 2);
  assert.deepEqual(result.children.map((child: any) => child.outcome), ["accepted", "accepted"]);
  assert.equal(memory.records[0].id, event.id);

  const jsonlPath = path.join(root, "events", event.producer.id, `${event.scope.kind}-${event.scope.id}.jsonl`);
  const line = fs.readFileSync(jsonlPath, "utf8").trim();
  assert.equal(JSON.parse(line).id, event.id);
});

test("local projection snapshots are compatible with the existing loader", () => {
  const root = tempRoot();
  const projection = validProjection();
  const result = new LocalFileSink({ root }).deliver(projection);

  assert.equal(result.outcome, "accepted");
  assert.equal(result.sinkRole, "LocalFileSink");
  assert.equal(result.destination, path.join("projections", projection.producer.id, `${projection.scope.kind}-${projection.scope.id}.json`));

  const loaded = loadProjectionSnapshots(path.join(root, "projections", projection.producer.id), root);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].validation.filter((item: any) => item.severity === "error").length, 0);
  assert.equal(loaded[0].snapshot.generatedAt, projection.generatedAt);
  assert.equal(loaded[0].actions[0].readOnly, true);
  assert.equal(loaded[0].actions[0].authority.command, "flow.run.start");
  assert.equal(loaded[0].actions[0].authority.endpoint, "kontour-local-action");
  assert.equal(loaded[0].actions[0].warnings.some((warning: any) => warning.message.includes("inert descriptor only")), true);
});

test("local discovery loads events written through LocalFileSink", async () => {
  const rootDir = tempRoot();
  const kontourRoot = path.join(rootDir, ".kontourai", "console");
  const event = validEvent({ id: "event-local-discovery" });
  const emitter = new KontourEmitter({
    sink: new LocalFileSink({ root: kontourRoot })
  });

  const result = await emitter.emitEvent(event);
  const report = inspectLocalKontour({ rootDir });

  assert.equal(result.outcome, "accepted");
  assert.equal(report.validation.errors.length, 0);
  assert.equal(report.eventStreams.length, 1);
  assert.equal(report.eventStreams[0].sourceKind, "local");
  assert.equal(report.eventStreams[0].relativePath, path.join("events", event.producer.id, `${event.scope.kind}-${event.scope.id}.jsonl`));
  assert.equal(report.eventStreams[0].events[0].id, event.id);
});

test("default local discovery ignores state present only under .kontour", async () => {
  const rootDir = tempRoot();
  const legacyRoot = path.join(rootDir, ".kontour");
  const event = validEvent({ id: "event-legacy-only" });
  await new KontourEmitter({ sink: new LocalFileSink({ root: legacyRoot }) }).emitEvent(event);

  const report = inspectLocalKontour({ rootDir });

  assert.equal(report.kontourRoot, path.join(rootDir, ".kontourai", "console"));
  assert.equal(report.eventStreams.length, 0);
  assert.equal(fs.existsSync(path.join(legacyRoot, "events")), true);
});

test("local discovery resolves relative kontourRoot under rootDir", async () => {
  const rootDir = tempRoot();
  const event = validEvent({ id: "event-relative-root" });
  await new KontourEmitter({
    sink: new LocalFileSink({ root: path.join(rootDir, "custom-kontour") })
  }).emitEvent(event);

  const report = inspectLocalKontour({ rootDir, kontourRoot: "custom-kontour" });

  assert.equal(report.kontourRoot, path.join(rootDir, "custom-kontour"));
  assert.equal(report.eventStreams.length, 1);
  assert.equal(report.eventStreams[0].events[0].id, event.id);
});

test("local discovery loads projections written through LocalFileSink with inert actions", () => {
  const rootDir = tempRoot();
  const kontourRoot = path.join(rootDir, ".kontourai", "console");
  const projection = validProjection();
  const result = new LocalFileSink({ root: kontourRoot }).deliver(projection);

  const report = inspectLocalKontour({ rootDir });
  const loaded = report.projections[0];

  assert.equal(result.outcome, "accepted");
  assert.equal(report.validation.errors.length, 0);
  assert.equal(report.projections.length, 1);
  assert.equal(loaded.sourceKind, "local");
  assert.equal(loaded.relativePath, path.join("projections", projection.producer.id, `${projection.scope.kind}-${projection.scope.id}.json`));
  assert.equal(loaded.snapshot.generatedAt, projection.generatedAt);
  assert.equal(loaded.summary.objectCounts.claims, 1);
  assert.equal(loaded.summary.objectCounts.actions, 1);
  assert.equal(loaded.actions[0].id, "action-refresh-provider-directory");
  assert.equal(loaded.actions[0].readOnly, true);
  assert.equal(loaded.actions[0].authority.command, "flow.run.start");
  assert.equal(loaded.actions[0].authority.endpoint, "kontour-local-action");
  assert.equal(loaded.actions[0].warnings.some((warning: any) => warning.message.includes("authority.command is an inert descriptor only")), true);
  assert.equal(loaded.actions[0].warnings.some((warning: any) => warning.message.includes("authority.endpoint is an inert descriptor only")), true);
});

test("composite results preserve per-sink failures and sibling successes", async () => {
  const event = validEvent();
  const memory = new InMemorySink({ sinkId: "memory-after-failure" });
  const failingSink = {
    sinkId: "failing-test-sink",
    sinkRole: "test-double",
    deliver() {
      throw new Error("simulated sink failure with internal detail");
    }
  };

  const result = await new CompositeSink([failingSink, memory]).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.equal(result.status, "partial");
  assert.equal(result.recordId, event.id);
  assert.equal(result.recordKind, "event");
  assert.equal(result.children.length, 2);

  const failure = result.children[0];
  assert.equal(failure.sinkId, "failing-test-sink");
  assert.equal(failure.sinkRole, "test-double");
  assert.equal(failure.outcome, "failed");
  assert.equal(failure.status, "failed");
  assert.equal(failure.recordId, event.id);
  assert.equal(failure.recordKind, "event");
  assert.equal(failure.errorCode, "SINK_DELIVERY_FAILED");
  assert.equal(failure.safeMessage, "sink delivery failed");
  assert.match(failure.observedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal(result.children[1].outcome, "accepted");
  assert.equal(memory.records[0].id, event.id);
});

test("composite waits for asynchronous child sink failures", async () => {
  const event = validEvent();
  const memory = new InMemorySink({ sinkId: "memory-after-async-failure" });
  const asyncFailingSink = {
    sinkId: "async-failing-sink",
    sinkRole: "test-double",
    async deliver() {
      throw new Error("token=secret internal detail");
    }
  };

  const result = await new CompositeSink([asyncFailingSink, memory]).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.equal(result.status, "partial");
  assert.equal(result.children[0].sinkId, "async-failing-sink");
  assert.equal(result.children[0].outcome, "failed");
  assert.equal(result.children[0].safeMessage, "sink delivery failed");
  assert.equal(result.children[1].outcome, "accepted");
  assert.equal(memory.records[0].id, event.id);
});

test("composite normalizes child outcomes to the delivery vocabulary", async () => {
  const event = validEvent();
  const unsupportedOutcomeSink = {
    sinkId: "legacy-outcome",
    sinkRole: "test-double",
    deliver() {
      return {
        sinkId: "legacy-outcome",
        sinkRole: "test-double",
        outcome: "ok",
        recordId: event.id,
        recordKind: "event"
      };
    }
  };
  const skippedSink = {
    sinkId: "skipped-sink",
    sinkRole: "test-double",
    deliver() {
      return {
        sinkId: "skipped-sink",
        sinkRole: "test-double",
        status: "skipped",
        recordId: event.id,
        recordKind: "event"
      };
    }
  };

  const result = await new CompositeSink([unsupportedOutcomeSink, skippedSink]).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.equal(result.status, "partial");
  assert.equal(result.children[0].outcome, "failed");
  assert.equal(result.children[1].outcome, "skipped");
});

test("composite normalizes nested child results and propagates nested failures", async () => {
  const event = validEvent();
  const nestedCompositeLikeSink = {
    sinkId: "nested-composite",
    sinkRole: "CompositeSink",
    deliver() {
      return {
        sinkId: "nested-composite",
        sinkRole: "CompositeSink",
        outcome: "ok",
        recordId: event.id,
        recordKind: "event",
        children: [
          {
            sinkId: "nested-child",
            sinkRole: "test-double",
            outcome: "ok",
            recordId: event.id,
            recordKind: "event"
          },
          {
            sinkId: "nested-failure",
            sinkRole: "test-double",
            outcome: "failed",
            recordId: event.id,
            recordKind: "event"
          }
        ]
      };
    }
  };

  const result = await new CompositeSink([nestedCompositeLikeSink]).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.equal(result.status, "partial");
  assert.equal(result.children[0].outcome, "failed");
  assert.equal(result.children[0].status, "partial");
  assert.equal(result.children[0].children[0].outcome, "failed");
  assert.equal(result.children[0].children[1].outcome, "failed");
});

test("projection record identity is stable across generatedAt changes", () => {
  const first = validProjection({ generatedAt: "2026-06-01T16:00:00Z" });
  const second = validProjection({ generatedAt: "2026-06-01T16:05:00Z" });

  assert.equal(classifyRecord(first).recordId, classifyRecord(second).recordId);
});

// #188: a repo-scoped event's natural id is "owner/repo" (a slash). The slash
// must not be rejected — the record keeps its natural id and the derived
// filename percent-encodes the separator into a single safe token.
test("local sink accepts a repo scope id with a slash, encoding it into a safe filename", () => {
  const root = tempRoot();
  const event = validEvent({
    id: "event-repo-scoped",
    scope: { product: "surface", kind: "repo", id: "kontourai/console", label: "Console" }
  });

  const result = new LocalFileSink({ root }).deliver(event);

  assert.equal(result.outcome, "accepted");
  // The slash is encoded (%2F) so the filename is a single flat, contained token.
  assert.equal(result.destination, path.join("events", event.producer.id, "repo-kontourai%2Fconsole.jsonl"));
  const written = path.join(root, result.destination);
  assert.equal(fs.existsSync(written), true);
  // The record CONTENT keeps the natural, un-encoded repo id — only the filename
  // is encoded.
  const persisted = JSON.parse(fs.readFileSync(written, "utf8").trim());
  assert.equal(persisted.scope.id, "kontourai/console");
});

// The encoding must stay injective: "%" in an id is itself encoded so it can
// never collide with the encoding of a separator.
test("local sink encodes a literal percent so it cannot collide with an encoded slash", () => {
  const root = tempRoot();
  const slashed = new LocalFileSink({ root }).deliver(validEvent({ id: "e-slash", scope: { product: "surface", kind: "repo", id: "a/b" } }));
  const literalPercent = new LocalFileSink({ root }).deliver(validEvent({ id: "e-pct", scope: { product: "surface", kind: "repo", id: "a%2Fb" } }));

  assert.equal(slashed.destination, path.join("events", "surface-producer", "repo-a%2Fb.jsonl"));
  assert.equal(literalPercent.destination, path.join("events", "surface-producer", "repo-a%252Fb.jsonl"));
  assert.notEqual(slashed.destination, literalPercent.destination);
});

// The traversal guard is unchanged for genuinely unsafe tokens: ".." and
// absolute paths in scope.id are still rejected outright, not encoded.
test("local sink still rejects a scope id containing .. traversal", () => {
  const root = tempRoot();
  const event = validEvent({ scope: { product: "surface", kind: "repo", id: "../../etc/passwd" } });

  const result = new LocalFileSink({ root }).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.match(result.safeMessage, /scope\.id/);
  assert.equal(fs.existsSync(path.join(path.dirname(root), "etc")), false);
});

test("local sink rejects unsafe path tokens without escaping the kontour root", () => {
  const root = tempRoot();
  const event = validEvent({
    producer: { product: "surface", id: "../escape" }
  });

  const result = new LocalFileSink({ root }).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.equal(result.recordId, event.id);
  assert.equal(result.recordKind, "event");
  assert.equal(result.errorCode, "SINK_DELIVERY_FAILED");
  assert.match(result.safeMessage, /producer\.id/);
  assert.equal(fs.existsSync(path.join(path.dirname(root), "escape")), false);
});

test("local sink rejects symlink destination escapes", { skip: process.platform === "win32" }, () => {
  const root = tempRoot();
  const outside = tempRoot();
  const event = validEvent();
  const producerDir = path.join(root, "events", event.producer.id);
  fs.mkdirSync(path.dirname(producerDir), { recursive: true });
  fs.symlinkSync(outside, producerDir, "dir");

  const result = new LocalFileSink({ root }).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.equal(result.recordId, event.id);
  assert.equal(result.recordKind, "event");
  assert.match(result.safeMessage, /symbolic links/);
  assert.equal(fs.existsSync(path.join(outside, `${event.scope.kind}-${event.scope.id}.jsonl`)), false);
});

test("local sink rejects symlink intermediate directories before creating outside paths", { skip: process.platform === "win32" }, () => {
  const root = tempRoot();
  const outside = tempRoot();
  const event = validEvent();
  fs.symlinkSync(outside, path.join(root, "events"), "dir");

  const result = new LocalFileSink({ root }).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.match(result.safeMessage, /symbolic links/);
  assert.equal(fs.existsSync(path.join(outside, event.producer.id)), false);
});

test("local sink rejects symlink kontour root", { skip: process.platform === "win32" }, () => {
  const parent = tempRoot();
  const outside = tempRoot();
  const root = path.join(parent, ".kontourai", "console");
  const event = validEvent();
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.symlinkSync(outside, root, "dir");

  const result = new LocalFileSink({ root }).deliver(event);

  assert.equal(result.outcome, "failed");
  assert.match(result.safeMessage, /symbolic link/);
  assert.equal(fs.existsSync(path.join(outside, "events")), false);
});

test("local discovery skips symlink escapes", { skip: process.platform === "win32" }, () => {
  const rootDir = tempRoot();
  const kontourRoot = path.join(rootDir, ".kontourai", "console");
  const outside = tempRoot();
  const event = validEvent({ id: "event-outside-symlink" });
  fs.mkdirSync(path.join(kontourRoot, "events"), { recursive: true });
  new LocalFileSink({ root: outside }).deliver(event);
  fs.symlinkSync(path.join(outside, "events"), path.join(kontourRoot, "events", "escaped"), "dir");

  const report = inspectLocalKontour({ rootDir });

  assert.equal(report.eventStreams.length, 0);
  assert.equal(report.validation.errors.length, 0);
});

test("local discovery rejects symlink kontour root", { skip: process.platform === "win32" }, () => {
  const rootDir = tempRoot();
  const outside = tempRoot();
  const event = validEvent({ id: "event-outside-root-symlink" });
  new LocalFileSink({ root: outside }).deliver(event);
  fs.mkdirSync(path.join(rootDir, ".kontourai"));
  fs.symlinkSync(outside, path.join(rootDir, ".kontourai", "console"), "dir");

  const report = inspectLocalKontour({ rootDir });

  assert.equal(report.eventStreams.length, 0);
  assert.equal(report.projections.length, 0);
  assert.equal(report.validation.errors.length, 0);
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "console-"));
}

function validEvent(overrides: any = {}) {
  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: "event-provider-directory-updated",
    type: "claim.updated",
    occurredAt: "2026-06-01T16:00:00Z",
    producer: { product: "surface", id: "surface-producer", ...(overrides.producer || {}) },
    scope: { product: "surface", kind: "tenant", id: "acme", ...(overrides.scope || {}) },
    subject: { product: "surface", kind: "claim", id: "claim-provider-directory-current" },
    payload: {
      refs: [{ product: "surface", kind: "claim", id: "claim-provider-directory-current" }],
      status: "verified"
    },
    links: [],
    ...without(overrides, ["producer", "scope"])
  };
}

function validProjection(overrides: any = {}) {
  return {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: overrides.generatedAt || "2026-06-01T16:00:00Z",
    derivedFrom: {
      eventStream: {
        product: "surface",
        kind: "event_stream",
        id: "surface-tenant-acme"
      }
    },
    producer: { product: "surface", id: "surface-producer" },
    scope: { product: "surface", kind: "tenant", id: "acme" },
    claims: [
      {
        id: "claim-provider-directory-current",
        status: "verified",
        evidenceRefs: [{ product: "surface", kind: "evidence", id: "evidence-provider-directory" }],
        actionRefs: [{ product: "flow", kind: "action", id: "action-refresh-provider-directory" }],
        sourceRef: { product: "surface", kind: "claim", id: "claim-provider-directory-current" }
      }
    ],
    actions: [
      {
        id: "action-refresh-provider-directory",
        label: "Refresh provider directory",
        kind: "flow.run",
        status: "available",
        authority: {
          product: "flow",
          command: "flow.run.start",
          endpoint: "kontour-local-action"
        },
        subjectRefs: [{ product: "surface", kind: "claim", id: "claim-provider-directory-current" }]
      }
    ],
    links: [],
    ...without(overrides, ["generatedAt"])
  };
}

function without(source: any, keys: any) {
  const copy = { ...source };
  keys.forEach((key: any) => delete copy[key]);
  return copy;
}

// #71: the producer integration surface (sinks + emitter + helpers) must be
// re-exported from the console-foundation index — an index consumer previously
// got no emitter at all, and the compiled emitter.d.ts was an empty `export {}`
// (the types half is enforced by the build/typecheck; this guards the runtime
// re-export list from silently regressing).
test("console-foundation index re-exports the full producer surface", () => {
  const foundation = require("../src/console-foundation");
  for (const name of ["KontourEmitter", "LocalFileSink", "CompositeSink", "InMemorySink", "ApiSink", "classifyRecord", "formatDeliveryResult", "createConsoleHubServer"]) {
    assert.equal(typeof foundation[name], "function", `expected console-foundation to export ${name}`);
  }
  // The re-exported classes must be the real constructors, not undefined shims.
  const sink = new foundation.LocalFileSink({ root: tempRoot() });
  assert.equal(sink.sinkRole, "LocalFileSink");
});

// #228 review finding 1: the inspection/validation functions (defined directly
// in index.ts) and the surface/flow mapping helpers (re-exported from their own
// sibling modules) must ALSO carry real declarations, not just a runtime
// `module.exports` entry — a published-library TypeScript consumer imports
// these by name (README "Local Console Producer Emission" / "Surface Claim
// Status/Freshness Producer Helper"). This guards the runtime half; the packed
// tarball's isolated tsc check (cli/scripts/test-tarball.ts) guards the types
// half against the same class of regression.
test("console-foundation index re-exports the inspection and mapping helpers", () => {
  const foundation = require("../src/console-foundation");
  for (const name of [
    "validateEvent",
    "validateProjection",
    "extractActionDescriptors",
    "inspectLocalKontour",
    "surfaceClaimStateToProjection",
    "surfaceFreshnessTransitionToEvent",
    "flowProcessStateToProjection",
    "flowGateTransitionToEvent",
  ]) {
    assert.equal(typeof foundation[name], "function", `expected console-foundation to export ${name}`);
  }
});
