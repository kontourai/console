// Type declaration for the <surface-trust-panel> custom element.
// Registered via a dynamic import of the @kontourai/surface "./trust-panel/element"
// export (see surface-trust-panel-loader.ts).
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
