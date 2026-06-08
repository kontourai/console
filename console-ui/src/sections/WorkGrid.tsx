import { Empty, Panel } from "@kontourai/console-kit/react";
import { ProcessFlowDiagram } from "../components/ProcessFlowDiagram";
import { ProcessView } from "../components/ProcessView";
import { ActionRow, ClaimRow, GateRow, LearningRow } from "../components/Rows";
import { buildProcessFlow, selectLearningsBySubjectRef, type ConsoleRef, type OperatingState } from "@kontour/console-core";

export function WorkGrid({ state }: { state: OperatingState }) {
  const flow = buildProcessFlow(state);
  const activeProcessLearnings = flow.activeProcess
    ? selectLearningsBySubjectRef(state, processRef(flow.activeProcess))
    : [];

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
        <ProcessFlowDiagram nodes={flow.nodes} edges={flow.edges} />
      </section>

      <div className="side-stack">
        <Panel title="Active Process" count={flow.activeProcess ? 1 : 0}>
          {flow.activeProcess
            ? <ProcessView process={flow.activeProcess} advisoryLearnings={activeProcessLearnings} />
            : <Empty label="No active process." />}
        </Panel>

        <Panel title="Gates" count={state.gates?.length || 0}>
          <div className="stack">
            {(state.gates || []).map((gate) => <GateRow key={gate.id} gate={gate} />)}
            {!state.gates?.length ? <Empty label="No gates replayed." /> : null}
          </div>
        </Panel>
      </div>

      <div className="bottom-grid">
        <Panel title="Claims" count={state.claims?.length || 0}>
          <div className="stack">
            {(state.claims || []).map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                advisoryLearnings={selectLearningsBySubjectRef(state, claim.sourceRef || { product: "surface", kind: "claim", id: claim.id })}
              />
            ))}
            {!state.claims?.length ? <Empty label="No claims replayed." /> : null}
          </div>
        </Panel>

        <Panel title="Read-Only Actions" count={state.actions?.length || 0}>
          <div className="stack">
            {(state.actions || []).map((action) => <ActionRow key={action.id} action={action} />)}
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
