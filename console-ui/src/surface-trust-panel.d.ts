// Type declaration for the <surface-trust-panel> custom element.
// Loaded via side-effect import of @kontourai/surface/dist/src/trust-panel/surface-trust-panel.js.
// The element exposes a `report` property (TrustReport) and `src` / `heading` attributes.

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "surface-trust-panel": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          heading?: string;
          ref?: React.Ref<HTMLElement & { report?: unknown }>;
        },
        HTMLElement
      >;
    }
  }
}

export {};
