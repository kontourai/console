import { Empty } from "../components/Empty";
import { Panel } from "../components/Panel";
import { ProcessView } from "../components/ProcessView";
import { ActionRow, ClaimRow, GateRow } from "../components/Rows";
import { selectActiveProcess } from "../utils/selectActiveProcess";
import type { OperatingState } from "../types";

export function WorkGrid({ state }: { state: OperatingState }) {
  const activeProcess = selectActiveProcess(state.processes || []);

  return (
    <section className="work-grid">
      <Panel title="Active Process" count={activeProcess ? 1 : 0}>
        {activeProcess ? <ProcessView process={activeProcess} /> : <Empty label="No active process." />}
      </Panel>

      <Panel title="Gates" count={state.gates?.length || 0}>
        <div className="stack">
          {(state.gates || []).map((gate) => <GateRow key={gate.id} gate={gate} />)}
          {!state.gates?.length ? <Empty label="No gates replayed." /> : null}
        </div>
      </Panel>

      <Panel title="Claims" count={state.claims?.length || 0}>
        <div className="stack">
          {(state.claims || []).map((claim) => <ClaimRow key={claim.id} claim={claim} />)}
          {!state.claims?.length ? <Empty label="No claims replayed." /> : null}
        </div>
      </Panel>

      <Panel title="Read-Only Actions" count={state.actions?.length || 0}>
        <div className="stack">
          {(state.actions || []).map((action) => <ActionRow key={action.id} action={action} />)}
          {!state.actions?.length ? <Empty label="No inert actions available." /> : null}
        </div>
      </Panel>
    </section>
  );
}
