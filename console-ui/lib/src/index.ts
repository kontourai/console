/**
 * `@kontourai/console-ui` published components entry (console#230). Host apps
 * mount these views by feeding a locally-built `OperatingState`
 * (`@kontourai/console-core`) and optionally binding `onIntent`; the bundled
 * Console app (`src/`) consumes the SAME exports through
 * `src/sections/BoardSection.tsx` — no fork.
 *
 * Import `@kontourai/console-ui/board.css` alongside this entry (after
 * `@kontourai/ui/tokens.css` + `@kontourai/ui/themes.css`, matching every
 * other `@kontourai/ui`-built primitive) to style `BoardView`.
 */
export { BoardView, boardCardSelectIntent, BOARD_SELECT_CARD_INTENT, type BoardViewProps } from "./BoardView.js";
export {
  deriveBoard,
  classifyBoardStage,
  runIdFromProcessId,
  BOARD_STAGES,
  BOARD_STAGE_LABEL,
  type BoardStage,
  type BoardCard,
  type BoardColumn,
  type BoardModel
} from "./board.js";
export type { ConsoleIntent, IntentHandler, BindIntentHandlerOptions } from "./intent.js";
export { bindIntentHandler } from "./intent.js";
