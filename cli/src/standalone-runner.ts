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
 * only ever produces an `execute` for a command a VALIDATED descriptor
 * actually declares, resolved to a real file on disk
 * (`resolveLocalProductExecutable`, `@kontourai/console-core`) beneath a
 * candidate root whose OWN `package.json` manifest — read fresh from disk,
 * never the caller's assertion about it — supplies the identity and bin map
 * used to resolve it. `delegateProduct` (`./delegate`) always spawns argv
 * arrays with `shell: false`; the ONLY production execution path from this
 * module goes through it (see the TEST-ONLY injection seam note below).
 * `createStandaloneRunner` enforces the SAME strict `confirm(...) === true`
 * consent gate `@kontourai/console-ui`'s `bindIntentHandler` enforces
 * (mirrored here, not imported, because this workspace does not depend on
 * console-ui — see `cli/scripts/check-import-boundary.ts`): a non-`"never"`
 * confirmation never self-executes on a truthy-but-not-`true` value, a
 * missing `confirm` gate, or a throwing/rejecting gate.
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
 *
 * --- 2026-07-20 security review hardening (findings 1-3) ---
 *
 * 1. A descriptor is now runtime-validated (`validateProductCapabilityDescriptor`)
 *    before anything is resolved from it — a structurally-typed but
 *    unvalidated/forged descriptor object is never trusted. Candidate
 *    identity (`packageName`/`bins`) is never taken from caller-supplied
 *    metadata either: `resolveStandaloneProductBinding` accepts plain
 *    candidate ROOT directories and derives identity fresh from each root's
 *    own `package.json` (`inertBins`/`readBoundJson`, `./discovery`), the
 *    same bounded parser the CLI's own product discovery uses. A command
 *    declaring a mutating `sideEffect` (`write-local`/`write-external`)
 *    together with `confirmation: "never"` is a semantic contradiction — a
 *    state-mutating command cannot simultaneously declare it needs no
 *    confirmation — and is rejected (`confirmation-contradiction`) rather
 *    than trusted.
 * 2. The executable path resolved at BIND time is a feasibility check only.
 *    The `execute` a binding actually carries re-resolves AND re-validates
 *    containment from scratch, immediately before delegating, every time it
 *    is called — closing the TOCTOU window between binding and an
 *    arbitrarily-delayed `confirm(...) === true` (a file or an ancestor
 *    directory swapped during that delay fails the re-resolution and is
 *    never spawned).
 * 3. `StandaloneProductBindingOptions` (the public options type) has no
 *    delegate-injection field: a custom delegate cannot be trusted to
 *    preserve `delegateProduct`'s no-shell, argv-array-only guarantee, so
 *    the only production execution path is the real `delegateProduct`.
 *    `__TEST_ONLY_withDelegateOverride` (below) exists solely for this
 *    workspace's own tests and is never re-exported from `./index` (the
 *    package's public entry point) or reachable through the package's
 *    `exports` map.
 */

import { realpath } from "node:fs/promises";
import type {
  BindableIntent,
  HostIntentBinding,
  IntentBindingFromCommandError,
  IntentBindingResolution,
} from "@kontourai/console-core/intent-binding";
import { intentBindingFromCommand, resolveIntentBinding } from "@kontourai/console-core/intent-binding";
import type {
  ProductCapabilityDescriptor,
  ProductCapabilityDiagnostic,
  ProductCommandDeclaration,
  LocalProductPackageCandidate,
} from "@kontourai/console-core/product-capability-descriptor";
import { validateProductCapabilityDescriptor } from "@kontourai/console-core/product-capability-descriptor";
import { resolveLocalProductExecutable } from "@kontourai/console-core/product-capability-descriptor/node";
import { delegateProduct, type DelegateOptions } from "./delegate";
import { inertBins, readBoundJson } from "./discovery";

export type StandaloneBindingError =
  | IntentBindingFromCommandError
  | "descriptor-invalid"
  | "confirmation-contradiction"
  | "executable-unresolved";

export type StandaloneProductBindingResult<TIntent extends BindableIntent = BindableIntent> =
  | { ok: true; binding: HostIntentBinding<TIntent> }
  | { ok: false; error: StandaloneBindingError; diagnostics?: readonly ProductCapabilityDiagnostic[] };

/** The delegate signature `delegateProduct` satisfies. Only used internally and by the TEST-ONLY override below — never part of the public options a production caller can set. */
export type DelegateFn = (executable: string, argv: readonly string[], options?: DelegateOptions) => Promise<number>;

