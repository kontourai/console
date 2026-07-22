import React from "react";
import type { OperatingState } from "@kontourai/console-core";
import { Empty } from "@kontourai/ui/react";
import { deriveBoard, type BoardCard, type BoardColumn } from "./board.js";
import { formatRelative } from "./format.js";
import type { ConsoleIntent, IntentHandler } from "./intent.js";

/**
 * #230 host-mountable Board view — a Kanban of work items (operating-state
 * `processes`) across flow stages, with gate health and #236 blockedReason
 * per card. Pure render over the provided `operatingState`: no fetching, no
 * internal data derivation beyond the synchronous `deriveBoard` projection,
 * no owned selection state. Card selection is exposed as a `ConsoleIntent`
 * through `onIntent` — this component never performs navigation or opens a
 * drill-down itself (see console#231 for authority-bound intent handling).
 *
 * `onIntent` left unbound renders every card inert: a plain, non-interactive
 * list item, never a fake button for an action nobody is listening for. This
 * is the same component the bundled Console app mounts (see
 * `sections/BoardSection.tsx`), which supplies `onIntent` to open its own
 * work-item drill-down — that wiring lives in the app, not in this package.
 *
 * Every class this component renders is styled by this package's own
 * `./board.css` export (`lib/src/board-view.css`) — none of it depends on
 * the bundled Console app's global `styles.css` (`.section-head`,
 * `.section-label`, `.receipt`, bare `h2`), so a host mounting only
 * `BoardView` + `@kontourai/ui`'s tokens/react stylesheets gets the intended
 * look with no additional app-only CSS to guess at.
 */

/** `ConsoleIntent.kind` emitted when a card is selected (readOnly — a view request, not a write). */
export const BOARD_SELECT_CARD_INTENT = "board.select-card";

export interface BoardViewProps {
  operatingState: OperatingState;
  onIntent?: IntentHandler;
  /** Host-controlled highlight for the currently-open card (e.g. an open
   *  drill-down elsewhere in the host's own UI) — purely presentational; this
   *  component does not track selection itself. */
  selectedCardId?: string | null;
  /**
   * Fixed reference clock (epoch ms) for rendering each card's relative
   * "updated" time deterministically — e.g. a server-side render snapshot, or
   * a test. Defaults to the real wall clock (`Date.now()`, read fresh on
   * every render) when omitted, matching the app's live behavior. Every
   * relative-time node also carries a static `dateTime` attribute (the raw
   * ISO string), so even if a client hydrates with a different `now` than
   * the server used, only the human-readable label text can mismatch — the
   * machine-readable value never does.
   */
  now?: number;
}

export function BoardView({ operatingState, onIntent, selectedCardId = null, now }: BoardViewProps) {
  const board = deriveBoard(operatingState);

  return (
    <section className="board-section" aria-label="Board">
      <div className="board-head">
        <div>
          <p className="board-eyebrow">Board</p>
          <h2 className="board-title">Work in flight</h2>
        </div>
        <p className="board-receipt">
          {board.totalCards} item{board.totalCards === 1 ? "" : "s"} in flight
        </p>
      </div>

      {board.totalCards === 0 ? (
        <Empty label="No work items in flight — cards appear as Builder runs post flow state." />
      ) : (
        <div className="board-columns" role="list" aria-label="Flow stages">
          {board.columns.map((column) => (
            <BoardStageColumn key={column.stage} column={column} selectedId={selectedCardId} onIntent={onIntent} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

function BoardStageColumn({
  column,
  selectedId,
  onIntent,
  now
}: {
  column: BoardColumn;
  selectedId: string | null;
  onIntent?: IntentHandler;
  now?: number;
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
            <BoardCardView key={card.id} card={card} selected={card.id === selectedId} onIntent={onIntent} now={now} />
          ))}
        </ul>
      ) : (
        <p className="board-column-empty">—</p>
      )}
    </div>
  );
}

/** The ConsoleAction-shaped intent a card selection emits (console#230/#231 seam). */
export function boardCardSelectIntent(card: BoardCard): ConsoleIntent {
  return {
    id: `${BOARD_SELECT_CARD_INTENT}:${card.id}`,
    kind: BOARD_SELECT_CARD_INTENT,
    label: `Open ${card.title}`,
    readOnly: true,
    authority: { product: "console", command: BOARD_SELECT_CARD_INTENT },
    subjectRefs: [{ product: "console", kind: "process", id: card.id, label: card.title }]
  };
}

function BoardCardView({
  card,
  selected,
  onIntent,
  now
}: {
  card: BoardCard;
  selected: boolean;
  onIntent?: IntentHandler;
  now?: number;
}) {
  const pct = typeof card.percentComplete === "number" ? Math.max(0, Math.min(100, card.percentComplete)) : null;
  const meta = (
    <>
      <p className="board-card-title" title={card.title}>{card.title}</p>
      {card.stepLabel ? <p className="board-card-step">{card.stepLabel}</p> : null}
      {pct != null ? (
        <div
          className="board-card-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% complete`}
        >
          <span className="board-card-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {card.blockedReason ? <p className="board-card-blocked-reason">{card.blockedReason}</p> : null}
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
        {card.updatedAt ? (
          <time className="board-card-time" dateTime={card.updatedAt}>
            {formatRelative(card.updatedAt, now)}
          </time>
        ) : null}
      </div>
    </>
  );

  // When no one is listening for the selection intent, the card renders as a
  // plain, non-interactive card — no fake affordance for an action nobody can
  // receive.
  if (!onIntent) {
    return <li className="board-card">{meta}</li>;
  }
  return (
    <li className="board-card">
      <button
        type="button"
        className={`board-card-button${selected ? " selected" : ""}`}
        aria-pressed={selected}
        onClick={() => onIntent(boardCardSelectIntent(card))}
      >
        {meta}
      </button>
    </li>
  );
}
