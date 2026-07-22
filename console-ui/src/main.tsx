import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@kontourai/ui/tokens.css";
import "@kontourai/ui/themes.css";
import "@kontourai/ui/react/styles.css";
import "@xyflow/react/dist/base.css";
// #230: import the ACTUAL published `@kontourai/console-ui` package + its
// `./board.css` export (not a relative reach into lib/src) — the app is a
// real consumer of its own published surface, exercised by this repo's own
// browser suite, not a special-cased fork.
import "@kontourai/console-ui/board.css";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
