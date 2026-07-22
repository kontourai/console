import type { ConsoleAction, ConsoleRef } from "@kontourai/console-core";

/**
 * #230 intent seam: the shape a host binds to `onIntent` to receive a view's
 * user-triggered intents. Derived from console-core's own `ConsoleAction`
 * authority-descriptor type (`Omit`+override, not a hand-mirrored copy) so
 * this stays byte-for-byte the same shape `ConsoleAction` is and automatically
 * picks up any future field console-core adds — `kind` is the only field
 * overridden: `ConsoleAction.kind` is optional (some producer records omit
 * it), but every intent this package emits always names one, so it is
 * required here. A future authority-aware binding (the CONSENT spec,
 * console#231) can consume this shape unchanged.
 *
 * Scope discipline: this slice only defines and wires the seam. No exported
 * view here emits a non-`readOnly` (authority-gated write) intent yet, and no
 * consumer in this repo executes one — binding an intent to real authority
 * (claim/gate/consent semantics) is console#231's job, not this package's.
 */
export interface ConsoleIntent extends Omit<ConsoleAction, "kind"> {
  /** What the intent represents, e.g. `"board.select-card"`. View-defined, open vocabulary — not an enum, matching every other `kind`/`status` field in console-core. */
  kind: string;
}

// Re-exported so a consumer can reference the console-core ref shape used by
// `ConsoleIntent.subjectRefs` without a second import.
export type { ConsoleRef };

/**
 * A view left `onIntent`-unbound renders inert/read-only: no button, no fake
 * affordance for an action the host has not opted into handling. Every
 * exported view in this package follows that rule.
 */
export type IntentHandler = (intent: ConsoleIntent) => void;
