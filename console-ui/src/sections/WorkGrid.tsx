import { useState } from "react";
import { Panel } from "@kontourai/ui/react";
import type { FlowConsoleProjection } from "@kontourai/flow/console-contract";
import { PipelineStepper } from "../components/PipelineStepper";
import { FlowRunPanel } from "../components/FlowRunPanel";
import { ProcessView } from "../components/ProcessView";
import { ActionRow, ClaimRow, GateRow, LearningRow } from "../components/Rows";
import { DesignedEmpty } from "../components/DesignedEmpty";
import { buildProcessFlow, selectLearningsBySubjectRef, type ConsoleRef, type OperatingState, type Pipeline } from "@kontourai/console-core";

interface WorkGridProps {
  state: OperatingState;
  selectedNodeId: string | null;
  onNodeSelect(id: string | null): void;
  /**
   * Live read-through fetch for a referenced child run's projection
   * (GET /ingest/flow/:runId). Passed to <FlowRunPanel> for drill-in fetch.
   */
  fetchChildProjection?: (runId: string) => Promise<unknown | null>;
}

export function WorkGrid({ state, selectedNodeId, onNodeSelect, fetchChildProjection }: WorkGridProps) {
  const flow = buildProcessFlow(state);
  const activeProcessLearnings = flow.activeProcess
    ? selectLearningsBySubjectRef(state, processRef(flow.activeProcess))
    : [];

  // panToNodeId preserved for potential future canvas re-introduction
  const [panToNodeId, setPanToNodeId] = useState<string | null>(null);
  void panToNodeId;
  void setPanToNodeId;

  // Build a safe Pipeline from state.pipeline if present
  const pipeline = statePipeline(state);

  // Flow's already-derived run projection (read-only pass-through). When present
  // we mount <flow-run-panel> alongside the stepper; the panel itself nests
  // <surface-trust-panel> per evidence bundle. Console never derives this.
  const flowProjection = stateFlowProjection(state);
  const flowChildProjections = stateFlowChildProjections(state);

  function selectByEntityId(kind: string, id: string) {
    const nodeId = `${kind}:${id}`;
    const node = flow.nodes.find((n) => n.id === nodeId);
    if (node) {
      onNodeSelect(selectedNodeId === nodeId ? null : nodeId);
    }
  }

  return (
    <section className="work-grid">
      <section className="flow-panel" aria-label="Primary process flow">
        <div className="section-head">
          <div>
            <p className="section-label">Pipeline</p>
            <h2>{state.currentStage || "Awaiting stage"}</h2>
          </div>
          <p className="receipt">
            {pipeline
              ? `${pipeline.stages.length} stages · ${pipeline.edges.length} edges`
              : `${flow.nodes.length} nodes · ${flow.edges.length} links`}
          </p>
        </div>

        {pipeline ? (
          <PipelineStepper pipeline={pipeline} />
        ) : (
          <DesignedEmpty
            headline="No pipeline data yet"
            body="A flow.pipeline.snapshot event from the Flow run bridge will populate this view."
            command="flow start <definition.json> && kontour-flow-bridge"
          />
        )}

        {flowProjection ? (
          <FlowRunPanel
            projection={flowProjection}
            childProjections={flowChildProjections}
            fetchChildProjection={fetchChildProjection}
          />
        ) : null}
      </section>

      <div className="side-stack">
        <Panel title="Active process" count={flow.activeProcess ? 1 : 0}>
          {flow.activeProcess
            ? <ProcessView process={flow.activeProcess} advisoryLearnings={activeProcessLearnings} />
            : <DesignedEmpty
                headline="Nothing running yet"
                body="An active process will appear here once records are replayed."
              />}
        </Panel>

        <Panel title="Gates" count={state.gates?.length || 0}>
          <div className="stack">
            {(state.gates || []).map((gate) => (
              <button
                key={gate.id}
                type="button"
                className={`data-row-btn${selectedNodeId === `gate:${gate.id}` ? " selected" : ""}`}
                onClick={() => selectByEntityId("gate", gate.id)}
              >
                <GateRow gate={gate} />
              </button>
            ))}
            {!state.gates?.length
              ? <DesignedEmpty
                  headline="No gates replayed."
                  body="Gate records posted to this hub will appear here."
                />
              : null}
          </div>
        </Panel>
      </div>

      <div className="bottom-grid">
        <Panel title="Claims" count={state.claims?.length || 0}>
          <div className="stack">
            {(state.claims || []).map((claim) => (
              <button
                key={claim.id}
                type="button"
                className={`data-row-btn${selectedNodeId === `claim:${claim.id}` ? " selected" : ""}`}
                onClick={() => selectByEntityId("claim", claim.id)}
              >
                <ClaimRow
                  claim={claim}
                  advisoryLearnings={selectLearningsBySubjectRef(state, claim.sourceRef || { product: "surface", kind: "claim", id: claim.id })}
                />
              </button>
            ))}
            {!state.claims?.length
              ? <DesignedEmpty
                  headline="Nothing replayed yet"
                  body="Records posted to this hub will appear here live."
                />
              : null}
          </div>
        </Panel>

        <Panel title="Read-only actions" count={state.actions?.length || 0}>
          <div className="stack">
            {(state.actions || []).map((action) => (
              <button
                key={action.id}
                type="button"
                className={`data-row-btn${selectedNodeId === `action:${action.id}` ? " selected" : ""}`}
                onClick={() => selectByEntityId("action", action.id)}
              >
                <ActionRow action={action} />
              </button>
            ))}
            {!state.actions?.length
              ? <DesignedEmpty
                  headline="No actions available"
                  body="Read-only actions from replayed records will appear here."
                />
              : null}
          </div>
        </Panel>

        <Panel title="Advisory learnings" count={state.learnings?.length || 0}>
          <div className="stack">
            {(state.learnings || []).map((learning) => <LearningRow key={learning.id} learning={learning} />)}
            {!state.learnings?.length
              ? <DesignedEmpty
                  headline="No learning context"
                  body="Advisory learnings from replayed records will appear here."
                />
              : null}
          </div>
        </Panel>
      </div>
    </section>
  );
}

function processRef(process: { id: string; sourceRef?: ConsoleRef }): ConsoleRef {
  return process.sourceRef || { product: "flow", kind: "run", id: process.id };
}

function statePipeline(state: OperatingState): Pipeline | null {
  const raw = state.pipeline;
  if (!raw || typeof raw !== "object") return null;
  // Minimal shape check
  if (!Array.isArray((raw as Pipeline).stages)) return null;
  return raw as Pipeline;
}

// Narrow the read-only Flow projection from OperatingState. console-core carries
// it as `unknown` (no Flow dependency there); the UI boundary owns the type-only
// Flow contract import and validates the minimal shape before mounting the panel.
function stateFlowProjection(state: OperatingState): FlowConsoleProjection | null {
  const raw = state.flowProjection;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as FlowConsoleProjection;
  if (!Array.isArray(candidate.steps) || !Array.isArray(candidate.gates)) return null;
  return candidate;
}

function stateFlowChildProjections(state: OperatingState): Record<string, FlowConsoleProjection> {
  const raw = state.flowChildProjections;
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, FlowConsoleProjection>;
}
