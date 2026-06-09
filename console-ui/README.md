# Console UI

React + Vite starter for the local Console hub.

Run the hub from the parent package:

```sh
cd /Users/brian/dev/github/kontourai/console
npm run serve
```

Run the UI in another terminal:

```sh
cd /Users/brian/dev/github/kontourai/console/console-ui
npm install
npm run dev
```

The UI defaults to `http://127.0.0.1:3737`. Override it for dogfood or alternate local hubs:

```sh
VITE_CONSOLE_HUB_URL=http://127.0.0.1:3738 npm run dev
```

The UI connects with `EventSource` on the canonical `/stream` SSE path and updates from `state`, `record.accepted`, and `telemetry.updated` events. It does not poll for hub state or execute actions.
