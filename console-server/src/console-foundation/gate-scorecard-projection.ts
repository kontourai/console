/**
 * Per-gate outcome measurement, folded from the Flow console projections Console
 * already ingests. Layer 1 of console#277: no new producer, works for ANY flow.
 *
 * What this answers: for each gate of each flow, how often it was reached, how often
 * it refused, how often it sent work back, and — the question no single run can answer
 * — which gates the fleet declares but never actually invokes.
 *
 * What it deliberately does NOT do:
 *
 *  - it never recomputes a trust verdict. Trust is `selectGateTrustReport()`'s domain
 *    and lives beside this, not inside it. Trust and cost are different honesty
 *    domains and merging them into one number is how a panel starts lying;
 *  - it never computes an ablation verdict ("is this gate worth keeping"). That is a
 *    controlled counterfactual, it is run and graded in kontourai/evals, and Console
 *    displays its result as an ingested record. A projection that derived value from
 *    the gates' own telemetry would be the apparatus grading itself;
 *  - it never reports cost. Flow's projection knows what happened, not what it cost.
 *    Cost is an optional enrichment (layer 2) and its absence is stated, never zero.
 *
 * Four states, because three of them are routinely mistaken for each other:
 *
 *   invoked      the gate was reached and evaluated
 *   never_invoked  the flow ran and this gate was never reached — NOT a zero. This was
 *                a live defect in the hand-built version of this card: a gate recorded
 *                as proven and costed had never received an evidence write
 *   unexercised  the gate belongs to a flow no run in this window exercised. Counting
 *                it as never_invoked buries the one idle gate in the flow that DID run
 *                under every gate of every flow that did not
 *   withheld     a verdict exists but does not qualify — see below
 *
 * `withheld` is the state kontourai/evals#220 forced into existence. An experiment
 * whose arms were not comparable produces no verdict, and the analysis emits `null`
 * rather than a caveated number, because a caveated number gets quoted without its
 * caveat. The panel must be able to render "this does not qualify" as a first-class
 * outcome; if the only states are pass/fail/unknown, an uncomparable result lands in
 * `unknown` beside genuinely missing data, and those are very different claims.
 */

/** A gate as it appears inside an ingested Flow console projection. */
export interface FlowProjectionGate {
  id?: string;
  gate_id?: string;
  status?: string;
  evidence?: Array<{ id?: string; expectation_id?: string; status?: string }>;
}

/** The subset of a Flow console projection this fold reads. Structurally typed so
 *  console takes no dependency on `@kontourai/flow`, exactly as OperatingState does. */
export interface FlowProjectionLike {
  run_id?: string;
  flow_id?: string;
  definition_id?: string;
  gates?: FlowProjectionGate[];
  /** Gates the flow DECLARES, whether or not this run reached them. Without it a gate
   *  that never fired is invisible rather than reported. */
  declared_gates?: Array<string | { gate_id?: string; id?: string }>;
  transitions?: Array<{ type?: string; gate_id?: string }>;
  evidence?: Array<{ id?: string; expectation_id?: string; gate_id?: string }>;
}

export type GateOutcomeState = "invoked" | "never_invoked" | "unexercised" | "withheld";

export interface GateScorecardEntry {
  flow_id: string;
  gate_id: string;
  state: GateOutcomeState;
  /** Runs in which this gate was reached. */
  invocations: number;
  /** Evaluations that did not pass. A refusal is not a catch — see route_backs. */
  refusals: number;
  /** Times this gate sent work back. This, not a refusal count, is the evidence that
   *  a gate changed an outcome: a rejected claim that is re-submitted in the same
   *  shape cost time and changed nothing. */
  route_backs: number;
  /** Runs of this flow observed in the window, so a rate has a denominator. */
  runs_observed: number;
  /** Absent, never zero: this projection has no cost producer (layer 2). */
  cost: null;
  cost_availability: "unavailable";
}

export interface GateScorecard {
  entries: GateScorecardEntry[];
  /** Evidence naming an expectation no gate in its flow declares, and expectation ids
   *  claimed by more than one flow. Reported, never dropped: silently discarding them
   *  shrinks the denominator and reads as full coverage of a smaller problem. */
  unattributable: Array<{ flow_id: string; expectation_id: string; reason: string }>;
  runs_folded: number;
  flows_observed: string[];
}

