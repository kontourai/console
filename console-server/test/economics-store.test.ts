// Economics ingest + store tests (console #117, flow-agents #349, ADR 0003 calls 1/2/3).
//
// AC1 (R1): a valid #349-shape economics record POSTed to /records is queryable
//   via GET /api/economics; a cost-only record (cost but NO defects block) is
//   rejected 400 INVALID_RECORD with a diagnostic — the R7 Goodhart guard at the
//   schema boundary (cost + defects are CO-REQUIRED).
// AC6 (R6): a second tenant's records are not visible in the first tenant's
//   GET /api/economics (tested at the query/projection layer).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createConsoleHubServer,
  createEconomicsStore,
  createEconomicsProjection,
  validateEconomicsRecordBody
} = require("../src/console-foundation");

const VALID = loadFixture("valid-record.json");
const COST_ONLY = loadFixture("cost-only-record.json");

test("valid economics record POSTed to /records is queryable via GET /api/economics", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0 });
  await listen(app);
  try {
    const base = serverUrl(app);
    const accept = await requestJson("POST", `${base}/records`, VALID);
    assert.equal(accept.statusCode, 202);
    assert.equal(accept.body.recordKind, "economics");
    assert.equal(accept.body.recordId, "kontourai-flow-agents-349-run-01");

    const rollup = await requestJson("GET", `${base}/api/economics`);
    assert.equal(rollup.statusCode, 200);
    assert.equal(rollup.body.runCount, 1);
    assert.equal(rollup.body.cost.length, 1);
    assert.equal(rollup.body.cost[0].taskSlug, "kontourai-flow-agents-349");
    assert.equal(rollup.body.cost[0].day, "2025-07-05"); // 1751731200000 ms → 2025-07-05 UTC
    assert.equal(rollup.body.cost[0].totalCostUsd, 0.31);
    // R5: defect counts on the SAME row as cost — never a cost-only view.
    // findings_by_severity totals: 1+2+1+2 = 6.
    assert.equal(rollup.body.cost[0].defectsCaught, 6);
    assert.equal(rollup.body.caughtDefects.caughtFalseCompletions, 1);
    // Per-phase attribution from the top-level phases[] (a single "verify" entry).
    assert.deepEqual(rollup.body.cost[0].costByPhase, { verify: 0.31 });
  } finally {
    await close(app);
  }
});

test("#415 delegations route: a record with delegations is queryable via GET /api/economics/delegations (proxy cost + honest coverage)", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0 });
  await listen(app);
  try {
    const base = serverUrl(app);
    // The base fixture carries cost.by_model for claude-opus-4-8 (0.305). Attach a
    // delegations block + signals (additionalProperties pass through ingest).
    const withDelegations = {
      ...VALID,
      run_id: "kontourai-flow-agents-415-run-01",
      signals: { runtime: "claude-code", per_delegation_tokens: false, per_delegation_outcome: "partial" },
      delegations: [
        { agent_id: "w1", role: "delegate-design", resolved_model: "claude-opus-4-8@anthropic", outcome: "accepted" },
        { agent_id: "w2", role: "delegate-design", resolved_model: "claude-opus-4-8@anthropic", outcome: "rework" },
        { agent_id: "w3", role: "delegate-impl", resolved_model: "claude-opus-4-8@anthropic", outcome: "unavailable" }
      ]
    };
    const accept = await requestJson("POST", `${base}/records`, withDelegations);
    assert.equal(accept.statusCode, 202);

    const del = await requestJson("GET", `${base}/api/economics/delegations`);
    assert.equal(del.statusCode, 200);
    assert.equal(del.body.runCount, 1);
    // coverage: 2 measurable (accepted+rework), 1 unavailable — never folded together.
    assert.deepEqual(del.body.coverage, { measurable: 2, unavailable: 1 });
    // signals surfaced for the honesty labels.
    assert.equal(del.body.signals.perDelegationTokens, false);
    assert.equal(del.body.signals.perDelegationOutcome, "partial");
    const design = del.body.perRoleModel.find((g: any) => g.role === "delegate-design");
    assert.equal(design.model, "claude-opus-4-8"); // bare
    assert.equal(design.acceptanceRate, 0.5);      // 1 accepted / (1 accepted + 1 rework)
    assert.equal(design.costUsd, 0.305);           // PROXY from cost.by_model
    assert.equal(design.costGranularity, "model-proxy");
    const impl = del.body.perRoleModel.find((g: any) => g.role === "delegate-impl");
    assert.equal(impl.acceptanceRate, null);        // only an unavailable → null, NOT 0
    assert.equal(impl.unavailableCount, 1);
  } finally {
    await close(app);
  }
});