export interface StandaloneProductBindingOptions {
  readonly delegateOptions?: DelegateOptions;
}

/** @internal not exported from `./index`; carries the TEST-ONLY delegate override attached by `__TEST_ONLY_withDelegateOverride`. */
interface InternalStandaloneProductBindingOptions extends StandaloneProductBindingOptions {
  readonly __TEST_ONLY_delegate?: DelegateFn;
}

/**
 * TEST-ONLY delegate injection (finding 3, 2026-07-20 security review).
 *
 * NEVER import this from production code. `StandaloneProductBindingOptions`
 * — the type a normal caller's `options` argument is checked against — has
 * no delegate field on purpose: a substitute delegate could ignore the
 * resolved executable/argv, shell out, or mutate shared argv, defeating
 * `delegateProduct`'s no-shell guarantee. This helper exists solely so this
 * workspace's OWN tests can assert what a resolved binding WOULD run without
 * actually spawning a process. It is intentionally not re-exported from
 * `./index` (the package's public entry point).
 */
export function __TEST_ONLY_withDelegateOverride(
  options: StandaloneProductBindingOptions,
  delegate: DelegateFn,
): StandaloneProductBindingOptions {
  const withOverride: InternalStandaloneProductBindingOptions = { ...options, __TEST_ONLY_delegate: delegate };
  return withOverride;
}

/** Raised by a produced `execute` when the executable cannot be re-verified immediately before spawn (TOCTOU fail-closed — finding 2). */
export class StandaloneRunnerExecutionError extends Error {
  readonly diagnostics: readonly ProductCapabilityDiagnostic[];

  constructor(message: string, diagnostics: readonly ProductCapabilityDiagnostic[] = []) {
    super(message);
    this.name = "StandaloneRunnerExecutionError";
    this.diagnostics = diagnostics;
  }
}

/**
 * Derive a candidate's identity FRESH from its own `package.json` — never
 * from caller-supplied metadata. Mirrors `./discovery`'s own installed-
 * package identity derivation (`resolvedInstalledPackageRoot`): the only
 * caller-trusted input is the root DIRECTORY location; `packageName` and
 * `bins` always come from reading that root's manifest at resolution time.
 */
async function verifiedCandidateFromRoot(root: string): Promise<LocalProductPackageCandidate | undefined> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch {
    return undefined;
  }
  let manifest: unknown;
  try {
    manifest = await readBoundJson(canonicalRoot, "package.json");
  } catch {
    return undefined;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  const record = manifest as Record<string, unknown>;
  const bins = inertBins(record.bin);
  if (typeof record.name !== "string" || record.name.length === 0 || record.name.length > 214 || !bins) return undefined;
  return { root: canonicalRoot, packageName: record.name, bins };
}

/**
 * Resolve one command's executable path/argv against a set of candidate
 * ROOT directories, deriving every candidate's identity fresh from disk
 * (`verifiedCandidateFromRoot`) and applying `resolveLocalProductExecutable`'s
 * own containment/symlink checks against the CURRENT filesystem state. This
 * is called once at bind time (feasibility only) and again, unconditionally,
 * inside the produced `execute` immediately before delegating (finding 2).
 */
async function resolveExecutableForCommand(
  descriptor: ProductCapabilityDescriptor,
  command: ProductCommandDeclaration,
  candidateRoots: readonly string[],
): Promise<
  | { ok: true; executablePath: string; argv: readonly string[] }
  | { ok: false; diagnostics: readonly ProductCapabilityDiagnostic[] }
> {
  const candidates: LocalProductPackageCandidate[] = [];
  for (const root of candidateRoots) {
    const candidate = await verifiedCandidateFromRoot(root);
    if (candidate) candidates.push(candidate);
  }
  const resolved = await resolveLocalProductExecutable(descriptor, command.executableId, candidates);
  if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
  return { ok: true, executablePath: resolved.value.executablePath, argv: [...resolved.value.argvPrefix, ...command.argv] };
}

