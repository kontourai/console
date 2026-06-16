/**
 * The shared three-lane harness.
 *
 * For each scenario it runs the SAME three lanes, declaratively:
 *
 *   1. RAW       — returns the scenario's confident answer, no grounding, no gate.
 *   2. RAG       — real retrieve + real fact-check (rag-baseline.ts); ships the bad answer.
 *   3. KONTOUR   — the scenario's groundAndGate() — real buildSurveyTrustBundle + real gate.
 *
 * The harness adds NO scenario-specific logic. Each scenario's distinct mechanism lives
 * in its groundAndGate predicate; the harness just invokes the lanes and records verdicts.
 *
 * The proof the demo asserts, per scenario:
 *   - RAG.passed === true   (a fair baseline ships the wrong answer)
 *   - KONTOUR.outcome === "block"  (the structural gate catches it)
 */

import { runRagLane } from "./rag-baseline.js";
import type { RagLaneResult } from "./rag-baseline.js";
import type { GateOutcome } from "./gate.js";
import type { Scenario } from "./scenarios.js";

export interface RawLaneResult {
  kind: "raw";
  answer: number;
}

export interface LaneResults {
  scenario: Scenario;
  raw: RawLaneResult;
  rag: RagLaneResult;
  kontour: GateOutcome;
}

export function runScenario(scenario: Scenario): LaneResults {
  const raw: RawLaneResult = { kind: "raw", answer: scenario.rawAnswer };

  const rag = runRagLane(
    scenario.query,
    scenario.ragCandidate,
    scenario.subjectTerms,
    scenario.shipOnAbstain,
    scenario.ragJoin
  );

  // The Kontour lane: real grounding + real structural gate. No threshold.
  const kontour = scenario.groundAndGate();

  return { scenario, raw, rag, kontour };
}

export function runAll(scenarios: Scenario[]): LaneResults[] {
  return scenarios.map(runScenario);
}
