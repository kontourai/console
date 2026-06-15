import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@kontourai/ui/tokens.css";
import "@kontourai/ui/themes.css";
import "@kontourai/ui/react/styles.css";
import "@xyflow/react/dist/base.css";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
