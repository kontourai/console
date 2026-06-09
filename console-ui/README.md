# Console UI

React + Vite starter for the local Console hub.

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
