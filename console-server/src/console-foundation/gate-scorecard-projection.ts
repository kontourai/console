/**
 * Per-gate outcome measurement, folded from the Flow console projections Console
 * already ingests at POST /ingest/flow. Layer 1 of console#277: no new producer,
 * works for ANY flow. Rebuilt against the REAL `FlowConsoleProjection` shape in
 * review round 1 of #278 — the previous fold read a flat `run_id`/`flow_id`/
 * `declared_gates` shape no producer emits, so every real flow folded to "unknown".
 *
 * What the REAL payload looks like (see `projectFlowRun` in
 * `@kontourai/flow/dist/console/console-projection.js`, and the captured fixtures
 * under `test/fixtures/gate-scorecard/`):
 *
 *  - run identity is NESTED: `payload.run.run_id` / `payload.run.definition_id`;
 *  - `gates[]` contains EVERY gate the definition declares, whether or not this
 *    run reached it. An idle gate projects status "wait" — and an UNREACHED gate
 *    with required expectations projects a COMPUTED "block" (evaluateGate runs
 *    lazily over the current manifest), so bare statuses cannot say "invoked";
 *  - evidence carries PLURAL `expectation_ids: string[]`, and expectations are
 *    declared at `gates[].expectations[].id`;
 *  - route-backs have a canonical `route_backs[]` array in which ONE event can
 *    appear under TWO sources ("gate_outcome" and "transition"), because Flow
 *    writes a paired transition for every route-back outcome.
 *
 * What this answers: for each gate of each flow, how often it was reached, how
 * often it refused, how often it sent work back, and — the question no single run
 * can answer — which gates the fleet declares but never actually invokes.
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
 * Five states, because most of them are routinely mistaken for each other:
 *
 *   invoked      the gate was reached and evaluated to a recognized verdict
 *   never_invoked  the flow ran and this gate never produced one — NOT a zero. This
 *                was a live defect in the hand-built version of this card: a gate
 *                recorded as proven and costed had never received an evidence write
 *   unexercised  the gate belongs to a flow with no run in the requested window.
 *                Scope is DERIVED: the declared universe is folded from retained
 *                projections of runs OUTSIDE the window, never from a fleet-wide
 *                declaration this projection has no producer for
 *   withheld     a verdict exists but does not qualify — see below
 *   indeterminate  a refusal-shaped verdict the projection cannot prove was
 *                evaluated. Flow's projection emits a lazily COMPUTED "block" for
 *                a gate the run never reached, and persists a REAL evaluated
 *                "block" for an evidence-less gate, in byte-identical shapes
 *                (review round 2 reproduced both; see
 *                test/fixtures/gate-scorecard/indeterminate-demo.json). Counting
 *                it as a refusal fabricates gate activity; counting it as
 *                never_invoked erases a real verdict. The fold does neither and
 *                says so. Disambiguation needs an upstream evaluation-provenance
 *                marker on FlowConsoleGateProjection (e.g. status_source:
 *                "gate_outcome" | "computed", or an evaluated_at stamp) — the
 *                producer discards that bit at `outcome?.status ?? computed.status`.
 *
 * `withheld` is the state kontourai/evals#220 forced into existence. An experiment
 * whose arms were not comparable produces no verdict, and the analysis emits `null`
 * rather than a caveated number, because a caveated number gets quoted without its
 * caveat. Here it is DERIVED: a gate whose projected status is a verdict this fold
 * does not recognize as pass or refusal is reported as "does not qualify" rather
 * than silently absorbed into either bucket, and those are very different claims.
 */

import type { FlowConsoleProjection } from "@kontourai/flow/console-contract" with { "resolution-mode": "import" };

/** Evidence as the producer projects it — note PLURAL `expectation_ids`. The
 *  fields this fold CONSUMES are REQUIRED (review round 2: an all-optional shape
 *  makes the drift alarm below vacuous — a producer rename would still be
 *  assignable). The RUNTIME stays defensive about violations; the type states
 *  the contract real payloads satisfy. */
export interface FlowProjectionEvidence {
  id: string;
  status: string | null;
  expectation_ids: ReadonlyArray<string>;
  gate_id?: string | null;
}

