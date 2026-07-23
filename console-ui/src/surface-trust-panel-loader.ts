// Loads the <surface-trust-panel> custom element as a side effect.
//
// Registered from @kontourai/surface's published "./trust-panel/element" export
// via a dynamic import: Vite code-splits it into a chunk fetched on first use
// (same lazy behaviour as the former runtime <script> injection), the version is
// pinned by the @kontourai/surface dependency, and there is no vendored public/
// copy to drift from the source. Consumers render <surface-trust-panel> and set
// `.report` once upgraded.
//
// console#255 review MED finding 2: the load is tracked as a real Promise, not
// fire-and-forget. Marking `loaded` BEFORE the import settled meant a failed
// chunk fetch (offline, a CDN hiccup) left an unhandled rejection AND
// permanently disabled every future call — the element would never register,
// so a consumer's <surface-trust-panel> tag stayed an inert, unupgraded,
// visually blank element forever, with no way to retry. Now: `loaded` is only
// set on a RESOLVED import; a rejection resets the in-flight state so the
// NEXT call (e.g. a consumer remounting after the gate is reselected) retries
// the import from scratch, and the returned promise lets a consumer know
// whether the element is actually usable so it can render an honest fallback
// instead of a blank tag.

export type SurfaceTrustPanelImporter = () => Promise<unknown>;

const defaultImporter: SurfaceTrustPanelImporter = () => import("@kontourai/surface/trust-panel/element");

let loaded = false;
let loadingPromise: Promise<boolean> | null = null;

/**
 * Ensures `<surface-trust-panel>` is registered, returning a promise that
 * resolves `true` once it is safe to render/upgrade the element, or `false`
 * when it could not be loaded (no `customElements` — SSR/tests — or the
 * dynamic import rejected). `importer` is injectable for tests only; every
 * real call site uses the default (the actual package import).
 */
export function ensureSurfaceTrustPanel(importer: SurfaceTrustPanelImporter = defaultImporter): Promise<boolean> {
  if (typeof customElements === "undefined") return Promise.resolve(false);
  if (loaded || customElements.get("surface-trust-panel")) {
    loaded = true;
    return Promise.resolve(true);
  }
  if (loadingPromise) return loadingPromise;

  loadingPromise = importer()
    .then(() => {
      loaded = true;
      loadingPromise = null;
      return true;
    })
    .catch((error: unknown) => {
      // Reset so a LATER call (e.g. the consumer remounts) retries — a
      // transient failure must not permanently disable the element.
      loadingPromise = null;
      if (typeof console !== "undefined") {
        console.error("surface-trust-panel: failed to load the trust panel custom element", error);
      }
      return false;
    });
  return loadingPromise;
}

/** Test-only reset of this module's otherwise process-lifetime load state. */
export function __resetSurfaceTrustPanelLoaderForTests(): void {
  loaded = false;
  loadingPromise = null;
}
