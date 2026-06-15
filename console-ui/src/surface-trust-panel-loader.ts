// Loads the <surface-trust-panel> custom element as a side effect.
// This module is imported dynamically so it doesn't need to be in
// @kontourai/surface's package.json exports. Vite bundles the file
// inline; the public/ copy serves as a fallback for the hub static server.
//
// We use a script-injection approach that works in both Vite dev mode (which
// serves public/ files) and the bundled build (which copies public/ to dist/).

let loaded = false;

export function ensureSurfaceTrustPanel(): void {
  if (loaded || typeof customElements === "undefined") return;
  if (customElements.get("surface-trust-panel")) {
    loaded = true;
    return;
  }
  loaded = true;

  const script = document.createElement("script");
  script.type = "module";
  // In dev: Vite serves /surface-trust-panel.js from public/.
  // In prod: the file is copied to dist/ by Vite, served at root by the hub.
  script.src = "/surface-trust-panel.js";
  document.head.appendChild(script);
}
