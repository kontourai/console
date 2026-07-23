import React, { useMemo, useState } from "react";
import type { OperatingState } from "@kontourai/console-core";
import { BOARD_SELECT_CARD_INTENT, BoardView, deriveBoard, type BoardCard, type ConsoleIntent } from "@kontourai/console-ui";
import { BoardDrilldown } from "./board/BoardDrilldown";

/**
 * #177 Board — the high-level front door. Wraps the published, pure
 * `BoardView` component (`lib/src/BoardView.tsx`, also the host-mountable
 * `@kontourai/console-ui` export) with this app's own work-item drill-down
 * (#178): BoardView never fetches, so opening a card's Flow projection is
 * wired here via `onIntent`, not inside the shared component. Single-tenant
 * for now: the Me / Team / Everyone-live filter waits on per-user identity
 * (#98/#159), and live agent presence per card waits on a verified liveness↔
 * process id mapping (see lib/src/board.ts) — both intentionally absent
 * rather than faked.
 *
 * console#252: `selectedId`/`onSelectedIdChange` are an OPTIONAL controlled
 * pair so App can drive the selection from (and sync it back to) the
 * `/run/:id` route — a card's id is the underlying process id (board.ts),
 * matching the route's `:id` segment 1:1. Omitting both props keeps the
 * original uncontrolled behavior.
 *
 * console#253: the drill-down now opens for ANY non-null `selectedId` — not
 * only ids that resolve to a rendered board card — so a `/run/:id` deep link
 * whose process has left the current operating state (completed and pruned,
 * or simply a stale/bad id) shows an honest "not found" panel instead of
 * silently rendering nothing (BoardDrilldown / deriveRunDetail own that
 * distinction). `state` is passed straight through so the drill-down's own
 * stage/gate/timeline derivation re-runs on every SSE-driven re-render, with
 * no separate fetch or local cache to go stale.
 */
export function BoardSection({
  state,
  fetchProjection,
  selectedId: controlledSelectedId,
  onSelectedIdChange,
  now,
}: {
  state: OperatingState;
  fetchProjection?: (runId: string) => Promise<unknown | null>;
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  /** Fixed reference clock (epoch ms) for the drill-down's freshness/relative-
   *  time rendering — e.g. a test. Defaults to the live wall clock. */
  now?: number;
}) {
  const board = useMemo(() => deriveBoard(state), [state]);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;

  function setSelectedId(id: string | null) {
    if (onSelectedIdChange) onSelectedIdChange(id);
    else setInternalSelectedId(id);
  }

  // Keep the selected card in sync with the latest projection (its stage/gates
  // may change); a card that has left the board entirely (e.g. via #253's
  // /run/:id deep link to a stale id) simply has no card here — the highlight
  // prop below tolerates that, and BoardDrilldown renders its own honest
  // "not found" state independent of whether a card was found.
  const selectedCard: BoardCard | null = selectedId
    ? board.columns.flatMap((column) => column.cards).find((card) => card.id === selectedId) ?? null
    : null;

  function handleIntent(intent: ConsoleIntent) {
    if (intent.kind !== BOARD_SELECT_CARD_INTENT) return;
    setSelectedId(intent.subjectRefs?.[0]?.id ?? null);
  }

  return (
    <>
      <BoardView
        operatingState={state}
        onIntent={fetchProjection ? handleIntent : undefined}
        selectedCardId={selectedCard?.id ?? null}
        now={now}
      />
      {selectedId && fetchProjection ? (
        <BoardDrilldown
          processId={selectedId}
          state={state}
          fetchProjection={fetchProjection}
          onClose={() => setSelectedId(null)}
          now={now}
        />
      ) : null}
    </>
  );
}
