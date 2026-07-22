# Console UI

React + Vite starter for the local Console hub, and the source of the
published `@kontourai/console-ui` host-mountable view components.

## Run the app locally

Run the local hub and UI together from the parent package:

```sh
cd /Users/brian/dev/github/kontourai/kontour-console
npm run dev:local
```

The runner picks available local ports and wires the UI hub URL and server CORS origins together. To pin ports:

```sh
npm run dev:local -- --hub-port 3738 --ui-port 5175
```

Manual split terminals are still supported. Run the hub from the parent package:

```sh
npm run serve -- --host 127.0.0.1 --port 3738
```

Run the UI in another terminal and point it at the hub:

```sh
cd console-ui
VITE_CONSOLE_HUB_URL=http://127.0.0.1:3738 npm run dev -- --host 127.0.0.1 --port 5175
```

The UI connects with `EventSource` on the canonical `/stream` SSE path and updates from `state`, `record.accepted`, and `telemetry.updated` events. It does not poll for hub state or execute actions.

## Host-mountable components (`@kontourai/console-ui`, console#230)

This package's `.` export (`lib/src/index.ts`, built to `dist-lib`) ships
`BoardView` and the pure `deriveBoard` projection it is built on, for a host
product to mount directly:

```tsx
import { BoardView } from "@kontourai/console-ui";
// All four stylesheets below are required — BoardView itself only ships
// `./board.css` (its own component-scoped classes); the token/theme/react
// sheets are @kontourai/ui's own prerequisite for ANY of its primitives
// (BoardView uses @kontourai/ui/react's <Empty> for its zero-items state).
import "@kontourai/ui/tokens.css";
import "@kontourai/ui/themes.css";
import "@kontourai/ui/react/styles.css";
import "@kontourai/console-ui/board.css";

<BoardView
  operatingState={state}     // a locally-built @kontourai/console-core OperatingState
  onIntent={(intent) => {}}  // optional — a ConsoleAction-shaped intent (console#230/#231)
  now={Date.now()}           // optional — a fixed reference clock for deterministic (e.g. SSR) renders
/>;
```

Every exported view is a pure render over the `operatingState` you provide —
no fetching, no owned network/selection state. Leaving `onIntent` unbound
renders the view inert/read-only (no interactive affordance for an action the
host isn't listening for). `react` and `react-dom` are peer dependencies: the
host supplies its own copy. The bundled Console app above (`src/`) mounts the
SAME `BoardView` export, through the SAME `@kontourai/console-ui` package
specifier (`src/sections/BoardSection.tsx` imports `from "@kontourai/console-ui"`,
resolved via the npm workspace like any other host would resolve it from
npm) — no fork, and no relative reach into this package's internals.

Binding `onIntent` to real authority (claim/gate/consent semantics) is
console#231's job; this package only defines and emits the intent shape.
