// Economics projection tests (console #117, flow-agents #349, ADR 0003 calls 3 + 4).
//
// Records are the AUTHORITATIVE #349 shape (snake_case, nested). The value tags
// (model_tier / kit_condition / acceptance_label) are OPTIONAL #350 extensions.
//
// AC7 (value): over a {small,large}×{bare,+kit} tagged fixture matrix,
//   materializeValue() returns four cells + a headline comparing small+kit to
//   large-bare, with correct dollarsPerAcceptable and verdict. acceptance_label
//   comes from the fixture's oracle field — never re-derived from kit gates.
// AC2 (cost): a record without phases[] renders an `unattributed` bucket, not zeros.
// AC4 (funnel): a route-back run renders iterations + first-pass rate correctly.
// SPLIT: cost/defects/funnel rollups run over ALL records; the value matrix groups
//   ONLY over records carrying the optional tags.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createEconomicsProjection } = require("../src/console-foundation");

const MATRIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "economics", "value-matrix.json"), "utf8")).records;

// A minimal full #349 base record (no optional tags), for rollup-only assertions.
function baseRecord(overrides: any = {}): any {
  return {
    schema: "kontour.console.economics", version: "0.1", run_id: `r-${Math.random()}`, at: "1751706000000", task_slug: "t",
    cost: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, estimated_cost_usd: 0.1, by_model: [] },
    time: { wall_clock_s: 10, human_wait_s: 0 },
    iterations: { count: 1, route_backs: 0 },
    defects: { gate_fires: 0, findings_by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, caught_false_completions: 0, verification_verdict: "PASS" },
    ...overrides
  };
}

function project(records: any[]) {
  const proj = createEconomicsProjection();
  for (const r of records) proj.apply(r);
  return proj;
}

test("AC7 value comparison: four cells grouped by (model_tier, kit_condition)", () => {
  const value = project(MATRIX).materializeValue("tenant-a");
  assert.equal(value.cells.length, 4);
  assert.equal(value.taggedRunCount, 8);
  const key = (c: any) => `${c.model_tier} ${c.kit_condition}`;
  assert.deepEqual(value.cells.map(key).sort(), ["large +kit", "large bare", "small +kit", "small bare"]);
});

test("AC7 headline: small+kit vs large-bare with correct dollarsPerAcceptable + verdict", () => {
  const { headline } = project(MATRIX).materializeValue("tenant-a");
  assert.ok(headline.smallPlusKit && headline.largeBare);

  // small+kit: 2 runs, both accepted → $/acceptable = (0.20+0.60)/2 = 0.40.
  assert.equal(headline.smallPlusKit.runs, 2);
  assert.equal(headline.smallPlusKit.acceptanceRate, 1);
  assert.equal(headline.smallPlusKit.iterationsToAccept, 2); // (1+3)/2
  assert.equal(headline.smallPlusKit.defectsCaught, 6);      // 2 + (1+1+1+1)
  assert.equal(headline.smallPlusKit.dollarsPerAcceptable, 0.4);

  // large-bare: 2 runs, 1 accepted (lb-1) → $/acceptable = (1.60+1.20)/1 = 2.80.
  assert.equal(headline.largeBare.runs, 2);
  assert.equal(headline.largeBare.acceptanceRate, 0.5);
  assert.equal(headline.largeBare.iterationsToAccept, 2);    // 2/1
  assert.equal(headline.largeBare.defectsCaught, 1);
  assert.equal(headline.largeBare.dollarsPerAcceptable, 2.8);

  // ratio = largeBare$/acceptable ÷ smallPlusKit$/acceptable = 2.80/0.40 = 7.
  assert.equal(headline.ratio, 7);
  // small+kit is far cheaper per acceptable outcome → the claim is exceeded.
  assert.equal(headline.verdict, "exceeds");
});

