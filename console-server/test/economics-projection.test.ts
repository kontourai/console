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

// ── #415 delegation efficiency ────────────────────────────────────────────────
// Honesty rules under test:
//   1. Cost is a MODEL-GRANULARITY PROXY joined from cost.by_model by bare model.
//   2. `unavailable` outcomes are EXCLUDED from acceptanceRate's denominator and
//      reported as coverage — never folded into success/failure.
//   3. Records with per_delegation_outcome none/n/a report unavailable coverage and
//      a null acceptanceRate, never a misleading 0%.
const DEFAULT_SIGNALS = { runtime: "claude-code", per_delegation_tokens: false, per_delegation_outcome: "partial" };

test("#415 delegations: groups per (role, model); model is the BARE name (@provider stripped)", () => {
  const rec = baseRecord({
    run_id: "d-1",
    cost: { estimated_cost_usd: 0.9, by_model: [{ model: "claude-opus-4-8", estimated_cost_usd: 0.7 }] },
    signals: DEFAULT_SIGNALS,
    delegations: [
      { agent_id: "w1", role: "delegate-design", resolved_model: "claude-opus-4-8@anthropic", outcome: "accepted" },
      { agent_id: "w2", role: "delegate-design", resolved_model: "claude-opus-4-8@anthropic", outcome: "rework" }
    ]
  });
  const del = project([rec]).materializeDelegations("t");
  assert.equal(del.runCount, 1);
  assert.equal(del.perRoleModel.length, 1);
  const g = del.perRoleModel[0];
  assert.equal(g.role, "delegate-design");
  assert.equal(g.model, "claude-opus-4-8"); // BARE — @anthropic stripped
  assert.equal(g.delegations, 2);
  assert.equal(g.acceptedCount, 1);
  assert.equal(g.reworkCount, 1);
});

test("#415 delegations: acceptanceRate EXCLUDES `unavailable` from the denominator", () => {
  const rec = baseRecord({
    run_id: "d-2",
    signals: DEFAULT_SIGNALS,
    delegations: [
      { role: "delegate-impl", resolved_model: "m@anthropic", outcome: "accepted" },
      { role: "delegate-impl", resolved_model: "m@anthropic", outcome: "failed" },
      { role: "delegate-impl", resolved_model: "m@anthropic", outcome: "unavailable" },
      { role: "delegate-impl", resolved_model: "m@anthropic", outcome: "unavailable" }
    ]
  });
  const g = project([rec]).materializeDelegations("t").perRoleModel[0];
  // denominator = accepted+rework+diverged+failed = 1+0+0+1 = 2 (the 2 unavailable excluded).
  assert.equal(g.acceptedCount, 1);
  assert.equal(g.failedCount, 1);
  assert.equal(g.unavailableCount, 2);
  assert.equal(g.acceptanceRate, 0.5); // 1/2, NOT 1/4
});

test("#415 delegations: `unavailable` is NEITHER accepted NOR failed (coverage counts it separately)", () => {
  const rec = baseRecord({
    run_id: "d-3",
    signals: DEFAULT_SIGNALS,
    delegations: [
      { role: "r", resolved_model: "m@anthropic", outcome: "accepted" },
      { role: "r", resolved_model: "m@anthropic", outcome: "unavailable" }
    ]
  });
  const del = project([rec]).materializeDelegations("t");
  assert.equal(del.coverage.measurable, 1);
  assert.equal(del.coverage.unavailable, 1);
  const g = del.perRoleModel[0];
  assert.equal(g.acceptedCount, 1);
  assert.equal(g.failedCount, 0);
  assert.equal(g.unavailableCount, 1);
});

