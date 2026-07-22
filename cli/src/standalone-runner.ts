/**
 * console#232/C5 — the opt-in standalone action runner.
 *
 * The intent-binding-consent spec (`docs/specs/intent-binding-consent.md`)
 * defines how ANY host binds a `ConsoleIntent`'s authority to a product-owned
 * `execute` and gates a bound, side-effecting intent's actual invocation on
 * consent. Station wires its own in-process execute handlers as one such
 * host. This module is the OTHER host the spec deliberately leaves as
 * trailing work ("a standalone action runner or click-to-act surface with no
 * host product" — see that spec's Non-goals): a Console user with no host
 * product (no Station) can still act on a descriptor's commands, because the
 * runner delegates to the product's OWN declared local executable under the
 * identical consent policy, rather than inventing a second execution path.
 *
 * This module never interprets a command itself. `resolveStandaloneProductBinding`
 * only ever produces an `execute` for a command a descriptor actually
 * declares, resolved to a real file on disk (`resolveLocalProductExecutable`,
 * `@kontourai/console-core`) — never a fabricated command, never a shell
 * string (`delegateProduct`, `./delegate`, always spawns argv arrays with
 * `shell: false`). `createStandaloneRunner` enforces the SAME strict
 * `confirm(...) === true` consent gate `@kontourai/console-ui`'s
 * `bindIntentHandler` enforces (mirrored here, not imported, because this
 * workspace does not depend on console-ui — see
 * `cli/scripts/check-import-boundary.ts`): a non-`"never"` confirmation
 * never self-executes on a truthy-but-not-`true` value, a missing `confirm`
 * gate, or a throwing/rejecting gate.
 *
 * Opt-in, inert by default: nothing in this module runs unless a standalone
 * host explicitly resolves a binding AND wires it into a runner. A console-ui
 * component or intent producer that emits an intent nobody bound this way
 * stays exactly as inert as `resolveIntentBinding` already makes it for every
 * other host (`docs/specs/intent-binding-consent.md`).
 *
 * Local-only; hosted/multi-tenant act-plane authorization is explicitly out
 * of scope (ADR 0003 §6; `kontourai/station#580` Decision 9,
 * work-plane-composition).
 */

import type {
  BindableIntent,
  HostIntentBinding,
  IntentBindingFromCommandError,
  IntentBindingResolution,
} from "@kontourai/console-core/intent-binding";
import { intentBindingFromCommand, resolveIntentBinding } from "@kontourai/console-core/intent-binding";
import type {
  LocalProductPackageCandidate,
  ProductCapabilityDescriptor,
  ProductCapabilityDiagnostic,
} from "@kontourai/console-core/product-capability-descriptor";
import { resolveLocalProductExecutable } from "@kontourai/console-core/product-capability-descriptor/node";
import { delegateProduct, type DelegateOptions } from "./delegate";

export type StandaloneBindingError = IntentBindingFromCommandError | "executable-unresolved";

export type StandaloneProductBindingResult<TIntent extends BindableIntent = BindableIntent> =
  | { ok: true; binding: HostIntentBinding<TIntent> }
  | { ok: false; error: StandaloneBindingError; diagnostics?: readonly ProductCapabilityDiagnostic[] };

/** Injectable in place of `delegateProduct` (dependency injection matches `CliDependencies` in `./cli`); never a shell invocation either way. */
export type DelegateFn = (executable: string, argv: readonly string[], options?: DelegateOptions) => Promise<number>;

export interface StandaloneProductBindingOptions {
  readonly delegate?: DelegateFn;
  readonly delegateOptions?: DelegateOptions;
}

/**
 * Resolve ONE `HostIntentBinding` for a standalone host: given a descriptor
 * and the command path it declares, resolve that command's executable
 * against the supplied local package candidates, and produce an `execute`
 * that delegates to the resolved bin.
 *
 * This never fabricates a command or a binding:
 * - `command-not-found` / `authority-mismatch` — the same provenance checks
 *   `intentBindingFromCommand` (`@kontourai/console-core`) already enforces:
 *   the command must be an actual member of `descriptor.commands`, and its
 *   `authority.productId` must match `descriptor.product.id`.
 * - `executable-unresolved` — `resolveLocalProductExecutable` found no
 *   package candidate whose declared bin resolves to a real file beneath its
 *   own package root. No binding is produced in this case either; there is
 *   no fallback, guess, or partial resolution (never-authority invariant).
 *
 * The produced `execute` always calls the injected/underlying delegate with
 * the resolved executable path and a plain argv array
 * (`[...argvPrefix, ...command.argv]`) — never a shell string.
 */
