// Loads the <flow-run-panel> custom element as a side effect.
//
// Mirrors surface-trust-panel-loader.ts, but where the Surface element is a
// single self-contained file served from public/, Flow's element imports its
// own pure render-core at build time. So instead of script injection we
// dynamic-import the stable subpath export (`@kontourai/flow/flow-run-panel/
// element`) — Vite bundles render-core inline and the module's only side effect
// is the guarded `customElements.define("flow-run-panel", …)`.
//
// The element reads the Kontour --k-* design tokens by cascade. Our app already
// defines those tokens, so the panel themes itself from the host. We still pull
// in the package's standalone.css once (as a <link>) so a host without the
// tokens (or the hub static server) gets a sensible default palette — this
// matches how the Surface loader leans on its bundled CSS.

let loaded = false;

export function ensureFlowRunPanel(): void {
  if (loaded || typeof customElements === "undefined") return;
  if (customElements.get("flow-run-panel")) {
    loaded = true;
    return;
  }
  loaded = true;

  // Inject the standalone token palette once. Vite rewrites the `?url` import to
  // the emitted asset URL; the cascade is harmless when the host already defines
  // --k-* (the panel just keeps the host's values).
  void import("@kontourai/flow/flow-run-panel/standalone.css?url").then((mod) => {
    const href = (mod as { default: string }).default;
    if (document.querySelector(`link[data-flow-run-panel-css]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.flowRunPanelCss = "";
    document.head.appendChild(link);
  });

  // Registering the element is the side effect we actually need.
  void import("@kontourai/flow/flow-run-panel/element");
}
