// Loads the <surface-trust-panel> custom element as a side effect.
//
// Registered from @kontourai/surface's published "./trust-panel/element" export
// via a dynamic import: Vite code-splits it into a chunk fetched on first use
// (same lazy behaviour as the former runtime <script> injection), the version is
// pinned by the @kontourai/surface dependency, and there is no vendored public/
// copy to drift from the source. Fire-and-forget: the element self-registers on
// import, consumers render <surface-trust-panel> and set `report` once upgraded.

let loaded = false;

export function ensureSurfaceTrustPanel(): void {
  if (loaded || typeof customElements === "undefined") return;
  if (customElements.get("surface-trust-panel")) {
    loaded = true;
    return;
  }
  loaded = true;
  void import("@kontourai/surface/trust-panel/element");
}