export async function resolveStandaloneProductBinding<TIntent extends BindableIntent = BindableIntent>(
  descriptor: ProductCapabilityDescriptor,
  commandPath: readonly string[],
  candidates: readonly LocalProductPackageCandidate[],
  options: StandaloneProductBindingOptions = {},
): Promise<StandaloneProductBindingResult<TIntent>> {
  const joined = commandPath.join(" ");
  const command = descriptor.commands.find((candidate) => candidate.path.join(" ") === joined);
  if (!command) return { ok: false, error: "command-not-found" };

  const resolved = await resolveLocalProductExecutable(descriptor, command.executableId, candidates);
  if (!resolved.ok) return { ok: false, error: "executable-unresolved", diagnostics: resolved.diagnostics };

  const executablePath = resolved.value.executablePath;
  const argv = [...resolved.value.argvPrefix, ...command.argv];
  const delegate = options.delegate ?? delegateProduct;
  const execute = async (): Promise<void> => {
    await delegate(executablePath, argv, options.delegateOptions);
  };

  // `intentBindingFromCommand` re-derives command membership and the
  // authority match independently of the lookup above — deliberately
  // redundant, per its own contract, so a hand-assembled or unvalidated
  // descriptor can never launder one product's authority under another
  // product's label.
  return intentBindingFromCommand<TIntent>(descriptor, commandPath, execute);
}

type BoundResolution<TIntent extends BindableIntent> = Extract<IntentBindingResolution<TIntent>, { bound: true }>;
type UnboundResolution<TIntent extends BindableIntent> = Extract<IntentBindingResolution<TIntent>, { bound: false }>;

export interface StandaloneRunnerOptions<TIntent extends BindableIntent = BindableIntent> {
  /**
   * Consent gate for a bound intent whose `confirmation` is
   * `"user-request"` or `"operator-request"`. Execution proceeds ONLY when
   * this resolves to the literal value `true` — mirrors
   * `@kontourai/console-ui`'s `bindIntentHandler` exactly: any other
   * resolved value (`"yes"`, `1`, `{}`, `0`, `""`, `null`, `undefined`,
   * `false`, ...) withholds execution exactly like an explicit decline.
   * There is no truthy-coercion shortcut. Omitting `confirm` means such an
   * intent never self-executes (see `onConsentRequired`).
   */
  confirm?: (intent: TIntent, resolution: BoundResolution<TIntent>) => unknown;
  /** Called when an intent's authority has no matching host binding. Defaults to a no-op: the intent stays inert. */
  onUnbound?: (intent: TIntent, resolution: UnboundResolution<TIntent>) => void;
  /** Called when a bound, confirmation-gated intent has no `confirm` gate wired. Execution is withheld either way. */
  onConsentRequired?: (intent: TIntent, resolution: BoundResolution<TIntent>) => void;
  /** Called when `confirm` throws synchronously or its returned promise rejects. Execution is withheld either way. */
  onConsentError?: (intent: TIntent, resolution: BoundResolution<TIntent>, error: unknown) => void;
}

export type StandaloneIntentHandler<TIntent extends BindableIntent = BindableIntent> = (intent: TIntent) => void;

/**
 * Build a standalone host's intent dispatcher from its resolved
 * `HostIntentBinding`s. This is the runner's own consent boundary: resolution
 * (`resolveIntentBinding`) and the strict `confirm(...) === true` gate happen
 * here, and the only code this ever calls is the product-owned `execute`
 * `resolveStandaloneProductBinding` produced for that exact authority.
 *
 * Opt-in by construction: a standalone host that never calls this function
 * (or calls it with an empty `hostBindings` array) leaves every intent
 * exactly as unbound/inert as `resolveIntentBinding` already makes it.
 */
export function createStandaloneRunner<TIntent extends BindableIntent = BindableIntent>(
  hostBindings: readonly HostIntentBinding<TIntent>[],
  options: StandaloneRunnerOptions<TIntent> = {},
): StandaloneIntentHandler<TIntent> {
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
    let outcome: unknown;
    try {
      outcome = options.confirm(intent, resolution);
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
      },
    );
  };
}
