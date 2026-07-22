import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@kontourai/ui/tokens.css";
import "@kontourai/ui/themes.css";
import "@kontourai/ui/react/styles.css";
import "@xyflow/react/dist/base.css";
// #230: BoardView's stylesheet is the published `@kontourai/console-ui`
// `./board.css` export — loaded from the library source here too so the
// bundled app renders identically to a host that imports it, not a fork.
import "../lib/src/board-view.css";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