test("R7 Goodhart invariant: a cost-only record (no defects) is rejected 400 INVALID_RECORD with a diagnostic", async () => {
  const app = createConsoleHubServer({ rootDir: tempRoot(), port: 0 });
  await listen(app);
  try {
    const base = serverUrl(app);
    const rejected = await requestJson("POST", `${base}/records`, COST_ONLY);
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.body.error, "INVALID_RECORD");
    assert.ok(Array.isArray(rejected.body.validation) && rejected.body.validation.length > 0, "carries a diagnostic");
    const paths = rejected.body.validation.map((v: any) => v.path);
    assert.ok(paths.includes("economics.defects"), "flags the missing defects block");

    // And it did not land in the store.
    const rollup = await requestJson("GET", `${base}/api/economics`);
    assert.equal(rollup.body.runCount, 0);
  } finally {
    await close(app);
  }
});

test("validateEconomicsRecordBody accepts a valid #349 record and rejects cost-without-defects", () => {
  assert.doesNotThrow(() => validateEconomicsRecordBody(VALID));
  assert.throws(() => validateEconomicsRecordBody(COST_ONLY), (err: any) =>
    err.code === "INVALID_RECORD" && Array.isArray(err.validation) &&
    err.validation.some((v: any) => v.path === "economics.defects"));
});

test("validateEconomicsRecordBody rejects missing required nested fields + bad verdict enum", () => {
  const flags = (expectedPath: string) => (err: any) =>
    err.code === "INVALID_RECORD" && Array.isArray(err.validation) &&
    err.validation.some((v: any) => v.path === expectedPath);
  const { run_id, ...noRunId } = VALID;
  assert.throws(() => validateEconomicsRecordBody(noRunId), flags("economics.run_id"));
  const { time, ...noTime } = VALID;
  assert.throws(() => validateEconomicsRecordBody(noTime), flags("economics.time"));
  const { iterations, ...noIter } = VALID;
  assert.throws(() => validateEconomicsRecordBody(noIter), flags("economics.iterations"));
  assert.throws(() => validateEconomicsRecordBody({ ...VALID, defects: { ...VALID.defects, verification_verdict: "MAYBE" } }),
    flags("economics.defects.verification_verdict"));
  assert.throws(() => validateEconomicsRecordBody({ ...VALID, defects: { ...VALID.defects, findings_by_severity: { critical: 0 } } }),
    flags("economics.defects.findings_by_severity.high"));
});

test("optional #350 tags are validated for enum-correctness only when present", () => {
  // Absent tags → valid.
  assert.doesNotThrow(() => validateEconomicsRecordBody(VALID));
  // Present-but-valid tags → valid.
  assert.doesNotThrow(() => validateEconomicsRecordBody({ ...VALID, model_tier: "small", kit_condition: "+kit", acceptance_label: "accepted" }));
  // Present-but-bad tags → rejected.
  const flags = (expectedPath: string) => (err: any) =>
    err.code === "INVALID_RECORD" && err.validation.some((v: any) => v.path === expectedPath);
  assert.throws(() => validateEconomicsRecordBody({ ...VALID, model_tier: "medium" }), flags("economics.model_tier"));
  assert.throws(() => validateEconomicsRecordBody({ ...VALID, kit_condition: "kit" }), flags("economics.kit_condition"));
  assert.throws(() => validateEconomicsRecordBody({ ...VALID, acceptance_label: "maybe" }), flags("economics.acceptance_label"));
});

test("AC6 tenant isolation: a second tenant's records are not visible at the query layer", () => {
  // Two independent per-tenant projections (exactly how the server keys them by
  // tenantId). Records for tenant B never surface in tenant A's materialize().
  const projA = createEconomicsProjection();
  const projB = createEconomicsProjection();
  projA.apply({ ...VALID, run_id: "a-1" });
  projB.apply({ ...VALID, run_id: "b-1" });
  projB.apply({ ...VALID, run_id: "b-2" });

  assert.equal(projA.materialize("tenant-a").runCount, 1);
  assert.equal(projB.materialize("tenant-b").runCount, 2);
  assert.equal(projA.materialize("tenant-a").tenantId, "tenant-a");
});

test("store dedups on run_id (via projection) and reports count", () => {
  const store = createEconomicsStore();
  store.append({ ...VALID });
  store.append({ ...VALID });
  // The store itself is an append log; dedup lives in the projection (mirrors
  // the operating-state projection's seen-set). Confirm the projection dedups.
  const proj = createEconomicsProjection();
  proj.apply({ ...VALID });
  proj.apply({ ...VALID });
  assert.equal(proj.count(), 1);
  assert.equal(store.count(), 2);
});

// ── helpers (mirror console-hub-server.test.ts) ────────────────────────────────
function loadFixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "economics", name), "utf8"));
}
function listen(app: any) {
  return new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
}
function close(app: any) {
  return new Promise((resolve: any, reject: any) => app.close((e: any) => (e ? reject(e) : resolve())));
}
function serverUrl(app: any) {
  const a = app.server.address();
  return `http://${a.address}:${a.port}`;
}
function requestJson(method: any, url: any, payload?: any): Promise<{ statusCode?: number; body: any }> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve: any, reject: any) => {
    const request = http.request(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
    }, (response: any) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (c: any) => { raw += c; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(raw || "{}") }));
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}
function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "console-economics-"));
}
