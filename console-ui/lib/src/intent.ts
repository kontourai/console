import type { ConsoleAction, ConsoleRef, HostIntentBinding, IntentBindingResolution } from "@kontourai/console-core";
import { resolveIntentBinding } from "@kontourai/console-core";

/**
 * #230 intent seam: the shape a host binds to `onIntent` to receive a view's
 * user-triggered intents. Derived from console-core's own `ConsoleAction`
 * authority-descriptor type (`Omit`+override, not a hand-mirrored copy) so
 * this stays byte-for-byte the same shape `ConsoleAction` is and automatically
 * picks up any future field console-core adds — `kind` is the only field
 * overridden: `ConsoleAction.kind` is optional (some producer records omit
 * it), but every intent this package emits always names one, so it is
 * required here. `console#231`'s binding/consent contract
 * (`docs/specs/intent-binding-consent.md`) consumes this shape unchanged —
 * see `bindIntentHandler` below.
 *
 * Scope discipline: this slice only defines and wires the seam. No exported
 * view here emits a non-`readOnly` (authority-gated write) intent yet, and no
 * consumer in this repo executes one — binding an intent to real authority
 * (claim/gate/consent semantics) is `resolveIntentBinding`'s job
 * (`@kontourai/console-core`), not this package's.
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

type BoundResolution = Extract<IntentBindingResolution<ConsoleIntent>, { bound: true }>;

export interface BindIntentHandlerOptions {
  /**
   * Called when an intent's authority has no matching host binding (console-
   * core's `resolveIntentBinding` returned `bound: false` — missing
   * authority, no declared binding, an ambiguous double-binding, or
   * malformed consent metadata). Defaults to a no-op: the intent stays
   * inert, exactly like an unbound `BoardView` (#237) — no execution ever
   * happens for an authority the host did not declare.
   */
  onUnbound?: (intent: ConsoleIntent, resolution: Extract<IntentBindingResolution<ConsoleIntent>, { bound: false }>) => void;
  /**
   * Called when a bound intent's `confirmation` is `"user-request"` or
   * `"operator-request"` but the caller supplied no `confirm` gate below.
   * Execution is withheld either way — this callback is purely so a host can
   * surface "this action needs a confirmation UI you haven't wired yet"
   * instead of a silent no-op. Defaults to a no-op.
   */
  onConsentRequired?: (intent: ConsoleIntent, resolution: BoundResolution) => void;
  /**
   * Called when `confirm` itself throws synchronously or its returned
   * promise rejects. Execution is withheld either way (a broken consent
   * gate is never treated as consent) — this callback exists purely so a
   * host can surface "the confirmation gate errored" instead of a silent
   * no-op or an unhandled rejection. Defaults to a no-op.
   */
  onConsentError?: (intent: ConsoleIntent, resolution: BoundResolution, error: unknown) => void;
  /**
   * Consent gate invoked before a bound, non-`"never"`-confirmation intent
   * executes. Execution proceeds ONLY when this resolves to the literal
   * value `true` — any other resolved value (`"yes"`, `1`, `{}`, `0`, `""`,
   * `null`, `undefined`, `false`, ...) withholds execution exactly like an
   * explicit decline. There is no implicit "assume yes" default, and a
   * truthy-but-not-`true` return is never treated as consent. Omitting
   * `confirm` entirely means such an intent is never executed automatically
   * (see `onConsentRequired`). Intents whose resolved `confirmation` is
   * `"never"` skip this gate entirely, matching the CLI router's own
   * `never` semantics (see `docs/specs/product-capability-descriptor.md`).
   */
  confirm?: (intent: ConsoleIntent, resolution: BoundResolution) => unknown;
}

/**
 * Invoke a host's `confirm` gate and route every outcome to exactly one
 * place: literal `true` executes; anything else (a non-`true` resolved
 * value, a synchronous throw, or a rejected promise) withholds execution.
 * A throw/rejection is routed to `onConsentError` rather than propagating
 * uncontrolled or becoming an unhandled promise rejection.
 */
function gateOnConfirm(
  confirm: NonNullable<BindIntentHandlerOptions["confirm"]>,
  intent: ConsoleIntent,
  resolution: BoundResolution,
  options: BindIntentHandlerOptions
): void {
  let outcome: unknown;
  try {
    outcome = confirm(intent, resolution);
  } catch (error) {
    options.onConsentError?.(intent, resolution, error);
    return;
  }
  Promise.resolve(outcome).then(
    (allowed) => {
      // Strict identity, not truthiness: "yes", 1, and {} must never
      // auto-execute a side-effecting, confirmation-gated intent.
      if (allowed === true) void resolution.execute(intent);
    },
    (error) => {
      options.onConsentError?.(intent, resolution, error);
    }
  );
}

/**
 * Build an `onIntent` handler (console#231) from a host's declared
 * `HostIntentBinding`s (`@kontourai/console-core`). This is sugar over
 * `resolveIntentBinding` for exactly the `(operatingState, IntentHandler)`
 * shape console-ui components take — resolution and consent gating happen
 * here, but the only code this ever calls is the product-owned `execute` a
 * host supplied for that exact authority. An intent with no matching binding
 * — or a bound intent whose confirmation requirement has no wired consent
 * gate, or whose consent gate does not resolve the literal value `true`, or
 * whose consent gate throws/rejects — never executes anything.
 *
 * This is intentionally NOT a standalone action runner (console#232/C5):
 * it has no UI of its own, no retry/queueing, and no execution transport. A
 * host wires its own confirmation UI through `confirm`/`onConsentRequired`.
 */
export function bindIntentHandler(
  hostBindings: readonly HostIntentBinding<ConsoleIntent>[],
  options: BindIntentHandlerOptions = {}
): IntentHandler {
  return (intent) => {
    const resolution = resolveIntentBinding(intent, hostBindings);
    if (!resolution.bound) {
      options.onUnbound?.(intent, resolution);
      return;
    }
    if (resolution.confirmation === "never") {
      void resolution.execute(intent);
      return;
    }
    if (!options.confirm) {
      options.onConsentRequired?.(intent, resolution);
      return;
    }
    gateOnConfirm(options.confirm, intent, resolution, options);
  };
}