/** A gate as it appears inside a real ingested Flow console projection. */
export interface FlowProjectionGate {
  id: string;
  status: string;
  is_open: boolean;
  expectations: ReadonlyArray<{ id: string }>;
  evidence_refs: ReadonlyArray<string>;
  evidence: ReadonlyArray<FlowProjectionEvidence>;
  matched_expectations: ReadonlyArray<Record<string, unknown>>;
  accepted_exception_id?: string | null;
}

export interface FlowProjectionTransition {
  id: string;
  type: string;
  status: string | null;
  gate_id: string | null;
}

export interface FlowProjectionRouteBack {
  id: string;
  /** "gate_outcome" | "transition" in the real producer. */
  source: string;
  gate_id: string | null;
}

/** The subset of a Flow console projection this fold reads. Structurally typed so
 *  console's RUNTIME takes no dependency on `@kontourai/flow`, exactly as
 *  OperatingState does; the type-only import above pins the shape at compile time.
 *  Every CONSUMED field is required so the drift alarm has teeth; `apply()` still
 *  degrades gracefully at runtime when a legacy/foreign producer omits pieces
 *  (see the legacy route-back fallback), because a type cannot police the wire. */
export interface FlowProjectionLike {
  run: { run_id: string; definition_id?: string | null; updated_at?: string | null };
  definition?: { id?: string | null } | null;
  gates: ReadonlyArray<FlowProjectionGate>;
  evidence: ReadonlyArray<FlowProjectionEvidence>;
  transitions: ReadonlyArray<FlowProjectionTransition>;
  route_backs: ReadonlyArray<FlowProjectionRouteBack>;
}

// COMPILE-TIME DRIFT ALARM: the real producer payload must stay assignable to the
// structural shape this fold reads. Because every consumed field above is
// REQUIRED, a Flow release that renames/removes run.run_id, gates[].expectations,
// evidence expectation_ids, route_backs, etc. fails typecheck here — instead of
// the fold silently reading `undefined` forever (the exact defect review round 1
// caught). The captured fixtures are pinned by the regenerate-and-compare test in
// gate-scorecard-projection.test.ts, which covers the runtime half of the same drift.
const flowConsoleProjectionIsFoldable: FlowConsoleProjection extends FlowProjectionLike ? true : never = true;
void flowConsoleProjectionIsFoldable;

export type GateOutcomeState = "invoked" | "never_invoked" | "unexercised" | "withheld" | "indeterminate";

export interface GateScorecardEntry {
  flow_id: string;
  gate_id: string;
  state: GateOutcomeState;
  /** Runs in which this gate was reached and evaluated to a recognized verdict
   *  (at most one per run — this is a fold of run snapshots, not of events). */
  invocations: number;
  /** Runs whose snapshot shows this gate refusing (block/fail/refuse/route-back).
   *  A refusal is not a catch — see route_backs. Counted ONCE per run: a refused
   *  gate with refused evidence items is one refusal, not several. */
  refusals: number;
  /** Times this gate sent work back, from the producer's canonical `route_backs[]`
   *  (deduped so one event reported under two sources counts once). This, not a
   *  refusal count, is the evidence that a gate changed an outcome: a rejected
   *  claim that is re-submitted in the same shape cost time and changed nothing. */
  route_backs: number;
  /** Runs whose snapshot shows a PROVEN-evaluated verdict this fold does not
   *  recognize as pass or refusal — reported as "does not qualify", never
   *  guessed into a bucket. */
  withheld: number;
  /** Runs whose snapshot shows a refusal-shaped (or unrecognized) verdict the
   *  projection CANNOT PROVE was evaluated. Flow persists a real "block"
   *  gate_outcome byte-identically to the lazy computed "block" of a gate the
   *  run never reached (no is_open, no evidence, no matches — review round 2
   *  reproduced both from the same producer), so this fold refuses to guess in
   *  either direction: not a refusal, not never_invoked, its own number. */
  indeterminate: number;
  /** Runs of this flow observed in the window, so a rate has a denominator. */
  runs_observed: number;
  /** Absent, never zero: this projection has no cost producer (layer 2). */
  cost: null;
  cost_availability: "unavailable";
}

/** A datum the fold could not attribute — reported, never dropped. Silently
 *  discarding it shrinks the denominator and reads as full coverage of a smaller
 *  problem. */
export interface GateScorecardFinding {
  kind: "undeclared_expectation" | "expectation_collision" | "undeclared_gate";
  flow_id: string;
  reason: string;
  expectation_id?: string;
  gate_id?: string;
  evidence_id?: string;
  run_id?: string;
}

