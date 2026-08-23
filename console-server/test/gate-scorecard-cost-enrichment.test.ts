/**
 * Layer 2 of console#277: the OPTIONAL per-gate cost enrichment.
 *
 * BOTH HALVES OF THE JOIN ARE PRODUCER-EMITTED, because #278's review history is
 * one long lesson in what a fold proves when only one half is real:
 *
 *  - the TRANSITIONS in test/fixtures/flow-agents-transitions/captured.jsonl are
 *    real `kontour.flow-agents.transition` records, copied verbatim out of a live
 *    `.flow-agents/telemetry/transitions.jsonl` written by flow-agents'
 *    `src/transition-log.ts`. Exactly two values are scrubbed, both
 *    machine-private and neither read by this fold: `cwd_repo` (an absolute
 *    checkout path) and `actor.session_id` (a real session uuid). Every other
 *    byte — including the producer's `«unparsed»` placeholders, its bounded
 *    `error_name`, and the fact that `gate_outcome` appears on 53 of 6,357 records
 *    in the sampled corpus — is the emitter's;
 *  - the FLOW side is `builder-shape.json`, what Flow's own `projectFlowRun`
 *    emits for `builder-shape.flow.json` — which is `kits/builder/flows/shape.flow.json`
 *    copied verbatim out of kontourai/flow-agents. So the expectation ids the
 *    captured transitions name are the ones the real flow really declares.
 *
 * What this suite is defending, in the order it matters:
 *
 *  1. THE JOIN IS ON THE EXPECTATION ID, not a gate id and not a run id — a
 *     transition record carries neither. Fault injection: resolving by gate id
 *     instead reds `EXACT COUNTS` below (every figure collapses to unavailable).
 *  2. NO PRODUCER MEANS "unavailable", NEVER ZERO. Three availability states,
 *     each asserted AS that state, because a gate recorded as costed that had
 *     never received an evidence write is the live defect this whole card exists
 *     to prevent.
 *  3. COST IS A FLOOR. `output_tokens_floor` is null until something attributes,
 *     and the transitions that got no turn are counted beside it rather than
 *     rounded into it.
 *  4. UNATTRIBUTABLE TRANSITIONS ARE SHOWN AND CHANGE NO DENOMINATOR. The
 *     coverage block must partition exactly; layer 1's numbers must be
 *     byte-identical whether or not any transition was folded.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createGateScorecardProjection } = require("../src/console-foundation/gate-scorecard-projection");
const { validateTransitionRecord } = require("../src/console-foundation/transition-records");

import type {
  FlowProjectionLike,
  GateScorecard,
  GateScorecardEntry,
  GateScorecardFinding,
} from "../src/console-foundation/gate-scorecard-projection";
import type { ConsoleTransitionRecord } from "../src/console-foundation/transition-records";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "gate-scorecard");
const TRANSITIONS = path.join(__dirname, "fixtures", "flow-agents-transitions", "captured.jsonl");

function fixture(name: string): FlowProjectionLike {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"));
}

/** The captured real records, in emission order. */
function capturedTransitions(): ConsoleTransitionRecord[] {
  return fs.readFileSync(TRANSITIONS, "utf8")
    .split("\n")
    .filter((line: string) => line.trim().length > 0)
    .map((line: string) => JSON.parse(line) as ConsoleTransitionRecord);
}

function fold(
  projections: FlowProjectionLike[],
  transitions: ConsoleTransitionRecord[] = [],
  window?: { since?: string }
): GateScorecard {
  const projection = createGateScorecardProjection();
  for (const p of projections) projection.apply(p);
  for (const t of transitions) projection.applyTransition(t);
  return projection.materialize(window);
}

function entryFor(card: GateScorecard, flowId: string, gateId: string): GateScorecardEntry {
  const entry = card.entries.find((e: GateScorecardEntry) => e.flow_id === flowId && e.gate_id === gateId);
  assert.ok(entry, `expected an entry for ${flowId}/${gateId}`);
  return entry!;
}

// ── the captured corpus is really the producer's ──────────────────────────────

