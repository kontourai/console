import { useEffect, useState } from "react";
import type { FlowConsoleProjection } from "@kontourai/flow/console-contract";
import { FlowRunPanel } from "../../components/FlowRunPanel";
import { Empty } from "@kontourai/ui/react";
import type { BoardCard } from "./board";

/**
 * #178 work-item drill-down. Clicking a board card fetches that run's Flow
 * projection (GET /ingest/flow/:runId, keyed by the bare runId) and renders its
 * flow-position graph, gates, and evidence via the shared <FlowRunPanel>. The
 * card → runId mapping is deterministic (board.ts runIdFromProcessId), so this
 * is real navigation, not a best-effort join.
 *
 * Honestly scoped: the per-item model/token/cost roll-up and the live agent
 * list that #178 also envisions depend on substrate that isn't populated yet
 * (telemetry carries no task_slug to join cost; live presence needs the verified
 * liveness↔process id mapping deferred in #177) — so this slice ships the flow
 * position + gates + evidence that ARE reliably available, and states the rest
 * as pending rather than fabricating it.
 */
export function BoardDrilldown({
  card,
  fetchProjection,
  onClose
}: {
  card: BoardCard;
  fetchProjection: (runId: string) => Promise<unknown | null>;
  onClose: () => void;
}) {
  const [projection, setProjection] = useState<FlowConsoleProjection | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setProjection(null);
    fetchProjection(card.runId)
      .then((result) => {
        if (cancelled) return;
        if (result && typeof result === "object") {
          setProjection(result as FlowConsoleProjection);
          setStatus("ready");
        } else {
          setStatus("empty");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [card.runId, fetchProjection]);

  return (
    <section className="board-drilldown" aria-label={`Work item ${card.title}`}>
      <div className="board-drilldown-head">
        <div>
          <p className="section-label">Work item</p>
          <h3 className="board-drilldown-title">{card.title}</h3>
          <p className="board-drilldown-run">run {card.runId}</p>
        </div>
        <button type="button" className="board-drilldown-close" onClick={onClose} aria-label="Close work item">
          Close
        </button>
      </div>

      {status === "loading" ? (
        <p className="board-drilldown-status">Loading flow projection…</p>
      ) : status === "error" ? (
        <Empty label="Could not load this run's flow projection. It may be unavailable on the hub." />
      ) : status === "empty" ? (
        <Empty label="No flow projection recorded for this run yet — the flow graph appears once the run posts one." />
      ) : projection ? (
        <FlowRunPanel projection={projection} fetchChildProjection={fetchProjection} />
      ) : null}

      <p className="board-drilldown-note">
        Model/token/cost roll-up and the live agent list are pending emitter substrate (task attribution and a verified liveness mapping).
      </p>
    </section>
  );
}