test("SPLIT: base (untagged) records show in cost/defects/funnel but NOT the value matrix", () => {
  // Two base #349 records with no experiment tags + one tagged record.
  const records = [
    baseRecord({ run_id: "base-1", cost: { estimated_cost_usd: 0.5 } }),
    baseRecord({ run_id: "base-2", cost: { estimated_cost_usd: 0.5 } }),
    baseRecord({ run_id: "tagged-1", model_tier: "small", kit_condition: "+kit", acceptance_label: "accepted" })
  ];
  const proj = project(records);
  // Rollups count ALL three.
  assert.equal(proj.materialize("t").runCount, 3);
  // Value matrix counts ONLY the tagged one.
  const value = proj.materializeValue("t");
  assert.equal(value.taggedRunCount, 1);
  assert.equal(value.cells.length, 1);
  assert.equal(value.cells[0].model_tier, "small");
});

test("value: with NO tagged records, the value card is empty (needs harness runs)", () => {
  const value = project([baseRecord(), baseRecord()]).materializeValue("t");
  assert.equal(value.taggedRunCount, 0);
  assert.deepEqual(value.cells, []);
  assert.equal(value.headline.smallPlusKit, null);
  assert.equal(value.headline.verdict, "unknown");
  assert.equal(value.headline.ratio, null);
});

test("value: dollarsPerAcceptable is null (not a fake 0) when a cell has no acceptances", () => {
  const rejectedOnly = [baseRecord({ model_tier: "small", kit_condition: "bare", acceptance_label: "rejected", cost: { estimated_cost_usd: 0.5 } })];
  const value = project(rejectedOnly).materializeValue("t");
  assert.equal(value.cells[0].dollarsPerAcceptable, null);
  assert.equal(value.cells[0].acceptanceRate, 0);
  assert.equal(value.headline.verdict, "unknown");
});

test("value NEVER re-derives acceptance: flipping only the oracle label flips the cell", () => {
  // Identical cost/iterations/defects; only acceptance_label differs.
  const accepted = [baseRecord({ model_tier: "small", kit_condition: "+kit", acceptance_label: "accepted", cost: { estimated_cost_usd: 1 } })];
  const rejected = [baseRecord({ model_tier: "small", kit_condition: "+kit", acceptance_label: "rejected", cost: { estimated_cost_usd: 1 } })];
  assert.equal(project(accepted).materializeValue("t").cells[0].acceptanceRate, 1);
  assert.equal(project(rejected).materializeValue("t").cells[0].acceptanceRate, 0);
});

test("AC2 cost: a record without phases[] renders an `unattributed` bucket, not zeros", () => {
  const noPhase = [baseRecord({ run_id: "np", task_slug: "knowledge", at: "1751792400000", cost: { estimated_cost_usd: 0.75 }, phases: undefined })];
  const rollup = project(noPhase).materialize("t");
  assert.equal(rollup.cost[0].costByPhase.unattributed, 0.75);
  assert.equal(Object.keys(rollup.cost[0].costByPhase).length, 1);
});

test("AC2 cost: per-phase attribution from the top-level phases[]", () => {
  const withPhases = [baseRecord({
    run_id: "wp", cost: { estimated_cost_usd: 0.42 },
    phases: [
      { phase: "plan", estimated_cost_usd: 0.1 },
      { phase: "execute", estimated_cost_usd: 0.22 },
      { phase: "review", estimated_cost_usd: 0.06 },
      { phase: "verify", estimated_cost_usd: 0.04 }
    ]
  })];
  const rollup = project(withPhases).materialize("t");
  assert.deepEqual(rollup.cost[0].costByPhase, { plan: 0.1, execute: 0.22, review: 0.06, verify: 0.04 });
});