test("REAL PRODUCER: every captured record validates against the producer contract, unedited", () => {
  // If this ever reds, the fixture was hand-edited or the producer moved — either
  // way the rest of this suite is measuring a payload nobody emits.
  const records = capturedTransitions();
  assert.equal(records.length, 13);
  for (const record of records) {
    assert.deepEqual(validateTransitionRecord(record), [], `record at ${record.started_at} must validate`);
    assert.equal(record.schema, "kontour.flow-agents.transition");
    assert.equal(record.version, "1.0");
  }
  // Producer traits the fold depends on, pinned so a re-capture cannot quietly
  // drop the discriminating cases:
  assert.equal(records.filter((r) => r.gate_outcome === "advanced").length, 4);
  assert.equal(records.filter((r) => r.gate_outcome === "awaiting").length, 3);
  assert.equal(records.filter((r) => r.outcome === "unhandled-error").length, 3);
  // No shipped producer attributes tokens yet (flow-agents computes them at fold
  // time from a host transcript, and the emitter is flow-agents#1273). The
  // enrichment must be honest about that on its own, without a fixture pretending.
  assert.equal(records.some((r) => "output_tokens" in r), false);
});

// ── EXACT COUNTS: the expectation-id join ─────────────────────────────────────

test("EXACT COUNTS: real transitions resolve to the real gates that declare their expectations", () => {
  // builder.shape declares shaped-problem/-outcome/-constraints/-non-goals/
  // -success/-risk/open-decisions on shape-gate, slices-defined on
  // breakdown-gate, work-items-filed on file-issues-gate. The captured corpus
  // names six of those, spread across all three gates.
  const card = fold([fixture("builder-shape")], capturedTransitions());

  const shape = entryFor(card, "builder.shape", "shape-gate");
  assert.equal(shape.cost_availability, "activity_only");
  assert.equal(shape.cost!.transitions, 6);          // 3× shaped-problem, 1 each outcome/constraints/risk
  assert.equal(shape.cost!.gate_advanced, 1);        // only shaped-risk closed the gate
  assert.equal(shape.cost!.gate_awaiting, 3);        // the producer's OWN verdict, which exit 0 does not carry
  assert.deepEqual(shape.cost!.exit_outcomes, { ok: 4, nonzero: 0, "unhandled-error": 2, usage: 0 });
  // The producer's own per-invocation durations, summed: 808 + 837 + 2915
  // (shaped-problem ×3) + 1592 + 1699 + 6099. Latency, not spend.
  assert.equal(shape.cost!.duration_ms, 808 + 837 + 2915 + 1592 + 1699 + 6099);
  assert.equal(shape.cost!.duration_ms, 13_950);

  const breakdown = entryFor(card, "builder.shape", "breakdown-gate");
  assert.equal(breakdown.cost!.transitions, 1);
  assert.equal(breakdown.cost!.gate_advanced, 1);

  const fileIssues = entryFor(card, "builder.shape", "file-issues-gate");
  assert.equal(fileIssues.cost!.transitions, 1);
  assert.equal(fileIssues.cost!.gate_advanced, 1);

  // 6 + 1 + 1 = 8 attributed; 3 named no expectation; 2 named one nothing declares.
  assert.deepEqual(card.transition_coverage, {
    folded: 13,
    attributed: 8,
    without_expectation: 3,
    unattributable: 2,
    outside_window: 0,
    duplicates_suppressed: 0,
  });
});

test("the coverage block PARTITIONS the folded records exactly — nothing falls between the buckets", () => {
  // A coverage summary whose parts do not sum to its whole is how dropped data
  // hides. Asserted over the real corpus AND with a second flow ingested, so the
  // identity is not an artifact of one arrangement.
  for (const projections of [[fixture("builder-shape")], [fixture("builder-shape"), fixture("builder-demo.snapshot-b")]]) {
    const c = fold(projections, capturedTransitions()).transition_coverage;
    assert.equal(c.attributed + c.without_expectation + c.unattributable, c.folded);
  }
});

test("a transition naming no expectation is COUNTED, not reported as unattributable", () => {
  // `capability-matrix`, `assignment-provider status` and `workflow start` never
  // claimed a gate. Filing them as findings would drown the real ones in the
  // ordinary case.
  const card = fold([fixture("builder-shape")], capturedTransitions());
  assert.equal(card.transition_coverage.without_expectation, 3);
  const transitionFindings = card.unattributable.filter((f: GateScorecardFinding) => f.kind.startsWith("transition_"));
  assert.equal(transitionFindings.every((f: GateScorecardFinding) => f.expectation_id !== undefined), true);
});

