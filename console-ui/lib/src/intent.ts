import type { ConsoleRef } from "@kontourai/console-core";

/**
 * #230 intent seam: the shape a host binds to `onIntent` to receive a view's
 * user-triggered intents. Deliberately mirrors console-core's `ConsoleAction`
 * authority-descriptor fields (`kind`, `authority.product`/`authority.command`,
 * `subjectRefs`) instead of inventing a parallel vocabulary, so a future
 * authority-aware binding (the CONSENT spec, console#231) can consume the SAME
 * shape a view already emits today.
 *
 * Scope discipline: this slice only defines and wires the seam. No exported
 * view here emits a non-`readOnly` (authority-gated write) intent yet, and no
 * consumer in this repo executes one — binding an intent to real authority
 * (claim/gate/consent semantics) is console#231's job, not this package's.
 */
export interface ConsoleIntent {
  /** Stable identifier for this occurrence, e.g. `${kind}:${subject id}`. */
  id: string;
  /** What the intent represents, e.g. `"board.select-card"`. View-defined, open vocabulary — not an enum, matching every other `kind`/`status` field in console-core. */
  kind: string;
  label?: string;
  /** True for intents that only request a view/navigation, never a state change. */
  readOnly?: boolean;
  authority?: {
    product?: string;
    command?: string;
  };
  subjectRefs?: ConsoleRef[];
}

/**
 * A view left `onIntent`-unbound renders inert/read-only: no button, no fake
 * affordance for an action the host has not opted into handling. Every
 * exported view in this package follows that rule.
 */
export type IntentHandler = (intent: ConsoleIntent) => void;
