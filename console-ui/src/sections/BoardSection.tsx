import { useMemo } from "react";
import type { OperatingState } from "@kontourai/console-core";
import { Empty } from "@kontourai/ui/react";
import { formatRelative } from "../utils/format";
import { deriveBoard, type BoardCard, type BoardColumn } from "./board/board";

/**
 * #177 Board — the high-level front door. A Kanban of work items in flight,
 * grouped by flow stage, with live agent presence per card. Single-tenant for
 * now: the Me / Team / Everyone-live filter waits on per-user identity
 * (#98/#159) and is intentionally absent rather than faked against a shared
 * token. Card → drill-down (#178) is not wired yet.
 */
export function BoardSection({ state }: { state: OperatingState }) {
  const board = useMemo(() => deriveBoard(state), [state]);

  return (
    <section className="board-section" aria-label="Board">
      <div className="section-head">
        <div>
          <p className="section-label">Board</p>
          <h2>Work in flight</h2>
        </div>
        <p className="receipt">
          {board.totalCards} item{board.totalCards === 1 ? "" : "s"}
          {board.liveAgentTotal > 0 ? ` · ${board.liveAgentTotal} live agent${board.liveAgentTotal === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      {board.totalCards === 0 ? (
        <Empty label="No work items in flight — cards appear as Builder runs post flow state." />
      ) : (
        <div className="board-columns" role="list" aria-label="Flow stages">
          {board.columns.map((column) => (
            <BoardStageColumn key={column.stage} column={column} />
          ))}
        </div>
      )}
    </section>
  );
}

function BoardStageColumn({ column }: { column: BoardColumn }) {
  return (
    <div className={`board-column board-column-${column.stage}`} role="listitem" aria-label={column.label}>
      <div className="board-column-head">
        <span className="board-column-label">{column.label}</span>
        <span className="board-column-count">{column.cards.length}</span>
      </div>
      {column.cards.length > 0 ? (
        <ul className="board-cards">
          {column.cards.map((card) => (
            <BoardCardView key={card.id} card={card} />
          ))}
        </ul>
      ) : (
        <p className="board-column-empty">—</p>
      )}
    </div>
  );
}

function BoardCardView({ card }: { card: BoardCard }) {
  const pct = typeof card.percentComplete === "number" ? Math.max(0, Math.min(100, card.percentComplete)) : null;
  return (
    <li className="board-card">
      <p className="board-card-title" title={card.title}>{card.title}</p>
      {card.stepLabel ? <p className="board-card-step">{card.stepLabel}</p> : null}
      {pct != null ? (
        <div className="board-card-progress" title={`${pct}%`}>
          <span className="board-card-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="board-card-meta">
        {card.liveAgentCount > 0 ? (
          <span className="board-card-live" title={`${card.liveAgentCount} live agent${card.liveAgentCount === 1 ? "" : "s"}`}>
            <span className="board-card-live-dot" aria-hidden="true" />
            {card.liveAgentCount} live
          </span>
        ) : null}
        {card.gatesPassed > 0 ? <span className="board-card-gate board-card-gate-passed">{card.gatesPassed} ✓</span> : null}
        {card.gatesBlocked > 0 ? <span className="board-card-gate board-card-gate-blocked">{card.gatesBlocked} ✗</span> : null}
        {card.updatedAt ? <span className="board-card-time">{formatRelative(card.updatedAt)}</span> : null}
      </div>
    </li>
  );
}