// ── availability: three different claims, each asserted AS that claim ─────────

test("state unavailable: a gate NO cost producer reached carries cost null — never zero", () => {
  // The whole point of layer 2 being an enrichment. builder.demo has gates and
  // runs and not one transition names any of its expectations.
  const card = fold([fixture("builder-demo.snapshot-b")], capturedTransitions());
  for (const entry of card.entries.filter((e: GateScorecardEntry) => e.flow_id === "builder.demo")) {
    assert.equal(entry.cost, null, `${entry.gate_id}: cost must be absent, not 0`);
    assert.equal(entry.cost_availability, "unavailable");
  }
  // ... and layer 1 still counts it in full: the enrichment's absence costs the
  // gate nothing it already had.
  assert.equal(entryFor(card, "builder.demo", "verify.tests").invocations, 1);
});

test("state activity_only: invocations observed, spend NOT attributed — cost is still unavailable", () => {
  // The regime every real deployment is in today: flow-agents records invocations
  // but attributes output tokens at fold time from a host transcript, and the
  // emitter that would carry them on the wire is flow-agents#1273. Reporting 0
  // tokens here would be indistinguishable from a genuinely free gate.
  const shape = entryFor(fold([fixture("builder-shape")], capturedTransitions()), "builder.shape", "shape-gate");
  assert.equal(shape.cost_availability, "activity_only");
  assert.equal(shape.cost!.output_tokens_floor, null);
  assert.equal(shape.cost!.attribution.transitions_with_turn, 0);
  assert.equal(shape.cost!.attribution.transitions_without_turn, 6);
  assert.equal(shape.cost!.attribution.granularity, "output-tokens-only");
  // Duration IS real and is not spend.
  assert.ok(shape.cost!.duration_ms > 0);
});

test("state floor: an attributed transition makes the figure a FLOOR, and the un-attributed ones are counted beside it", () => {
  // The `output_tokens` field is declared ahead of its emitter (console must
  // accept the kind before flow-agents can send it — validateRecordBody rejects
  // unknown kinds outright). So this case is constructed by adding the field to
  // TWO captured records and leaving the third alone: the third contributes ZERO
  // tokens and is disclosed, which is exactly what makes the total a floor rather
  // than a sum.
  const records = capturedTransitions();
  const shapedProblem = records.filter((r) => r.targets?.expectation === "shaped-problem");
  assert.equal(shapedProblem.length, 3, "fixture precondition");
  shapedProblem[0]!.output_tokens = 1200;
  shapedProblem[1]!.output_tokens = 340;

  const shape = entryFor(fold([fixture("builder-shape")], records), "builder.shape", "shape-gate");
  assert.equal(shape.cost_availability, "floor");
  assert.equal(shape.cost!.output_tokens_floor, 1540);
  assert.equal(shape.cost!.attribution.transitions_with_turn, 2);
  // FOUR resolved transitions contributed nothing — the floor's whole width.
  assert.equal(shape.cost!.attribution.transitions_without_turn, 4);
  assert.equal(shape.cost!.transitions, 6);

  // A gate on the same flow with no attributed transition does NOT inherit "floor".
  assert.equal(entryFor(fold([fixture("builder-shape")], records), "builder.shape", "breakdown-gate").cost_availability, "activity_only");
});

test("an attributed ZERO is a measurement and stays distinct from no attribution at all", () => {
  // 0 output tokens on a turn that WAS attributed is a real observation; absent is
  // not. Collapsing them is the defect this file is named after, one level down.
  const records = capturedTransitions().filter((r) => r.targets?.expectation === "slices-defined");
  assert.equal(records.length, 1);
  records[0]!.output_tokens = 0;
  const entry = entryFor(fold([fixture("builder-shape")], records), "builder.shape", "breakdown-gate");
  assert.equal(entry.cost_availability, "floor");
  assert.equal(entry.cost!.output_tokens_floor, 0);
  assert.equal(entry.cost!.attribution.transitions_with_turn, 1);
  assert.equal(entry.cost!.attribution.transitions_without_turn, 0);
});

// ── unattributable transitions: shown, and harmless to every denominator ──────

