import type { OperatingState } from "@kontour/console-core";
import { Metric } from "@kontourai/console-kit/react";
import { formatTime } from "../utils/format";

export function StageBand({ state }: { state: OperatingState }) {
  return (
    <section className="stage-band" aria-label="Current stage">
      <div>
        <p className="section-label">Current Stage</p>
        <h2>{state.currentStage || "No stage reported."}</h2>
      </div>
      <div className="stage-metrics">
        <Metric label="accepted" value={state.source?.acceptedEventCount ?? 0} />
        <Metric label="duplicates" value={state.source?.duplicateEventCount ?? 0} />
        <Metric label="streams" value={state.source?.streamIds?.length ?? 0} />
        <Metric label="generated" value={formatTime(state.generatedAt)} />
      </div>
    </section>
  );
}