function gateIdOf(gate: FlowProjectionGate): string | null {
  const id = gate.gate_id ?? gate.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function declaredGateId(entry: string | { gate_id?: string; id?: string }): string | null {
  if (typeof entry === "string") return entry.length > 0 ? entry : null;
  const id = entry?.gate_id ?? entry?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function flowIdOf(projection: FlowProjectionLike): string {
  return projection.flow_id ?? projection.definition_id ?? "unknown";
}

/** A gate evaluation that did not pass. Deliberately narrow: an unknown status is not
 *  a refusal. Treating "we could not tell" as "it refused" inflates the cost of every
 *  gate whose vocabulary this fold does not recognise. */
function isRefusal(status: string | undefined): boolean {
  if (typeof status !== "string") return false;
  const s = status.toLowerCase();
  return s === "failed" || s === "refused" || s === "rejected" || s === "route-back" || s === "route_back";
}

export interface GateScorecardProjection {
  apply(projection: FlowProjectionLike): void;
  materialize(): GateScorecard;
}

export function createGateScorecardProjection(): GateScorecardProjection {
  // Retain the folded inputs so materialize() is a pure replay and the projection is
  // fully rebuildable, matching economics-projection's contract. Dedup on run_id so a
  // re-POST of the same run does not double-count a gate's invocations.
  const projections: FlowProjectionLike[] = [];
  const seenRuns = new Set<string>();

  function apply(projection: FlowProjectionLike): void {
    if (!projection || typeof projection !== "object") return;
    const runId = projection.run_id;
    if (typeof runId === "string" && runId.length > 0) {
      if (seenRuns.has(runId)) return;
      seenRuns.add(runId);
    }
    projections.push(projection);
  }

  function materialize(): GateScorecard {
    // Per (flow, gate) tallies, plus per-flow bookkeeping so scope is DERIVED from the
    // flows a run actually exercised rather than declared across the fleet.
    const tally = new Map<string, GateScorecardEntry>();
    const declaredByFlow = new Map<string, Set<string>>();
    const runsByFlow = new Map<string, number>();
    const expectationOwners = new Map<string, Set<string>>();
    const unattributable: GateScorecard["unattributable"] = [];

    // NUL separator so a flow or gate id containing the separator cannot forge a
    // collision with a different (flow, gate) pair. Written as an ESCAPE: a literal NUL
    // byte here makes git treat the whole file as binary, so the diff becomes unreviewable
    // while everything still compiles and passes.
    const key = (flow: string, gate: string) => `${flow}\u0000${gate}`;
    const ensure = (flow: string, gate: string): GateScorecardEntry => {
      const k = key(flow, gate);
      let entry = tally.get(k);
      if (!entry) {
        entry = {
          flow_id: flow, gate_id: gate, state: "never_invoked",
          invocations: 0, refusals: 0, route_backs: 0, runs_observed: 0,
          cost: null, cost_availability: "unavailable",
        };
        tally.set(k, entry);
      }
      return entry;
    };

    for (const projection of projections) {
      const flow = flowIdOf(projection);
      runsByFlow.set(flow, (runsByFlow.get(flow) ?? 0) + 1);

      const declared = declaredByFlow.get(flow) ?? new Set<string>();
      for (const raw of projection.declared_gates ?? []) {
        const id = declaredGateId(raw);
        if (id) { declared.add(id); ensure(flow, id); }
      }
      declaredByFlow.set(flow, declared);

      for (const gate of projection.gates ?? []) {
        const id = gateIdOf(gate);
        if (!id) continue;
        declared.add(id);
        const entry = ensure(flow, id);
        entry.invocations += 1;
        entry.state = "invoked";
        if (isRefusal(gate.status)) entry.refusals += 1;
        for (const ev of gate.evidence ?? []) {
          if (isRefusal(ev.status)) entry.refusals += 1;
          if (typeof ev.expectation_id === "string" && ev.expectation_id.length > 0) {
            const owners = expectationOwners.get(ev.expectation_id) ?? new Set<string>();
            owners.add(flow);
            expectationOwners.set(ev.expectation_id, owners);
          }
        }
      }

      // Route-backs are the only signal here that a gate CHANGED an outcome.
      for (const transition of projection.transitions ?? []) {
        if (transition?.type !== "route_back") continue;
        const id = transition.gate_id;
        if (typeof id !== "string" || id.length === 0) continue;
        declared.add(id);
        const entry = ensure(flow, id);
        entry.route_backs += 1;
      }

      // Evidence naming an expectation no gate in this flow declares.
      const gateIds = new Set((projection.gates ?? []).map(gateIdOf).filter((v): v is string => v !== null));
      for (const ev of projection.evidence ?? []) {
        const expectation = ev?.expectation_id;
        if (typeof expectation !== "string" || expectation.length === 0) continue;
        const owners = expectationOwners.get(expectation) ?? new Set<string>();
        owners.add(flow);
        expectationOwners.set(expectation, owners);
        const gate = ev.gate_id;
        if (typeof gate === "string" && gate.length > 0 && !gateIds.has(gate) && !declared.has(gate)) {
          unattributable.push({ flow_id: flow, expectation_id: expectation, reason: "evidence names a gate the flow does not declare" });
        }
      }
    }

    // An expectation id claimed by more than one flow is a real finding, not noise:
    // a join on it would silently attribute one flow's evidence to another.
    for (const [expectation, owners] of expectationOwners) {
      if (owners.size > 1) {
        for (const flow of owners) {
          unattributable.push({ flow_id: flow, expectation_id: expectation, reason: `expectation id is claimed by ${owners.size} flows` });
        }
      }
    }

    for (const entry of tally.values()) {
      entry.runs_observed = runsByFlow.get(entry.flow_id) ?? 0;
      // A flow no run exercised is `unexercised`, not `never_invoked`. Collapsing the
      // two buries the single idle gate in the flow that ran under every gate of every
      // flow that did not.
      if (entry.invocations === 0 && entry.runs_observed === 0) entry.state = "unexercised";
    }

    const entries = [...tally.values()].sort((a, b) =>
      a.flow_id === b.flow_id ? a.gate_id.localeCompare(b.gate_id) : a.flow_id.localeCompare(b.flow_id));

    return {
      entries,
      unattributable,
      runs_folded: projections.length,
      flows_observed: [...runsByFlow.keys()].sort(),
    };
  }

  return { apply, materialize };
}