test("a transition naming an expectation NO ingested flow declares is a finding, counted by occurrence", () => {
  // Two real records name `tests-evidence`, which belongs to builder.build — a
  // flow this fold has never been given a projection of. One names the flow, one
  // does not (the producer derives `targets.flow` from run state and cannot
  // always resolve it), so they are two distinct findings, not one.
  const card = fold([fixture("builder-shape")], capturedTransitions());
  const findings = card.unattributable.filter((f: GateScorecardFinding) => f.kind === "transition_undeclared_expectation");
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f: GateScorecardFinding) => f.flow_id).sort(), ["builder.build", "unknown"]);
  assert.equal(findings.every((f: GateScorecardFinding) => f.expectation_id === "tests-evidence"), true);
  assert.equal(findings.every((f: GateScorecardFinding) => f.transitions === 1), true);
});

test("repeated unattributable transitions raise the occurrence count instead of collapsing to one", () => {
  // A producer systematically naming an id nothing declares is a different problem
  // from one record doing it once, and a deduped list reports them identically.
  const orphan = capturedTransitions().find((r) => r.targets?.expectation === "tests-evidence" && r.targets?.flow === "builder.build")!;
  const again = JSON.parse(JSON.stringify(orphan)) as ConsoleTransitionRecord;
  again.started_at = "2026-08-21T14:00:00.000Z";     // a DIFFERENT invocation, not a re-delivery
  const card = fold([fixture("builder-shape")], [orphan, again]);
  const findings = card.unattributable.filter((f: GateScorecardFinding) => f.kind === "transition_undeclared_expectation");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.transitions, 2);
  assert.equal(card.transition_coverage.unattributable, 2);
});

test("a shared expectation id with NO flow to disambiguate is reported, never posted to a gate", () => {
  // other.shape declares `shaped-problem` too. `workflow evidence` does not
  // require --flow and the producer's derivation depends on run state resolving
  // one, so real records DO arrive without it (4 in the sampled corpus). This
  // takes a captured record and removes exactly that field to put the real
  // producer state against the real collision.
  const record = JSON.parse(JSON.stringify(
    capturedTransitions().find((r) => r.targets?.expectation === "shaped-problem")!
  )) as ConsoleTransitionRecord;
  delete (record.targets as Record<string, string>)["flow"];

  const card = fold([fixture("builder-shape"), fixture("other-shape")], [record]);
  const collisions = card.unattributable.filter((f: GateScorecardFinding) => f.kind === "transition_expectation_collision");
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]!.expectation_id, "shaped-problem");
  assert.match(collisions[0]!.reason, /declared by 2 flows/);
  // NEITHER claimant received it.
  assert.equal(entryFor(card, "builder.shape", "shape-gate").cost, null);
  assert.equal(entryFor(card, "other.shape", "rival-shape-gate").cost, null);
  assert.equal(card.transition_coverage.attributed, 0);
});

test("the SAME shared id WITH a flow resolves — that is what the flow field is for", () => {
  // The discriminating half of the case above: dropping the flow disambiguation
  // would make this test pass anyway (it would resolve to whichever claimant came
  // first), which is why the pair has to be asserted together.
  const card = fold([fixture("builder-shape"), fixture("other-shape")], capturedTransitions());
  assert.equal(entryFor(card, "builder.shape", "shape-gate").cost!.transitions, 6);
  assert.equal(entryFor(card, "other.shape", "rival-shape-gate").cost, null);
  assert.equal(entryFor(card, "other.shape", "rival-shape-gate").cost_availability, "unavailable");
  assert.equal(card.unattributable.some((f: GateScorecardFinding) => f.kind === "transition_expectation_collision"), false);
});

test("a transition naming a flow that does not declare the id it names resolves to NOTHING", () => {
  // The cross-flow misattribution the collision detection exists to prevent: the
  // record says other.shape, only builder.shape declares shaped-outcome.
  // Attributing it to builder.shape would let one flow's spend land on another's
  // gate on the strength of a coincidence.
  const record = JSON.parse(JSON.stringify(
    capturedTransitions().find((r) => r.targets?.expectation === "shaped-outcome")!
  )) as ConsoleTransitionRecord;
  (record.targets as Record<string, string>)["flow"] = "other.shape";

  const card = fold([fixture("builder-shape"), fixture("other-shape")], [record]);
  const mismatches = card.unattributable.filter((f: GateScorecardFinding) => f.kind === "transition_flow_mismatch");
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0]!.flow_id, "other.shape");
  assert.equal(mismatches[0]!.expectation_id, "shaped-outcome");
  assert.match(mismatches[0]!.reason, /declared by builder\.shape/);
  assert.equal(entryFor(card, "builder.shape", "shape-gate").cost, null);
  assert.equal(card.transition_coverage.attributed, 0);
});

