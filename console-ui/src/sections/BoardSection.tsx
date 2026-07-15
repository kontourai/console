import { useMemo, useState } from "react";
import type { OperatingState } from "@kontourai/console-core";
import { Empty } from "@kontourai/ui/react";
import { formatRelative } from "../utils/format";
import { deriveBoard, type BoardCard, type BoardColumn } from "./board/board";
import { BoardDrilldown } from "./board/BoardDrilldown";

/**
 * #177 Board — the high-level front door. A Kanban of work items in flight,
 * grouped by flow stage, with gate health per card. Clicking a card opens the
 * work-item drill-down (#178). Single-tenant for now: the Me / Team /
 * Everyone-live filter waits on per-user identity (#98/#159), and live agent
 * presence per card waits on a verified liveness↔process id mapping (see
 * board.ts) — both intentionally absent rather than faked.
 */
export function BoardSection({
  state,
  fetchProjection
}: {
  state: OperatingState;
  fetchProjection?: (runId: string) => Promise<unknown | null>;
}) {
  const board = useMemo(() => deriveBoard(state), [state]);
  const [selected, setSelected] = useState<BoardCard | null>(null);

  // Keep the selected card in sync with the latest projection (its stage/gates
  // may change); drop it if the work item leaves the board entirely.
  const selectedCard = selected
    ? board.columns.flatMap((column) => column.cards).find((card) => card.id === selected.id) ?? null
    : null;

  return (
    <section className="board-section" aria-label="Board">
      <div className="section-head">
        <div>
          <p className="section-label">Board</p>
          <h2>Work in flight</h2>
        </div>
        <p className="receipt">
          {board.totalCards} item{board.totalCards === 1 ? "" : "s"} in flight
        </p>
      </div>

      {board.totalCards === 0 ? (
        <Empty label="No work items in flight — cards appear as Builder runs post flow state." />
      ) : (
        <div className="board-columns" role="list" aria-label="Flow stages">
          {board.columns.map((column) => (
            <BoardStageColumn
              key={column.stage}
              column={column}
              selectedId={selectedCard?.id ?? null}
              onSelect={fetchProjection ? setSelected : undefined}
            />
          ))}
        </div>
      )}

      {selectedCard && fetchProjection ? (
        <BoardDrilldown card={selectedCard} fetchProjection={fetchProjection} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}

function BoardStageColumn({
  column,
  selectedId,
  onSelect
}: {
  column: BoardColumn;
  selectedId: string | null;
  onSelect?: (card: BoardCard) => void;
}) {
  return (
    <div className={`board-column board-column-${column.stage}`} role="listitem" aria-label={column.label}>
      <div className="board-column-head">
        <span className="board-column-label">{column.label}</span>
        <span className="board-column-count">{column.cards.length}</span>
      </div>
      {column.cards.length > 0 ? (
        <ul className="board-cards">
          {column.cards.map((card) => (
            <BoardCardView key={card.id} card={card} selected={card.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      ) : (
        <p className="board-column-empty">—</p>
      )}
    </div>
  );
}

function BoardCardView({
  card,
  selected,
  onSelect
}: {
  card: BoardCard;
  selected: boolean;
  onSelect?: (card: BoardCard) => void;
}) {
  const pct = typeof card.percentComplete === "number" ? Math.max(0, Math.min(100, card.percentComplete)) : null;
  const meta = (
    <>
      <p className="board-card-title" title={card.title}>{card.title}</p>
      {card.stepLabel ? <p className="board-card-step">{card.stepLabel}</p> : null}
      {pct != null ? (
        <div className="board-card-progress" title={`${pct}%`}>
          <span className="board-card-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="board-card-meta">
        {card.gatesPassed > 0 ? (
          <span className="board-card-gate board-card-gate-passed" aria-label={`${card.gatesPassed} gate${card.gatesPassed === 1 ? "" : "s"} passed`}>
            {card.gatesPassed} <span aria-hidden="true">✓</span>
          </span>
        ) : null}
        {card.gatesBlocked > 0 ? (
          <span className="board-card-gate board-card-gate-blocked" aria-label={`${card.gatesBlocked} gate${card.gatesBlocked === 1 ? "" : "s"} blocked`}>
            {card.gatesBlocked} <span aria-hidden="true">✗</span>
          </span>
        ) : null}
        {card.updatedAt ? <span className="board-card-time">{formatRelative(card.updatedAt)}</span> : null}
      </div>
    </>
  );

  // When drill-down is available the whole card is a button; otherwise it's a
  // plain, non-interactive card (no fake affordance).
  if (!onSelect) {
    return <li className="board-card">{meta}</li>;
  }
  return (
    <li className="board-card">
      <button
        type="button"
        className={`board-card-button${selected ? " selected" : ""}`}
        aria-pressed={selected}
        onClick={() => onSelect(card)}
      >
        {meta}
      </button>
    </li>
  );
}