test("#415 delegations: PROXY cost joins cost.by_model at MODEL granularity; null when model absent", () => {
  const rec = baseRecord({
    run_id: "d-4",
    cost: { estimated_cost_usd: 1.0, by_model: [
      { model: "claude-opus-4-8", estimated_cost_usd: 0.8 },
      { model: "claude-fable-5", estimated_cost_usd: 0.2 }
    ] },
    signals: DEFAULT_SIGNALS,
    delegations: [
      { role: "design", resolved_model: "claude-opus-4-8@anthropic", outcome: "accepted" },
      { role: "impl", resolved_model: "claude-sonnet-9@anthropic", outcome: "accepted" } // NOT in by_model
    ]
  });
  const del = project([rec]).materializeDelegations("t");
  const byRole = new Map<string, any>(del.perRoleModel.map((g: any) => [g.role, g]));
  assert.equal(byRole.get("design").costUsd, 0.8); // joined from by_model
  assert.equal(byRole.get("design").costGranularity, "model-proxy");
  assert.equal(byRole.get("impl").costUsd, null); // model not in by_model → null, not a fake 0
});

test("#415 delegations: a model shared by two roles attributes the model cost to EACH group (proxy imprecision)", () => {
  const rec = baseRecord({
    run_id: "d-5",
    cost: { estimated_cost_usd: 0.5, by_model: [{ model: "shared-m", estimated_cost_usd: 0.5 }] },
    signals: DEFAULT_SIGNALS,
    delegations: [
      { role: "design", resolved_model: "shared-m@anthropic", outcome: "accepted" },
      { role: "impl", resolved_model: "shared-m@anthropic", outcome: "accepted" }
    ]
  });
  const del = project([rec]).materializeDelegations("t");
  // The shared model's cost is NOT split — attributed whole to each (role, model) group.
  for (const g of del.perRoleModel) assert.equal(g.costUsd, 0.5);
});

test("#415 delegations: a no-measurable-outcome tenant reports coverage.unavailable + null acceptanceRate (NOT 0)", () => {
  const rec = baseRecord({
    run_id: "d-6",
    signals: { runtime: "claude-code", per_delegation_tokens: false, per_delegation_outcome: "none" },
    delegations: [
      { role: "r", resolved_model: "m@anthropic", outcome: "unavailable" },
      { role: "r", resolved_model: "m@anthropic", outcome: "unavailable" }
    ]
  });
  const del = project([rec]).materializeDelegations("t");
  assert.equal(del.coverage.measurable, 0);
  assert.equal(del.coverage.unavailable, 2);
  assert.equal(del.perRoleModel[0].acceptanceRate, null); // NOT 0% — nothing was measurable
  assert.equal(del.signals.perDelegationOutcome, "none");
  assert.equal(del.signals.perDelegationTokens, false);
});

test("#415 delegations: signals aggregate across records; disagreement → `mixed`; tokens AND is false today", () => {
  const records = [
    baseRecord({ run_id: "s-1", signals: { per_delegation_tokens: false, per_delegation_outcome: "full" }, delegations: [{ role: "r", resolved_model: "m@a", outcome: "accepted" }] }),
    baseRecord({ run_id: "s-2", signals: { per_delegation_tokens: false, per_delegation_outcome: "partial" }, delegations: [{ role: "r", resolved_model: "m@a", outcome: "rework" }] })
  ];
  const del = project(records).materializeDelegations("t");
  assert.equal(del.signals.perDelegationOutcome, "mixed"); // full + partial disagree
  assert.equal(del.signals.perDelegationTokens, false);
});

test("#415 delegations: records with [] delegations don't count as delegation runs; empty projection is zero-state", () => {
  const records = [
    baseRecord({ run_id: "e-1", signals: DEFAULT_SIGNALS, delegations: [] }),
    baseRecord({ run_id: "e-2", signals: DEFAULT_SIGNALS, delegations: [{ role: "r", resolved_model: "m@a", outcome: "accepted" }] })
  ];
  const del = project(records).materializeDelegations("t");
  assert.equal(del.runCount, 1); // only e-2 carried delegations
  const empty = createEconomicsProjection().materializeDelegations("t");
  assert.equal(empty.runCount, 0);
  assert.deepEqual(empty.perRoleModel, []);
  assert.deepEqual(empty.coverage, { measurable: 0, unavailable: 0 });
  assert.equal(empty.signals.perDelegationOutcome, "n/a");
});