test("LAYER 1 IS UNMOVED BY ANY TRANSITION — attributable or not", () => {
  // The load-bearing separation: a cost producer must not be able to change what
  // the gate is recorded as having DONE. Fold the whole real corpus and compare
  // every layer-1 field against the transition-free fold, field by field.
  const projections = [fixture("builder-shape"), fixture("builder-demo.snapshot-b"), fixture("other-shape")];
  const layer1Only = fold(projections);
  const enriched = fold(projections, capturedTransitions());

  const layer1Fields = (card: GateScorecard) => card.entries.map((e: GateScorecardEntry) => ({
    flow_id: e.flow_id, gate_id: e.gate_id, state: e.state,
    invocations: e.invocations, refusals: e.refusals, route_backs: e.route_backs,
    withheld: e.withheld, indeterminate: e.indeterminate, runs_observed: e.runs_observed,
  }));
  assert.deepEqual(layer1Fields(enriched), layer1Fields(layer1Only));
  assert.equal(enriched.runs_folded, layer1Only.runs_folded);
  assert.deepEqual(enriched.flows_observed, layer1Only.flows_observed);
  // The evidence-side findings are untouched too — transitions only ADD their own kinds.
  const evidenceFindings = (card: GateScorecard) =>
    card.unattributable.filter((f: GateScorecardFinding) => !f.kind.startsWith("transition_"));
  assert.deepEqual(evidenceFindings(enriched), evidenceFindings(layer1Only));
  // ... and a fold that received no transition at all reports an all-zero coverage.
  assert.deepEqual(layer1Only.transition_coverage, {
    folded: 0, attributed: 0, without_expectation: 0, unattributable: 0, outside_window: 0, duplicates_suppressed: 0,
  });
});

// ── retention, windowing, replay ──────────────────────────────────────────────

test("a byte-identical re-delivery is suppressed and DISCLOSED, never double-counted", () => {
  const records = capturedTransitions();
  const card = fold([fixture("builder-shape")], [...records, ...records]);
  assert.equal(card.transition_coverage.duplicates_suppressed, 13);
  assert.equal(card.transition_coverage.folded, 13);
  assert.equal(entryFor(card, "builder.shape", "shape-gate").cost!.transitions, 6);
});

test("two DISTINCT invocations that differ only in start instant both count", () => {
  // The dedup key must not be so coarse that it swallows real repeat work — the
  // failure mode that would silently deflate every figure toward zero.
  const record = capturedTransitions().find((r) => r.targets?.expectation === "slices-defined")!;
  const later = JSON.parse(JSON.stringify(record)) as ConsoleTransitionRecord;
  later.started_at = "2026-08-20T22:40:00.000Z";
  const card = fold([fixture("builder-shape")], [record, later]);
  assert.equal(card.transition_coverage.duplicates_suppressed, 0);
  assert.equal(entryFor(card, "builder.shape", "breakdown-gate").cost!.transitions, 2);
});

test("the window filters transitions by started_at, and out-of-window ones are DISCLOSED not dropped", () => {
  const card = fold([fixture("builder-shape")], capturedTransitions(), { since: "2026-08-20T22:36:30.000Z" });
  // Of shape-gate's six, only shaped-outcome (22:36:32), shaped-constraints
  // (22:36:34) and shaped-risk (22:36:44) started after the cut.
  assert.equal(entryFor(card, "builder.shape", "shape-gate").cost!.transitions, 3);
  assert.equal(card.transition_coverage.folded, 9);
  assert.equal(card.transition_coverage.outside_window, 4);
  assert.equal(card.transition_coverage.folded + card.transition_coverage.outside_window, 13);
  // The three that fell out of the window are not findings and not zeroes — the
  // gate simply has a smaller, honestly-scoped denominator.
  assert.equal(card.transition_coverage.unattributable, 2);
});

