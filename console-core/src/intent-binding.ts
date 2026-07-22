/**
 * Intent-binding resolution (console#231 — the act-plane consent spec, part
 * of the work-plane-composition epic, kontourai/station#580 Decisions 4-5).
 *
 * A console-ui component (see `@kontourai/console-ui`'s `BoardView`, #230)
 * emits `ConsoleIntent` values — data shaped by this module's own
 * `ConsoleAction` (operating-state.ts) — through an `onIntent` callback. The
 * component never executes anything itself; per the CLI router's own
 * discipline, a descriptor is "transparency, not consent" (see
 * `docs/specs/product-capability-descriptor.md`). This module is the missing
 * middle step a HOST uses to answer two questions for a given intent:
 *
 *   1. Is there a product-owned executor bound to this intent's authority?
 *      (resolution)
 *   2. If so, what side-effect/confirmation policy governs actually calling
 *      it? (consent metadata)
 *
 * It deliberately does not call the resolved executor itself, run a
 * confirmation UI, or provide a standalone action runner. See
 * `docs/specs/intent-binding-consent.md` for the full contract, including
 * what remains explicitly out of scope (console#232/C5's opt-in runner,
 * hosted/multi-tenant act per ADR 0003).
 */

import type {
  ProductCapabilityDescriptor,
  ProductCommandConfirmation,
  ProductCommandSideEffect
} from "./product-capability-descriptor";

/**
 * The minimum intent shape `resolveIntentBinding` needs: an authority ref
 * matching `ConsoleAction.authority` (operating-state.ts) and console-ui's
 * `ConsoleIntent`, which is structurally derived from it. Pass either type
 * directly — no adapter object is required.
 */
export interface BindableIntent {
  authority?: {
    product?: string;
    command?: string;
  };
}

const SIDE_EFFECTS: readonly ProductCommandSideEffect[] = ["none", "read-local", "write-local", "write-external"];
const CONFIRMATIONS: readonly ProductCommandConfirmation[] = ["never", "user-request", "operator-request"];

/**
 * A host-declared binding for exactly one `(product, command)` authority
 * pair. `sideEffect`/`confirmation` reuse the SAME vocabulary
 * `ProductCapabilityDescriptor` commands already declare (see
 * `intentBindingFromCommand` below) so a host that already publishes a CLI
 * descriptor (the reference path: `@kontourai/cli`'s router) does not invent
 * a second confirmation model for its UI.
 *
 * `execute` is the product-owned executor. `resolveIntentBinding` never
 * constructs, wraps, or infers this function — it only ever returns the
 * exact reference a host supplied here for a matching authority.
 */
export interface HostIntentBinding<TIntent extends BindableIntent = BindableIntent> {
  product: string;
  command: string;
  sideEffect: ProductCommandSideEffect;
  confirmation: ProductCommandConfirmation;
  execute: (intent: TIntent) => void | Promise<void>;
}

export type IntentBindingUnboundReason =
  | "missing-authority"
  | "no-matching-binding"
  | "ambiguous-binding"
  | "invalid-consent-metadata";

export type IntentBindingResolution<TIntent extends BindableIntent = BindableIntent> =
  | {
      bound: true;
      product: string;
      command: string;
      sideEffect: ProductCommandSideEffect;
      confirmation: ProductCommandConfirmation;
      execute: (intent: TIntent) => void | Promise<void>;
    }
  | {
      bound: false;
      reason: IntentBindingUnboundReason;
      product?: string;
      command?: string;
    };

/**
 * Resolve an intent against a host's declared bindings.
 *
 * Fail-closed on every ambiguous or malformed case — this function's ONLY
 * path to `bound: true` is one exact, unique `(product, command)` string
 * match against a binding the caller supplied with valid consent metadata.
 * It never guesses, merges bindings, upgrades a `readOnly` intent into a
 * write authority, or falls back to a default executor: an authority the
 * host did not declare a binding for always resolves `bound: false`, and the
 * result never carries an `execute` field in that case (never-authority
 * invariant — see `docs/specs/intent-binding-consent.md`).
 *
 * NOTE: this function trusts the `(product, command)` labels on each
 * `HostIntentBinding` the caller supplies — it has no way to verify a
 * binding's `product`/`command`/`sideEffect`/`confirmation` actually came
 * from the named product's own descriptor. That provenance guarantee is
 * `intentBindingFromCommand`'s job (below): prefer it over hand-authoring a
 * `HostIntentBinding` whenever a validated descriptor is available.
 */