export interface GateScorecard {
  entries: GateScorecardEntry[];
  /** Evidence naming an expectation (or gate) its flow does not declare, and
   *  expectation ids declared by more than one flow. */
  unattributable: GateScorecardFinding[];
  /** Runs folded inside the window (= the denominator across all flows). */
  runs_folded: number;
  /** Flows with at least one run inside the window. Flows known only from
   *  retained out-of-window runs still appear in `entries` as `unexercised`. */
  flows_observed: string[];
  /** The window this scorecard covers; `since: null` means "everything retained".
   *  Stated so a number is never quoted without its scope. */
  window: { since: string | null };
}

export interface GateScorecardWindow {
  /** ISO timestamp; runs whose `run.updated_at` is older fall out of the window
   *  (they still contribute the declared gate/expectation universe). */
  since?: string;
}

export interface GateScorecardProjection {
  apply(projection: FlowProjectionLike): void;
  materialize(window?: GateScorecardWindow): GateScorecard;
}

/** Verdicts this fold recognizes. Anything else that is still a verdict (not an
 *  idle "wait") is `withheld` — "we could not qualify this" must stay distinct
 *  from both "it passed" and "it refused". */
const PASS_STATUSES = new Set(["pass", "passed"]);
const REFUSAL_STATUSES = new Set(["block", "blocked", "fail", "failed", "refuse", "refused", "reject", "rejected"]);
const ROUTE_BACK_STATUSES = new Set(["route-back", "route_back"]);
const IDLE_STATUSES = new Set(["", "wait", "waiting", "pending", "open"]);

