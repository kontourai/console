import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OperatingState, ConsoleProcess } from "@kontourai/console-core";
import { BoardView, boardCardSelectIntent, BOARD_SELECT_CARD_INTENT } from "../lib/src/BoardView";
import type { BoardCard } from "../lib/src/board";

// #230 component-render contract: (operatingState, onIntent?) in, DOM out.
// `renderToStaticMarkup` (no jsdom/testing-library in this repo — see
// test/fleetSection.test.ts for the same convention) strips event handlers,
// so DOM-out assertions cover markup shape/content; the intent PAYLOAD a
// click would emit is covered directly against `boardCardSelectIntent`
// below. The full click → intent → drill-down wire-up is additionally
// covered end-to-end in tests/browser/console-ui.spec.ts ("renders the Board
// tab").

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function state(input: Partial<OperatingState>): OperatingState {
  return input as OperatingState;
}

function render(props: Parameters<typeof BoardView>[0]): string {
  return renderToStaticMarkup(React.createElement(BoardView, props));
}

test("BoardView: state in, DOM out — five stage columns, cards grouped and counted", () => {
  const markup = render({
    operatingState: state({
      processes: [
        proc({ id: "p1", label: "Plan the survey", currentStep: "plan" }),
        proc({ id: "p2", label: "Ship the release", currentStep: "release" })
      ]
    })
  });
  assert.match(markup, /Work in flight/);
  assert.match(markup, /2 items in flight/);
  assert.match(markup, /board-column-planning/);
  assert.match(markup, /Plan the survey/);
  assert.match(markup, /board-column-in-flight/);
  assert.match(markup, /Ship the release/);
});

test("BoardView: renders #236 interactive-session states in an active stage, with blockedReason", () => {
  const markup = render({
    operatingState: state({
      processes: [
        proc({ id: "p1", label: "Stalled session", status: "needs_input", blockedReason: "Waiting on operator input." }),
        proc({ id: "p2", label: "Review pending", status: "review_pending" })
      ]
    })
  });
  assert.match(markup, /board-column-in-flight[\s\S]*Stalled session/);
  assert.match(markup, /Waiting on operator input\./);
  assert.match(markup, /board-column-verify[\s\S]*Review pending/);
});

test("BoardView: empty operating state renders the honest empty state, not fake columns", () => {
  const markup = render({ operatingState: state({}) });
  assert.match(markup, /class="empty"/);
  assert.match(markup, /No work items in flight/);
  assert.doesNotMatch(markup, /board-columns/);
});

test("BoardView: unbound onIntent renders every card inert — no button, no fake affordance", () => {
  const markup = render({
    operatingState: state({ processes: [proc({ id: "p1", label: "Untouchable", currentStep: "execute" })] })
  });
  assert.match(markup, /Untouchable/);
  assert.doesNotMatch(markup, /<button/);
  assert.doesNotMatch(markup, /board-card-button/);
});

test("BoardView: bound onIntent renders cards as buttons, honoring selectedCardId", () => {
  const markup = render({
    operatingState: state({ processes: [proc({ id: "p1", label: "Selectable", currentStep: "execute" })] }),
    onIntent: () => {},
    selectedCardId: "p1"
  });
  assert.match(markup, /<button[^>]*class="board-card-button selected"/);
  assert.match(markup, /aria-pressed="true"/);
});

test("boardCardSelectIntent: emits a ConsoleAction-shaped, readOnly select intent for the card", () => {
  const card: BoardCard = {
    id: "run-abc",
    runId: "abc",
    title: "Survey claim review",
    stage: "verify",
    gatesPassed: 1,
    gatesBlocked: 0
  };
  const intent = boardCardSelectIntent(card);
  assert.equal(intent.kind, BOARD_SELECT_CARD_INTENT);
  assert.equal(intent.id, `${BOARD_SELECT_CARD_INTENT}:run-abc`);
  assert.equal(intent.readOnly, true);
  assert.deepEqual(intent.authority, { product: "console", command: BOARD_SELECT_CARD_INTENT });
  assert.deepEqual(intent.subjectRefs, [{ product: "console", kind: "process", id: "run-abc", label: "Survey claim review" }]);
});
