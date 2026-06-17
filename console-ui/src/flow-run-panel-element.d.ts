// Ambient module declaration for Flow's <flow-run-panel> element subpath.
//
// Flow's exports map ships only JS for `@kontourai/flow/flow-run-panel/element`
// (no .d.ts), and we import it purely for its `customElements.define` side
// effect. This script-level ambient declaration tells TypeScript the subpath is
// a valid module without types, so the side-effect import in
// flow-run-panel-loader.ts type-checks. (Kept in a standalone .d.ts with no
// top-level import/export so it stays a true ambient/global declaration.)
declare module "@kontourai/flow/flow-run-panel/element";