function normalizeStatus(status: string | null | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function flowIdOf(projection: FlowProjectionLike): string {
  const id = projection.run?.definition_id ?? projection.definition?.id;
  return nonEmpty(id) ? id : "unknown";
}

/** Can the projection PROVE this gate was reached in the run this snapshot
 *  describes?
 *
 *  The producer runs `evaluateGate` lazily over every declared gate, so an
 *  UNREACHED gate with required expectations projects a computed "block" — bare
 *  status is not proof of invocation. Corroboration that the run was really at
 *  this gate: it is open (blocked runs stay on the gate's step), or evidence was
 *  attached to it, or expectations matched, or an exception was accepted.
 *  "pass" and "route-back" cannot be computed for an untouched gate (pass needs
 *  matched evidence or an accepted exception; route-back needs a recorded
 *  outcome), so they stand on their own.
 *
 *  The converse does NOT hold (review round 2): a REAL persisted "block" outcome
 *  for an evidence-less gate the run advanced past projects with none of these
 *  corroborations either. `false` therefore means INDETERMINATE, never "was not
 *  reached" — the caller must not fold it into either bucket. */
function gateWasProvablyReached(gate: FlowProjectionGate, status: string): boolean {
  if (PASS_STATUSES.has(status) || ROUTE_BACK_STATUSES.has(status)) return true;
  return Boolean(gate.is_open)
    || (gate.evidence?.length ?? 0) > 0
    || (gate.evidence_refs?.length ?? 0) > 0
    || (gate.matched_expectations?.length ?? 0) > 0
    || nonEmpty(gate.accepted_exception_id);
}

/** Route-back occurrences for one run, keyed by gate id, deduped by stable id.
 *
 *  Flow writes every route-back outcome as BOTH a `gate_outcome` entry (the
 *  gate's current outcome) and a paired `transition` entry (durable history), so
 *  the canonical array can carry one event twice — see
 *  `builder-demo.snapshot-a.json`. Transitions are the durable record (the
 *  gate_outcome entry disappears once the gate recovers), so transition-source
 *  entries count and a gate_outcome-source entry counts only for a gate with no
 *  transition-source entry in the same snapshot. Re-ingest cannot double-count
 *  regardless: a later snapshot of the same run SUPERSEDES the earlier one. */
function routeBacksByGate(projection: FlowProjectionLike): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (gateId: string, n: number) => {
    if (n > 0) counts.set(gateId, (counts.get(gateId) ?? 0) + n);
  };

  if (Array.isArray(projection.route_backs)) {
    const transitionIds = new Map<string, Set<string>>();
    const outcomeIds = new Map<string, Set<string>>();
    for (const entry of projection.route_backs) {
      const gateId = entry?.gate_id;
      if (!nonEmpty(gateId)) continue;
      const bucket = entry?.source === "gate_outcome" ? outcomeIds : transitionIds;
      let ids = bucket.get(gateId);
      if (!ids) bucket.set(gateId, (ids = new Set()));
      ids.add(nonEmpty(entry?.id) ? entry.id : `unidentified.${ids.size}`);
    }
    for (const [gateId, ids] of transitionIds) add(gateId, ids.size);
    for (const [gateId, ids] of outcomeIds) {
      if (!transitionIds.has(gateId)) add(gateId, ids.size);
    }
    return counts;
  }

  // No canonical array (older/foreign producer): recognize every producer form —
  // transition type "route_back" and "route-back", and status "route-back".
  const seen = new Set<string>();
  for (const transition of projection.transitions ?? []) {
    const type = normalizeStatus(transition?.type);
    const status = normalizeStatus(transition?.status);
    if (!ROUTE_BACK_STATUSES.has(type) && !ROUTE_BACK_STATUSES.has(status)) continue;
    const gateId = transition?.gate_id;
    if (!nonEmpty(gateId)) continue;
    if (nonEmpty(transition?.id)) {
      const key = `${gateId}\u0000${transition.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    add(gateId, 1);
  }
  return counts;
}

export function createGateScorecardProjection(): GateScorecardProjection {
  // Retain the folded inputs so materialize() is a pure replay and the projection
  // is fully rebuildable, matching economics-projection's contract. Keyed by
  // run_id with LAST-WRITE-WINS: a later snapshot of the same run supersedes the
  // earlier one (a run's snapshot is cumulative), which is also what makes a
  // re-ingest of the same run a replace instead of a double-count.
  const runs = new Map<string, FlowProjectionLike>();
  // Projections without a run identity cannot supersede; real ingest validates
  // `run.run_id` upstream, so this list only ever holds direct-API oddities —
  // retained (never silently dropped) but unable to dedup.
  const unidentified: FlowProjectionLike[] = [];

  function apply(projection: FlowProjectionLike): void {
    if (!projection || typeof projection !== "object") return;
    // Defensive deep copy: the caller keeps its mutable reference, and a fold
    // that can be edited after apply() is a fold that can be made to lie.
    const retained = structuredClone(projection) as FlowProjectionLike;
    const runId = retained.run?.run_id;
    if (nonEmpty(runId)) runs.set(runId, retained);
    else unidentified.push(retained);
  }

  function materialize(window: GateScorecardWindow = {}): GateScorecard {
    const since = typeof window.since === "string" && !Number.isNaN(Date.parse(window.since)) ? window.since : null;
    const sinceMs = since === null ? null : Date.parse(since);
    const inWindow = (projection: FlowProjectionLike): boolean => {
      if (sinceMs === null) return true;
      const updatedAt = projection.run?.updated_at;
      // A run that does not say WHEN it ran cannot be silently dropped from the
      // denominator — include it and let the timestamped ones be filtered.
      if (!nonEmpty(updatedAt)) return true;
      const at = Date.parse(updatedAt);
      return Number.isNaN(at) ? true : at >= sinceMs;
    };

    // Per (flow, gate) tallies. Scope is DERIVED: the declared universe comes
    // from the retained projections themselves (every projection lists every
    // declared gate), never from a fleet-wide allow-list.
    const tally = new Map<string, GateScorecardEntry>();
    const runsByFlow = new Map<string, number>();
    // expectation id -> declaring flows (from gates[].expectations[], i.e. from
    // DECLARATIONS — evidence merely naming an id does not make the id yours).
    const expectationOwnersByFlow = new Map<string, Set<string>>();
    const declaredGatesByFlow = new Map<string, Set<string>>();
    const declaredExpectationsByFlow = new Map<string, Set<string>>();
    const findings: GateScorecardFinding[] = [];
    const findingKeys = new Set<string>();
    const pushFinding = (finding: GateScorecardFinding): void => {
      const key = [finding.kind, finding.flow_id, finding.expectation_id ?? "", finding.gate_id ?? "", finding.evidence_id ?? ""].join("\u0000");
      if (findingKeys.has(key)) return;
      findingKeys.add(key);
      findings.push(finding);
    };

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
          flow_id: flow, gate_id: gate, state: "unexercised",
          invocations: 0, refusals: 0, route_backs: 0, withheld: 0, indeterminate: 0, runs_observed: 0,
          cost: null, cost_availability: "unavailable",
        };
        tally.set(k, entry);
      }
      return entry;
    };

    const retained = [...runs.values(), ...unidentified];

    // Pass 1 — declarations, from EVERY retained projection (in-window or not):
    // this is how a flow with no run in the window still surfaces as unexercised,
    // and how expectation ownership is derived for collision/orphan detection.
    for (const projection of retained) {
      const flow = flowIdOf(projection);
      const declaredGates = declaredGatesByFlow.get(flow) ?? new Set<string>();
      const declaredExpectations = declaredExpectationsByFlow.get(flow) ?? new Set<string>();
      for (const gate of projection.gates ?? []) {
        const gateId = gate?.id;
        if (!nonEmpty(gateId)) continue;
        declaredGates.add(gateId);
        ensure(flow, gateId);
        for (const expectation of gate.expectations ?? []) {
          const expectationId = expectation?.id;
          if (!nonEmpty(expectationId)) continue;
          declaredExpectations.add(expectationId);
          const owners = expectationOwnersByFlow.get(expectationId) ?? new Set<string>();
          owners.add(flow);
          expectationOwnersByFlow.set(expectationId, owners);
        }
      }
      declaredGatesByFlow.set(flow, declaredGates);
      declaredExpectationsByFlow.set(flow, declaredExpectations);
    }

    // Pass 2 — activity, from IN-WINDOW runs only.
    for (const projection of retained) {
      if (!inWindow(projection)) continue;
      const flow = flowIdOf(projection);
      const runId = projection.run?.run_id;
      runsByFlow.set(flow, (runsByFlow.get(flow) ?? 0) + 1);

      const invokedThisRun = new Set<string>();
      for (const gate of projection.gates ?? []) {
        const gateId = gate?.id;
        if (!nonEmpty(gateId)) continue;
        const entry = ensure(flow, gateId);
        const status = normalizeStatus(gate.status);
        if (IDLE_STATUSES.has(status)) continue; // no verdict — never an invocation
        if (!gateWasProvablyReached(gate, status)) {
          // A verdict-shaped status with no proof of evaluation. The projection
          // cannot distinguish a lazily computed "block" for an unreached gate
          // from a REAL persisted "block" on an evidence-less gate the run moved
          // past (round-2 finding HIGH-1) — so this is neither a refusal nor
          // never_invoked. It is its own, explicitly indeterminate, number.
          entry.indeterminate += 1;
          continue;
        }
        if (PASS_STATUSES.has(status) || REFUSAL_STATUSES.has(status) || ROUTE_BACK_STATUSES.has(status)) {
          entry.invocations += 1;
          invokedThisRun.add(gateId);
          // One refusal per run, however many refused evidence items the gate
          // carries: the run was refused once.
          if (REFUSAL_STATUSES.has(status) || ROUTE_BACK_STATUSES.has(status)) entry.refusals += 1;
        } else {
          // A PROVEN-evaluated verdict that does not qualify under this fold's
          // vocabulary.
          entry.withheld += 1;
        }
      }

      for (const [gateId, count] of routeBacksByGate(projection)) {
        // A route-back is attributable even when the gate has since recovered.
        ensure(flow, gateId).route_backs += count;
        // A recorded route-back also PROVES the gate evaluated in this run, even
        // when the snapshot's current status no longer shows it (e.g. a cascade
        // cleared the outcome). At most one invocation per run per gate; the
        // historical refusal is NOT re-counted — refusals fold current verdicts,
        // route_backs fold durable events, and conflating them is the HIGH-6
        // double-count in a different coat.
        if (!invokedThisRun.has(gateId)) {
          invokedThisRun.add(gateId);
          ensure(flow, gateId).invocations += 1;
        }
      }

      // Orphan evidence: every expectation id the run's evidence names must be
      // declared by SOME gate of this flow. `evidence[]` is the full manifest
      // (gate-level `gates[].evidence[]` are the same entries filtered), so
      // fold the top level and add any gate-level item not already seen.
      const declaredExpectations = declaredExpectationsByFlow.get(flow) ?? new Set<string>();
      const declaredGates = declaredGatesByFlow.get(flow) ?? new Set<string>();
      const seenEvidenceIds = new Set<string>();
      const evidenceItems: FlowProjectionEvidence[] = [];
      for (const item of projection.evidence ?? []) {
        if (item && typeof item === "object") {
          evidenceItems.push(item);
          if (nonEmpty(item.id)) seenEvidenceIds.add(item.id);
        }
      }
      for (const gate of projection.gates ?? []) {
        for (const item of gate?.evidence ?? []) {
          if (!item || typeof item !== "object") continue;
          if (nonEmpty(item.id) && seenEvidenceIds.has(item.id)) continue;
          if (nonEmpty(item.id)) seenEvidenceIds.add(item.id);
          evidenceItems.push(item);
        }
      }
      for (const item of evidenceItems) {
        for (const expectationId of item.expectation_ids ?? []) {
          if (!nonEmpty(expectationId) || declaredExpectations.has(expectationId)) continue;
          pushFinding({
            kind: "undeclared_expectation",
            flow_id: flow,
            expectation_id: expectationId,
            reason: "evidence names an expectation no gate in this flow declares",
            ...(nonEmpty(item.id) ? { evidence_id: item.id } : {}),
            ...(nonEmpty(item.gate_id) ? { gate_id: item.gate_id } : {}),
            ...(nonEmpty(runId) ? { run_id: runId } : {}),
          });
        }
        const gateId = item.gate_id;
        if (nonEmpty(gateId) && !declaredGates.has(gateId)) {
          pushFinding({
            kind: "undeclared_gate",
            flow_id: flow,
            gate_id: gateId,
            reason: "evidence names a gate the flow does not declare",
            ...(nonEmpty(item.id) ? { evidence_id: item.id } : {}),
            ...(nonEmpty(runId) ? { run_id: runId } : {}),
          });
        }
      }
    }

    // An expectation id DECLARED by more than one flow is a real finding, not
    // noise: a join on it would silently attribute one flow's evidence to another.
    for (const [expectationId, owners] of expectationOwnersByFlow) {
      if (owners.size <= 1) continue;
      for (const flow of owners) {
        pushFinding({
          kind: "expectation_collision",
          flow_id: flow,
          expectation_id: expectationId,
          reason: `expectation id is declared by ${owners.size} flows`,
        });
      }
    }

    for (const entry of tally.values()) {
      entry.runs_observed = runsByFlow.get(entry.flow_id) ?? 0;
      // Precedence: any qualifying verdict makes the gate invoked; a
      // proven-but-non-qualifying verdict alone is withheld; an unprovable
      // verdict alone is indeterminate (it outranks never_invoked because
      // "this gate did not fire" is exactly the claim it cannot support); a
      // flow that ran without this gate producing a verdict is never_invoked;
      // a flow with no run in the window is unexercised. Collapsing the last
      // two buries the single idle gate in the flow that DID run under every
      // gate of every flow that did not.
      if (entry.invocations > 0) entry.state = "invoked";
      else if (entry.withheld > 0) entry.state = "withheld";
      else if (entry.indeterminate > 0) entry.state = "indeterminate";
      else if (entry.runs_observed > 0) entry.state = "never_invoked";
      else entry.state = "unexercised";
    }

    const entries = [...tally.values()].sort((a, b) =>
      a.flow_id === b.flow_id ? a.gate_id.localeCompare(b.gate_id) : a.flow_id.localeCompare(b.flow_id));
    const sortFindings = (a: GateScorecardFinding, b: GateScorecardFinding): number =>
      a.kind.localeCompare(b.kind)
      || a.flow_id.localeCompare(b.flow_id)
      || (a.expectation_id ?? "").localeCompare(b.expectation_id ?? "")
      || (a.gate_id ?? "").localeCompare(b.gate_id ?? "")
      || (a.evidence_id ?? "").localeCompare(b.evidence_id ?? "");

    const observedFlows = new Set<string>();
    let runsFolded = 0;
    for (const [flow, count] of runsByFlow) {
      observedFlows.add(flow);
      runsFolded += count;
    }

    return {
      entries,
      unattributable: findings.sort(sortFindings),
      runs_folded: runsFolded,
      flows_observed: [...observedFlows].sort(),
      window: { since },
    };
  }

  return { apply, materialize };
}