test("AC2 cost: per-task-slug-per-day trend with correct totals across 2 tasks / multiple days", () => {
  const rollup = project([
    baseRecord({ run_id: "a", task_slug: "builder", at: "1751706000000", cost: { estimated_cost_usd: 0.10 }, defects: { gate_fires: 0, findings_by_severity: { critical: 0, high: 1, medium: 0, low: 0 }, caught_false_completions: 0, verification_verdict: "PASS" } }),
    baseRecord({ run_id: "b", task_slug: "builder", at: "1751709600000", cost: { estimated_cost_usd: 0.20 }, defects: { gate_fires: 0, findings_by_severity: { critical: 0, high: 2, medium: 0, low: 0 }, caught_false_completions: 0, verification_verdict: "PASS" } }),
    baseRecord({ run_id: "c", task_slug: "builder", at: "1751792400000", cost: { estimated_cost_usd: 0.30 } }),
    baseRecord({ run_id: "d", task_slug: "knowledge", at: "1751706000000", cost: { estimated_cost_usd: 0.90 }, defects: { gate_fires: 0, findings_by_severity: { critical: 0, high: 0, medium: 0, low: 5 }, caught_false_completions: 0, verification_verdict: "PASS" } })
  ]).materialize("t");
  const byKey = new Map(rollup.cost.map((r: any) => [`${r.taskSlug} ${r.day}`, r]));
  const d1 = byKey.get("builder 2025-07-05") as any; // a + b same day
  assert.equal(d1.totalCostUsd, 0.3);
  assert.equal(d1.runs, 2);
  assert.equal(d1.defectsCaught, 3); // 1 + 2
  assert.equal((byKey.get("builder 2025-07-06") as any).totalCostUsd, 0.3);
  assert.equal((byKey.get("knowledge 2025-07-05") as any).totalCostUsd, 0.9);
});

test("AC3 caught-defects: caught_false_completions + per-severity aggregated distinctly", () => {
  const records = Array.from({ length: 6 }, (_, i) => baseRecord({
    run_id: `cfc-${i}`,
    defects: { gate_fires: 1, findings_by_severity: { critical: 0, high: 1, medium: 0, low: 0 }, caught_false_completions: 1, verification_verdict: "PASS" }
  }));
  const rollup = project(records).materialize("t");
  assert.equal(rollup.caughtDefects.caughtFalseCompletions, 6);
  assert.equal(rollup.caughtDefects.defectsCaught, 6);       // 6 × high:1
  assert.equal(rollup.caughtDefects.bySeverity.high, 6);
  assert.equal(rollup.caughtDefects.gateFires, 6);
});

test("AC4 funnel: route-back run counts iterations + route-backs; first-pass rate is correct", () => {
  const records = [
    // First-pass: 1 iteration, no route-back.
    baseRecord({ run_id: "fp", iterations: { count: 1, route_backs: 0 }, time: { wall_clock_s: 10, human_wait_s: 0 } }),
    // Route-back loop: 3 iterations, 1 route-back, 5s human wait.
    baseRecord({ run_id: "rb", iterations: { count: 3, route_backs: 1 }, time: { wall_clock_s: 10, human_wait_s: 5 } })
  ];
  const { funnel } = project(records).materialize("t");
  assert.equal(funnel.runs, 2);
  assert.equal(funnel.totalIterations, 4);
  assert.equal(funnel.totalRouteBacks, 1);
  assert.equal(funnel.firstPassRate, 0.5); // only the fp run is first-pass
  assert.equal(funnel.humanWaitS, 5);
});

test("empty projection materializes zero-state read-models (empty-state honesty)", () => {
  const rollup = createEconomicsProjection().materialize("t");
  assert.equal(rollup.runCount, 0);
  assert.deepEqual(rollup.cost, []);
  assert.equal(rollup.caughtDefects.defectsCaught, 0);
  assert.equal(rollup.funnel.firstPassRate, 0);
  const value = createEconomicsProjection().materializeValue("t");
  assert.deepEqual(value.cells, []);
  assert.equal(value.taggedRunCount, 0);
  assert.equal(value.headline.smallPlusKit, null);
  assert.equal(value.headline.verdict, "unknown");
});