test("applyTransition takes a defensive deep copy: vandalizing the caller's record later changes nothing", () => {
  const projection = createGateScorecardProjection();
  projection.apply(fixture("builder-shape"));
  const record = capturedTransitions().find((r) => r.targets?.expectation === "shaped-risk")!;
  projection.applyTransition(record);
  const before = projection.materialize();

  (record.targets as Record<string, string>)["expectation"] = "slices-defined";
  record.duration_ms = 999_999;
  record.output_tokens = 500_000;

  assert.deepEqual(projection.materialize(), before);
  assert.equal(before.entries.find((e: GateScorecardEntry) => e.gate_id === "shape-gate")!.cost!.duration_ms, 6099);
});

test("materialize stays a pure replay with transitions folded in", () => {
  const projection = createGateScorecardProjection();
  projection.apply(fixture("builder-shape"));
  for (const record of capturedTransitions()) projection.applyTransition(record);
  assert.deepEqual(projection.materialize(), projection.materialize());
});

test("malformed transitions are ignored rather than throwing", () => {
  const projection = createGateScorecardProjection();
  projection.apply(fixture("builder-shape"));
  projection.applyTransition(null as unknown as ConsoleTransitionRecord);
  projection.applyTransition({} as ConsoleTransitionRecord);
  projection.applyTransition({ targets: "not-an-object" } as unknown as ConsoleTransitionRecord);
  const card = projection.materialize();
  assert.equal(entryFor(card, "builder.shape", "shape-gate").cost, null);
  // `null` is refused outright. The other two are structurally indistinguishable
  // once the non-object `targets` is normalized away, so they share a natural key
  // and the second is suppressed as a re-delivery — visibly, in the coverage
  // block, rather than by being quietly discarded.
  assert.equal(card.transition_coverage.folded, 1);
  assert.equal(card.transition_coverage.without_expectation, 1);
  assert.equal(card.transition_coverage.duplicates_suppressed, 1);
});

// ── the record contract at the ingest boundary ────────────────────────────────

test("INGEST: the producer's own optional fields are accepted, and unknown extras do not 400", () => {
  // The producer schema declares additionalProperties: true. A minor-version
  // addition upstream must not turn into a fleet-wide rejection.
  const record = capturedTransitions()[0]!;
  assert.deepEqual(validateTransitionRecord({ ...record, some_future_field: { nested: true } }), []);
  assert.deepEqual(validateTransitionRecord({ ...record, gate_outcome: "awaiting", gate_missing: ["a", "b"] }), []);
  assert.deepEqual(validateTransitionRecord({ ...record, output_tokens: 0 }), []);
});

test("INGEST: rejections name the field, and each rejected shape is one a real producer never emits", () => {
  const base = capturedTransitions()[0]!;
  const rejects = (over: Record<string, unknown>, pathSuffix: string) => {
    const issues = validateTransitionRecord({ ...base, ...over });
    assert.ok(issues.length > 0, `expected a rejection for ${pathSuffix}`);
    assert.ok(issues.some((i: { path: string }) => i.path === `record.${pathSuffix}`), `expected an issue at record.${pathSuffix}, got ${issues.map((i: { path: string }) => i.path).join(", ")}`);
  };
  rejects({ schema: "kontour.console.event" }, "schema");
  rejects({ version: "2.0" }, "version");
  rejects({ command: 7 }, "command");
  rejects({ targets: ["expectation"] }, "targets");
  rejects({ flags: "--expectation" }, "flags");
  rejects({ exit_code: "70" }, "exit_code");
  rejects({ outcome: "crashed" }, "outcome");
  rejects({ started_at: "yesterday" }, "started_at");
  rejects({ duration_ms: -1 }, "duration_ms");
  rejects({ actor: { runtime: "claude-code" } }, "actor.session_id");
  rejects({ gate_outcome: "passed" }, "gate_outcome");
  // A malformed cost claim is REJECTED, not absorbed as "no turn": absorbing it
  // would turn an emitter bug into permanently understated cost.
  rejects({ output_tokens: -5 }, "output_tokens");
  rejects({ output_tokens: "1200" }, "output_tokens");
  // `command`/`verb` are required but NULLABLE — an interrupted or unregistered
  // invocation is still a true record of an invocation.
  const missingCommand = { ...base } as Record<string, unknown>;
  delete missingCommand["command"];
  assert.ok(validateTransitionRecord(missingCommand).some((i: { path: string }) => i.path === "record.command"));
  assert.deepEqual(validateTransitionRecord({ ...base, command: null, verb: null }), []);
});
