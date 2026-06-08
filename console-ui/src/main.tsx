import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@kontourai/console-kit/tokens.css";
import "@kontourai/console-kit/themes.css";
import "@kontourai/console-kit/react/styles.css";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