/**
 * Resolve ONE `HostIntentBinding` for a standalone host: given a descriptor
 * and the command path it declares, resolve that command's executable
 * against a set of candidate package ROOT directories, and produce an
 * `execute` that re-resolves and delegates to the resolved bin.
 *
 * This never fabricates a command or a binding:
 * - `descriptor-invalid` — the descriptor itself fails
 *   `validateProductCapabilityDescriptor`. A structurally-typed but
 *   unvalidated/forged descriptor is never trusted (finding 1a).
 * - `confirmation-contradiction` — the matched command declares a mutating
 *   `sideEffect` (`write-local`/`write-external`) together with
 *   `confirmation: "never"`. A state-mutating command that also claims it
 *   needs no confirmation is malformed or hostile; it is rejected rather
 *   than trusted (finding 1c).
 * - `command-not-found` / `authority-mismatch` — the same provenance checks
 *   `intentBindingFromCommand` (`@kontourai/console-core`) already enforces:
 *   the command must be an actual member of `descriptor.commands`, and its
 *   `authority.productId` must match `descriptor.product.id`.
 * - `executable-unresolved` — no candidate root's OWN manifest (read fresh
 *   from disk — never the caller's assertion about it, finding 1b) declares
 *   a bin that resolves to a real, contained file. No binding is produced in
 *   this case either; there is no fallback, guess, or partial resolution
 *   (never-authority invariant).
 *
 * The produced `execute` re-resolves the executable from scratch
 * immediately before delegating (finding 2 — TOCTOU) and always calls the
 * real `delegateProduct` (finding 3) with the resolved executable path and a
 * freshly-copied argv array — never a shell string.
 */
export async function resolveStandaloneProductBinding<TIntent extends BindableIntent = BindableIntent>(
  descriptor: ProductCapabilityDescriptor,
  commandPath: readonly string[],
  candidateRoots: readonly string[],
  options: StandaloneProductBindingOptions = {},
): Promise<StandaloneProductBindingResult<TIntent>> {
  const validated = validateProductCapabilityDescriptor(descriptor);
  if (!validated.ok) return { ok: false, error: "descriptor-invalid", diagnostics: validated.diagnostics };
  const trustedDescriptor = validated.descriptor;

  const joined = commandPath.join(" ");
  const command = trustedDescriptor.commands.find((candidate) => candidate.path.join(" ") === joined);
  if (!command) return { ok: false, error: "command-not-found" };

  const mutates = command.sideEffect === "write-local" || command.sideEffect === "write-external";
  if (mutates && command.authority.confirmation === "never") {
    return { ok: false, error: "confirmation-contradiction" };
  }

  // Bind-time feasibility check only. `execute` below never reuses this
  // result — it re-resolves unconditionally immediately before delegating.
  const feasibility = await resolveExecutableForCommand(trustedDescriptor, command, candidateRoots);
  if (!feasibility.ok) return { ok: false, error: "executable-unresolved", diagnostics: feasibility.diagnostics };

  const delegateOptions = options.delegateOptions;
  const testDelegate = (options as InternalStandaloneProductBindingOptions).__TEST_ONLY_delegate;
  const execute = async (): Promise<void> => {
    const fresh = await resolveExecutableForCommand(trustedDescriptor, command, candidateRoots);
    if (!fresh.ok) {
      throw new StandaloneRunnerExecutionError(
        "The resolved product executable could not be re-verified immediately before execution.",
        fresh.diagnostics,
      );
    }
    const delegate = testDelegate ?? delegateProduct;
    // Defensive copy: never hand a shared/mutable argv array to a delegate.
    await delegate(fresh.executablePath, [...fresh.argv], delegateOptions);
  };

  return intentBindingFromCommand<TIntent>(trustedDescriptor, commandPath, execute);
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
  /**
   * Called when a bound intent's `execute` itself throws synchronously or
   * its returned promise rejects — including the `StandaloneRunnerExecutionError`
   * `resolveStandaloneProductBinding`'s own `execute` raises when the
   * resolved executable fails TOCTOU re-verification immediately before
   * spawn. Defaults to a no-op; without this hook such a rejection would
   * otherwise become an unhandled promise rejection.
   */
  onExecuteError?: (intent: TIntent, resolution: BoundResolution<TIntent>, error: unknown) => void;
}

export type StandaloneIntentHandler<TIntent extends BindableIntent = BindableIntent> = (intent: TIntent) => void;

function runExecute<TIntent extends BindableIntent>(
  intent: TIntent,
  resolution: BoundResolution<TIntent>,
  options: StandaloneRunnerOptions<TIntent>,
): void {
  Promise.resolve()
    .then(() => resolution.execute(intent))
    .catch((error) => {
      options.onExecuteError?.(intent, resolution, error);
    });
}

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
      runExecute(intent, resolution, options);
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
        if (allowed === true) runExecute(intent, resolution, options);
      },
      (error) => {
        options.onConsentError?.(intent, resolution, error);
      },
    );
  };
}
