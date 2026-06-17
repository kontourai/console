// Type declaration for the <flow-run-panel> custom element.
// Registered via side-effect import of @kontourai/flow/flow-run-panel/element.
// The element exposes a `projection` property (a pre-derived
// FlowConsoleProjection) and a `heading` attribute. Custom-element properties
// are not plain attributes, so `projection` is set imperatively via a ref —
// exactly like <surface-trust-panel> sets `.report`.

import type { FlowConsoleProjection } from "@kontourai/flow/console-contract";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "flow-run-panel": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          heading?: string;
          ref?: React.Ref<HTMLElement & { projection?: FlowConsoleProjection | null }>;
        },
        HTMLElement
      >;
    }
  }
}

export {};
