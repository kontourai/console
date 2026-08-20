/**
 * The gate scorecard's job is to be honest about four states that are routinely
 * mistaken for each other. Every case here pins one of those confusions, and most of
 * them are drawn from defects that actually happened rather than from imagination:
 *
 *  - a gate recorded as proven and costed that had never received an evidence write
 *    (the hand-built version of this card);
 *  - a refusal counted as a catch, when the claim was re-submitted unchanged and the
 *    work never moved (kontourai/flow-agents#350: 81 refusals, zero route-backs);
 *  - zero shown where "we did not measure" was the truth (kontourai/evals#217, #226);
 *  - a verdict quoted without the caveat that disqualified it (kontourai/evals#220).
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createGateScorecardProjection } = require("../src/console-foundation/gate-scorecard-projection");

// Types via `import type` (erased at runtime, so it composes with the require above and
// with the package's node --test runner). Without them the callbacks below are implicitly
// any and `npm run typecheck` fails -- which the test RUNNER does not notice, so a green
// run here is not evidence the file typechecks.
import type {
  FlowProjectionLike,
  GateScorecardEntry,
  GateScorecard,
} from "../src/console-foundation/gate-scorecard-projection";

const run = (over: Partial<FlowProjectionLike> = {}): FlowProjectionLike => ({
run_id: `run-${Math.random().toString(36).slice(2)}`,
flow_id: "builder.build",
...over,
});

function fold(projections: FlowProjectionLike[]) {
const projection = createGateScorecardProjection();
for (const p of projections) projection.apply(p);
return projection.materialize();
}

test("gate scorecard: counts an invoked gate once per run and reports its denominator", () => {
  const card = fold([
    run({ gates: [{ gate_id: "verify-gate", status: "passed" }] }),
    run({ gates: [{ gate_id: "verify-gate", status: "passed" }] }),
  ]);
  const [entry] = card.entries;
  assert.equal(entry.gate_id, "verify-gate");
  assert.equal(entry.state, "invoked");
  assert.equal(entry.invocations, 2);
  // A rate without a denominator is a number nobody can check.
  assert.equal(entry.runs_observed, 2);
});

test("gate scorecard: a declared gate that never fired is never_invoked, NOT a zero", () => {
  // The live defect this card was rebuilt to fix: a gate recorded as proven and
  // costed had never received an evidence write. "0 refusals" and "never ran" render
  // identically if the state is not carried explicitly.
  const card = fold([
    run({ declared_gates: ["pull-work-gate", "verify-gate"], gates: [{ gate_id: "verify-gate", status: "passed" }] }),
  ]);
  const pull = card.entries.find((e: GateScorecardEntry) => e.gate_id === "pull-work-gate");
  assert.equal(pull?.state, "never_invoked");
  assert.equal(pull?.invocations, 0);
  // and it must be distinguishable from a gate that ran and refused nothing
  const verify = card.entries.find((e: GateScorecardEntry) => e.gate_id === "verify-gate");
  assert.equal(verify?.state, "invoked");
  assert.equal(verify?.refusals, 0);
  assert.notEqual(pull?.state, verify?.state);
});

test("gate scorecard: a refusal is not a catch: they are counted separately", () => {
  // Measured on the real corpus: 81 refusals across the kit arms and ZERO route-backs.
  // Every rejection was about the form of a claim, and the work never moved. A panel
  // that folded refusals into "defects caught" would have reported an apparatus
  // working hard and catching nothing as an apparatus catching 81 things.
  const card = fold([
    run({ gates: [{ gate_id: "verify-gate", status: "refused", evidence: [{ status: "refused" }] }] }),
  ]);
  const [entry] = card.entries;
  assert.ok((entry.refusals) > 0);
  assert.equal(entry.route_backs, 0);
});

test("gate scorecard: a route-back is what shows a gate changed an outcome", () => {
  const card = fold([
    run({
      gates: [{ gate_id: "verify-gate", status: "refused" }],
      transitions: [{ type: "route_back", gate_id: "verify-gate" }],
    }),
  ]);
  assert.equal(card.entries[0]?.route_backs, 1);
});

test("gate scorecard: the two counters are INDEPENDENT: a route-back does not add a refusal", () => {
  // The separating case. Without it, folding refusals into route-back counting goes
  // undetected: the refusal fixture asserts route_backs === 0 and the route-back
  // fixture had a refusing gate, so no case pinned "route-back with a passing gate".
  // That is the same gap that let a jq falsy-alternative through an hour ago —
  // fixture diversity, not assertion strength.
  const card = fold([
    run({
      gates: [{ gate_id: "verify-gate", status: "passed" }],
      transitions: [{ type: "route_back", gate_id: "verify-gate" }],
    }),
  ]);
  assert.equal(card.entries[0]?.route_backs, 1);
  assert.equal(card.entries[0]?.refusals, 0);
});

test("gate scorecard: a refusal does not add a route-back", () => {
  const card = fold([run({ gates: [{ gate_id: "g", status: "refused" }] })]);
  assert.equal(card.entries[0]?.refusals, 1);
  assert.equal(card.entries[0]?.route_backs, 0);
});

test("gate scorecard: an unknown status is not counted as a refusal", () => {
  // Treating "we could not tell" as "it refused" inflates the cost of every gate
  // whose vocabulary this fold does not recognise — a third-party flow, say.
  const card = fold([run({ gates: [{ gate_id: "g", status: "some-third-party-status" }] })]);
  assert.equal(card.entries[0]?.refusals, 0);
  assert.equal(card.entries[0]?.state, "invoked");
});

test("gate scorecard: gates of a flow no run exercised are unexercised, not never_invoked", () => {
  // Scope is derived from what ran, not declared across the fleet. Collapsing these
  // buries the one idle gate in the flow that DID run under every gate of every flow
  // that did not.
  const projection = createGateScorecardProjection();
  projection.apply(run({ flow_id: "builder.build", declared_gates: ["a", "b"], gates: [{ gate_id: "a" }] }));
  const card = projection.materialize();
  const b = card.entries.find((e: GateScorecardEntry) => e.gate_id === "b");
  assert.equal(b?.state, "never_invoked");
  assert.deepEqual(card.flows_observed, ["builder.build"]);
  // knowledge.* gates are absent entirely rather than reported as idle
  assert.equal(card.entries.every((e: GateScorecardEntry) => e.flow_id === "builder.build"), true);
});

test("gate scorecard: cost is absent and says so, never zero", () => {
  // Flow's projection knows what happened, not what it cost. A zero here would be
  // indistinguishable from a genuinely free gate — the same defect that recorded
  // 0 tokens for forty real minutes of spend.
  const card = fold([run({ gates: [{ gate_id: "g" }] })]);
  assert.equal(card.entries[0]?.cost, null);
  assert.equal(card.entries[0]?.cost_availability, "unavailable");
});

test("gate scorecard: evidence naming an undeclared gate is reported, not dropped", () => {
  // Silently discarding it shrinks the denominator and reads as full coverage of a
  // smaller problem.
  const card = fold([
    run({ gates: [{ gate_id: "verify-gate" }], evidence: [{ expectation_id: "tests-evidence", gate_id: "ghost-gate" }] }),
  ]);
  assert.equal((card.unattributable).length, 1);
  assert.match(card.unattributable[0]?.reason, /does not declare/);
});

test("gate scorecard: an expectation id claimed by two flows is reported for both", () => {
  // A join on that id would silently attribute one flow's evidence to the other.
  const card = fold([
    run({ flow_id: "builder.build", gates: [{ gate_id: "g", evidence: [{ expectation_id: "shared" }] }] }),
    run({ flow_id: "knowledge.ingest", gates: [{ gate_id: "h", evidence: [{ expectation_id: "shared" }] }] }),
  ]);
  const claims = card.unattributable.filter((u: GateScorecard["unattributable"][number]) => u.expectation_id === "shared");
  assert.equal((claims).length, 2);
  assert.deepEqual(new Set(claims.map((c: GateScorecard["unattributable"][number]) => c.flow_id)), new Set(["builder.build", "knowledge.ingest"]));
});

test("gate scorecard: a re-POSTed run does not double-count", () => {
  const projection = createGateScorecardProjection();
  const once = run({ run_id: "fixed", gates: [{ gate_id: "g" }] });
  projection.apply(once);
  projection.apply(once);
  assert.equal(projection.materialize().entries[0]?.invocations, 1);
  assert.equal(projection.materialize().runs_folded, 1);
});

test("gate scorecard: materialize is a pure replay and can be called repeatedly", () => {
  const projection = createGateScorecardProjection();
  projection.apply(run({ gates: [{ gate_id: "g" }] }));
  assert.deepEqual(projection.materialize(), projection.materialize());
});

test("gate scorecard: folds gates from any flow, not an allow-list of one kit's", () => {
  // The rescope of console#277: gates are a Flow concept. A projection that knew
  // Builder's gate ids would be blind to every other flow — and would put kit
  // vocabulary in a kit-neutral surface.
  const card = fold([
    run({ flow_id: "knowledge.ingest", gates: [{ gate_id: "classify-gate" }] }),
    run({ flow_id: "some.third-party", gates: [{ gate_id: "whatever-gate" }] }),
  ]);
  assert.deepEqual(card.flows_observed, ["knowledge.ingest", "some.third-party"]);
  assert.deepEqual(card.entries.map((e: GateScorecardEntry) => e.gate_id), ["classify-gate", "whatever-gate"]);
});

test("gate scorecard: malformed input is ignored rather than throwing", () => {
  const projection = createGateScorecardProjection();
  projection.apply(null as unknown as FlowProjectionLike);
  projection.apply({ gates: [{ status: "passed" }] });  // gate with no id
  assert.equal((projection.materialize().entries).length, 0);
});