export function resolveIntentBinding<TIntent extends BindableIntent>(
  intent: TIntent,
  hostBindings: readonly HostIntentBinding<TIntent>[]
): IntentBindingResolution<TIntent> {
  const product = intent.authority?.product;
  const command = intent.authority?.command;
  if (!product || !command) {
    return { bound: false, reason: "missing-authority" };
  }

  const matches = hostBindings.filter((binding) => binding.product === product && binding.command === command);
  if (matches.length === 0) {
    return { bound: false, reason: "no-matching-binding", product, command };
  }
  if (matches.length > 1) {
    // Two host bindings claim the same authority: resolving to either one
    // silently would let whichever binding happened to be listed first (or
    // last) win — an outcome nobody declared and nobody can audit. Fail
    // closed instead of guessing.
    return { bound: false, reason: "ambiguous-binding", product, command };
  }

  const binding = matches[0];
  if (!SIDE_EFFECTS.includes(binding.sideEffect) || !CONFIRMATIONS.includes(binding.confirmation)) {
    return { bound: false, reason: "invalid-consent-metadata", product, command };
  }

  return {
    bound: true,
    product: binding.product,
    command: binding.command,
    sideEffect: binding.sideEffect,
    confirmation: binding.confirmation,
    execute: binding.execute
  };
}

export type IntentBindingFromCommandError =
  /** No command in `descriptor.commands` has this exact `path`. A binding is
   *  never produced for a command that is not an actual member of the
   *  supplied descriptor — this constructor never accepts a free-floating
   *  command object from anywhere else. */
  | "command-not-found"
  /** The looked-up command's `authority.productId` disagrees with
   *  `descriptor.product.id`. A validated descriptor
   *  (`validateProductCapabilityDescriptor`) can never reach this state —
   *  it rejects that mismatch as `DESCRIPTOR_AUTHORITY_MISMATCH` — but this
   *  constructor re-checks it at binding time so an unvalidated or
   *  hand-assembled descriptor object can never launder one product's
   *  authority under another product's label. */
  | "authority-mismatch";

export type IntentBindingFromCommandResult<TIntent extends BindableIntent = BindableIntent> =
  | { ok: true; binding: HostIntentBinding<TIntent> }
  | { ok: false; error: IntentBindingFromCommandError };

/**
 * Derive a `HostIntentBinding` from ONE command belonging to a
 * `ProductCapabilityDescriptor` — the same descriptor family the Kontour CLI
 * router negotiates (`docs/specs/kontour-cli-router.md`). Callers identify
 * the command by its `path` (space-joined, matching the join
 * `validateProductCapabilityDescriptor`'s own diagnostics use for
 * `commandPath`, e.g. `["workflow","status"]`) — never by passing a command
 * object directly — so this function can look the command up INSIDE the
 * supplied descriptor's own `commands` array and prove two things before it
 * will produce a binding:
 *
 *   1. **Membership**: the command is an actual entry of
 *      `descriptor.commands`, not an unrelated object that merely has the
 *      right shape (e.g. a command declaration copied from a different
 *      product's descriptor).
 *   2. **Authority match**: that command's own `authority.productId` equals
 *      `descriptor.product.id` — the same invariant
 *      `validateProductCapabilityDescriptor` enforces
 *      (`DESCRIPTOR_AUTHORITY_MISMATCH`), re-checked here because this
 *      function's `descriptor` argument is not guaranteed to have passed
 *      through that validator first.
 *
 * Either check failing returns `{ ok: false, error }` and produces NO
 * binding — a host cannot mint a binding that claims one product's
 * authority using metadata that actually belongs to a different product.
 */
export function intentBindingFromCommand<TIntent extends BindableIntent>(
  descriptor: ProductCapabilityDescriptor,
  commandPath: readonly string[],
  execute: (intent: TIntent) => void | Promise<void>
): IntentBindingFromCommandResult<TIntent> {
  const joined = commandPath.join(" ");
  const command = descriptor.commands.find((candidate) => candidate.path.join(" ") === joined);
  if (!command) {
    return { ok: false, error: "command-not-found" };
  }
  if (command.authority.productId !== descriptor.product.id) {
    return { ok: false, error: "authority-mismatch" };
  }

  return {
    ok: true,
    binding: {
      product: descriptor.product.id,
      command: joined,
      sideEffect: command.sideEffect,
      confirmation: command.authority.confirmation,
      execute
    }
  };
}
