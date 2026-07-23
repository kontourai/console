import React, { useEffect, useMemo, useRef, useState } from "react";
import type { FlowConsoleProjection } from "@kontourai/flow/console-contract";
import type { OperatingState } from "@kontourai/console-core";
import { FlowRunPanel, asChildProjection } from "../../components/FlowRunPanel";
import { Empty } from "@kontourai/ui/react";
import { deriveRunDetail } from "./deriveRunDetail";
import { RunDetailView } from "./RunDetailView";

/**
 * #178 work-item drill-down, generalized by #253 into the run's genuine
 * flow-position answer: clicking a board card (or a direct `/run/:id` load,
 * console#252) now shows a stage strip with the current position
 * highlighted, a clickable gate history (the click-path #255's trust panel
 * lands on), a recent timeline slice, and header extras (freshness,
 * blockedReason, source-of-truth link-outs) — via `deriveRunDetail`
 * (sections/board/deriveRunDetail.ts) — alongside the existing Flow
 * projection panel this component already rendered.
 *
 * `state` is threaded straight through and re-derived on every render (no
 * local caching), so SSE-driven updates (console#252) flow into the drill-
 * down with no extra plumbing. An unknown/stale `processId` (a run that has
 * left the current operating state — completed and pruned, or simply a bad
 * id) renders an honest "not found" panel rather than a stale or fabricated
 * one; it never crashes.
 *
 * Honestly scoped: the per-item model/token/cost roll-up and the live agent
 * list that #178 also envisions depend on substrate that isn't populated yet
 * (telemetry carries no task_slug to join cost; live presence needs the verified
 * liveness↔process id mapping deferred in #177) — so this slice ships the flow
 * position + gates + evidence that ARE reliably available, and states the rest
 * as pending rather than fabricating it.
 */
export function BoardDrilldown({
  processId,
  state,
  fetchProjection,
  onClose,
  now
}: {
  processId: string;
  state: OperatingState;
  fetchProjection: (runId: string) => Promise<unknown | null>;
  onClose: () => void;
  now?: number;
}) {
  const clock = now ?? Date.now();
  const detail = useMemo(() => deriveRunDetail(state, processId, clock), [state, processId, clock]);

  const [projection, setProjection] = useState<FlowConsoleProjection | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  // Read the fetcher through a ref so the fetch effect keys only on the selected
  // runId, not on the fetcher's identity — the parent recreates it on every
  // SSE-driven re-render, which would otherwise blank + refetch the open panel
  // on every incoming event.
  const fetchRef = useRef(fetchProjection);
  fetchRef.current = fetchProjection;

  const runId = detail?.runId ?? null;

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setStatus("loading");
    setProjection(null);
    fetchRef.current(runId)
      .then((result) => {
        if (cancelled) return;
        // Guard the exact shape <flow-run-panel> iterates (run.run_id + steps +
        // gates arrays); a stored projection can satisfy the ingest validator
        // (run.run_id only) yet lack these — treat a shape miss as empty, not a
        // crash in the custom element.
        const valid = asChildProjection(result);
        if (valid) {
          setProjection(valid);
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
  }, [runId]);

  return (
    <section className="board-drilldown" aria-label={detail ? `Work item ${detail.title}` : "Run detail"}>
      <div className="board-drilldown-head">
        <div>
          <p className="section-label">Work item</p>
          {detail ? (
            <>
              <h3 className="board-drilldown-title">{detail.title}</h3>
              <p className="board-drilldown-run">run {detail.runId}</p>
            </>
          ) : (
            <h3 className="board-drilldown-title">Run {processId}</h3>
          )}
        </div>
        <button type="button" className="board-drilldown-close" onClick={onClose} aria-label="Close work item">
          Close
        </button>
      </div>

      {!detail ? (
        <Empty label="Run not found in current operating state — it may have completed and been pruned, or the id is stale." />
      ) : (
        <>
          <RunDetailView detail={detail} now={clock} />

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
        </>
      )}
    </section>
  );
}
