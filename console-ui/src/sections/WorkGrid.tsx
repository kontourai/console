import { useState } from "react";
import { Empty, Panel } from "@kontourai/console-kit/react";
import { FlowCanvas } from "../components/FlowCanvas";
import { NodeDetailDrawer } from "../components/NodeDetailDrawer";
import { ProcessView } from "../components/ProcessView";
import { ActionRow, ClaimRow, GateRow, LearningRow } from "../components/Rows";
import { buildProcessFlow, selectLearningsBySubjectRef, type ConsoleRef, type OperatingState } from "@kontourai/console-core";

interface WorkGridProps {
  state: OperatingState;
  selectedNodeId: string | null;
  onNodeSelect(id: string | null): void;
}

export function WorkGrid({ state, selectedNodeId, onNodeSelect }: WorkGridProps) {
  const flow = buildProcessFlow(state);
  const activeProcessLearnings = flow.activeProcess
    ? selectLearningsBySubjectRef(state, processRef(flow.activeProcess))
    : [];

  // panToNodeId is set only when selection originates from a side-panel row.
  // Canvas-click selections leave panToNodeId unchanged so the view does not
  // re-pan to a node that is already visible.
  const [panToNodeId, setPanToNodeId] = useState<string | null>(null);

  // Called by side-panel buttons only.
  function selectByEntityId(kind: string, id: string) {
    const nodeId = `${kind}:${id}`;
    const node = flow.nodes.find((n) => n.id === nodeId);
    if (node) {
      const next = selectedNodeId === nodeId ? null : nodeId;
      onNodeSelect(next);
      // Only request a pan when we are actually selecting (not deselecting).
      setPanToNodeId(next);
    }
  }

  // Called by the canvas when a node is clicked directly.
  // We deliberately do NOT update panToNodeId here.
  function handleCanvasSelect(id: string | null) {
    onNodeSelect(id);
  }

  return (
    <section className="work-grid">
      <section className="flow-panel" aria-label="Primary process flow">
        <div className="section-head">
          <div>
            <p className="section-label">Process Flow</p>
            <h2>{state.currentStage || "Awaiting stage"}</h2>
          </div>
          <p className="receipt">{flow.nodes.length} nodes · {flow.edges.length} links</p>
        </div>
        <FlowCanvas
          nodes={flow.nodes}
          edges={flow.edges}
          selectedNodeId={selectedNodeId}
          panToNodeId={panToNodeId}
          onNodeSelect={handleCanvasSelect}
        />
        <NodeDetailDrawer
          nodeId={selectedNodeId}
          nodes={flow.nodes}
          state={state}
          onClose={() => onNodeSelect(null)}
        />
      </section>

      <div className="side-stack">
        <Panel title="Active Process" count={flow.activeProcess ? 1 : 0}>
          {flow.activeProcess
            ? <ProcessView process={flow.activeProcess} advisoryLearnings={activeProcessLearnings} />
            : <Empty label="No active process." />}
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
            {!state.gates?.length ? <Empty label="No gates replayed." /> : null}
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
            {!state.claims?.length ? <Empty label="No claims replayed." /> : null}
          </div>
        </Panel>

        <Panel title="Read-Only Actions" count={state.actions?.length || 0}>
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
            {!state.actions?.length ? <Empty label="No inert actions available." /> : null}
          </div>
        </Panel>

        <Panel title="Advisory Learnings" count={state.learnings?.length || 0}>
          <div className="stack">
            {(state.learnings || []).map((learning) => <LearningRow key={learning.id} learning={learning} />)}
            {!state.learnings?.length ? <Empty label="No advisory learning context." /> : null}
          </div>
        </Panel>
      </div>
    </section>
  );
}

function processRef(process: { id: string; sourceRef?: ConsoleRef }): ConsoleRef {
  return process.sourceRef || { product: "flow", kind: "run", id: process.id };
}
