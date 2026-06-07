# Kontour Console UI

React + Vite starter for the local Kontour Console hub.

Run the hub from the parent package:

```sh
cd /Users/brian/dev/github/kontourai/kontour-console
npm run serve
```

Run the UI in another terminal:

```sh
cd /Users/brian/dev/github/kontourai/kontour-console/console-ui
npm install
npm run dev
```

The UI defaults to `http://127.0.0.1:3737`, connects with `EventSource` on the supported `/events` SSE compatibility path, and updates from `state` and `record.accepted` SSE events. New clients should prefer canonical `/stream`. It does not poll, execute actions, or include graph rendering.
