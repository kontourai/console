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
 * arrays with `shell: false`; it is the ONLY execution path this module ever
 * calls — see finding 2 in the review log below.
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
 *    the only production execution path is the real `delegateProduct`. A
 *    TEST-ONLY delegate-injection seam exists solely in
 *    `cli/test/standalone-runner-test-support.ts` — a module OUTSIDE
 *    `cli/src` (`tsconfig.build.json`'s `rootDir`/`include` never sees it,
 *    and `package.json`'s `files` never lists `test`), so it is never
 *    compiled into `dist/` or published in the npm tarball.
 *
 * --- 2026-07-22 confirmation follow-up review (3 further HIGH findings) ---
 *
 * 4. (mutable-object reuse defeated finding 2's own argv copy) The `execute`
 *    closure re-resolved a command's executable/argv by reading `command`
 *    and `descriptor` BY REFERENCE — the caller's own live objects
 *    (`validateProductCapabilityDescriptor` returns the identical object it
 *    was given, never a copy). A caller who mutated a bound command's
 *    `argv` (or `sideEffect`/`authority`) IN PLACE after binding changed
 *    what a subsequent `confirm(...) === true` (or even a `"never"`-
 *    confirmation binding's own re-invocation) would execute — e.g. binding
 *    a `confirmation: "never"` "status" command and then mutating its argv
 *    to `["cancel"]` ran `cancel` with no consent check at all. Fixed by
 *    deep-cloning-and-freezing (`deepFreezeClone`, using `structuredClone`
 *    — the descriptor is plain JSON-shaped data) the FULL validated
 *    descriptor immediately after validation, before anything else reads
 *    it (`planStandaloneProductBinding`). Every downstream read — the
 *    command lookup, the confirmation-contradiction check, the bind-time
 *    feasibility resolution, `intentBindingFromCommand`, and the `execute`
 *    closure's own TOCTOU re-resolution — reads exclusively from that
 *    frozen, independent snapshot. `candidateRoots` is snapshotted
 *    (`Object.freeze([...candidateRoots])`) the same way. Post-binding
 *    mutation of the caller's original descriptor/command objects has zero
 *    effect on what a binding does from that point forward.
 * 5. (test-delegate still reachable from production) `__TEST_ONLY_delegate`
 *    was read via a runtime property lookup on the public `options`
 *    argument (`(options as Internal...).__TEST_ONLY_delegate`) — reachable
 *    by ANY JS caller of the PUBLIC `resolveStandaloneProductBinding`
 *    regardless of what the TS type declared, with zero need to import
 *    anything special. Worse, the helper that constructed that bypass
 *    (`__TEST_ONLY_withDelegateOverride`) shipped IN packaged `dist`,
 *    reachable even by a determined caller who never imports it normally
 *    (a deep, absolute-path `require`-style load resolved via
 *    `require.resolve('@kontourai/cli')/..`, which bypasses the package `exports` map — that
 *    map only restricts specifier-based resolution). Fixed by removing
 *    every delegate-accepting code path from this module ENTIRELY:
 *    `StandaloneProductBindingOptions` has never had (and still does not
 *    have) a delegate field, `resolveStandaloneProductBinding`'s
 *    implementation now calls the real `delegateProduct` as a hardcoded
 *    import — never anything sourced from `options` — and there is no
 *    property read of `options` beyond the typed `delegateOptions` field.
 *    The delegate-accepting composition step
 *    (validated-plan + delegate -> `execute`) is a small, PRIVATE,
 *    module-scope-only function (`buildExecute`) that is never exported —
 *    not even internally — so no amount of deep-`require`ing packaged
 *    `dist` can reach a delegate-accepting call in this module. The
 *    TEST-ONLY equivalent lives in `cli/test/standalone-runner-test-support.ts`
 *    (excluded from `dist`/the npm tarball, see finding 3 above) and
 *    duplicates that same ~10-line composition step against this module's
 *    exported, delegate-FREE `planStandaloneProductBinding`/
 *    `resolveExecutableForCommand` internals, rather than sharing any
 *    delegate-parameterized function with production.
 * 6. (TOCTOU is not, and cannot be, fully atomic) The immediately-before-
 *    spawn re-resolution (finding 2) shrinks the window between "this file
 *    is verified safe" and "this file is opened by the OS for exec" to the
 *    time between an `fs.realpath`/`fs.stat` call returning and
 *    `child_process.spawn`'s underlying `execve` call — but it does not,
 *    and cannot, close that window to zero. Node's `child_process` module
 *    has no `fexecve`/`posix_spawn`-with-verified-fd primitive: it always
 *    spawns BY PATH, so an attacker who can swap the file (or an ancestor
 *    directory) AT THAT EXACT INSTANT is not caught by any check this
 *    module — or any pure-JS module — can perform. This is disclosed, not
 *    silently accepted: see "Accepted residual risk: TOCTOU is
 *    mitigated, not eliminated" in
 *    `docs/specs/intent-binding-consent.md` for the full threat model.
 *    In short — exploiting this residual window requires an attacker who
 *    ALREADY has write access to the product's own installed binary (or
 *    its containing directory) on the user's own machine, at the precise
 *    instant of spawn: that is a pre-existing local compromise of that
 *    product's install, not a capability this runner grants. The runner
 *    never expands what an attacker with that level of access could
 *    already do by installing/replacing the product binary directly.
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

/**
 * The delegate signature `delegateProduct` satisfies. Type-only — erased at
 * compile time, so exporting this costs nothing at runtime — kept here so
 * the (unpackaged) TEST-ONLY module can type its own injected delegate
 * without duplicating this signature.
 */
export type DelegateFn = (executable: string, argv: readonly string[], options?: DelegateOptions) => Promise<number>;

export interface StandaloneProductBindingOptions {
  readonly delegateOptions?: DelegateOptions;
}

/** Raised by a produced `execute` when the executable cannot be re-verified immediately before spawn (TOCTOU fail-closed — finding 2; residual window documented above as finding 6). */
export class StandaloneRunnerExecutionError extends Error {
  readonly diagnostics: readonly ProductCapabilityDiagnostic[];

  constructor(message: string, diagnostics: readonly ProductCapabilityDiagnostic[] = []) {
    super(message);
    this.name = "StandaloneRunnerExecutionError";
    this.diagnostics = diagnostics;
  }
}

/**
 * Deep-clone-and-freeze `value` (via `structuredClone`, safe here because
 * every value this module ever passes through it is plain JSON-shaped data
 * — no functions, no cyclic references). Every nested object/array is
 * frozen too, not just the top level, so no downstream code can mutate a
 * nested field (e.g. `command.authority`) even if it holds only a
 * top-level reference. Used to build an execution-time snapshot that is
 * fully independent of a caller's own, potentially-still-mutable
 * descriptor object (finding 4, 2026-07-22 review).
 */
function deepFreezeClone<T>(value: T): T {
  const clone = structuredClone(value);
  const seen = new Set<unknown>();
  const freeze = (node: unknown): void => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    Object.freeze(node);
    for (const key of Object.getOwnPropertyNames(node)) {
      freeze((node as Record<string, unknown>)[key]);
    }
  };
  freeze(clone);
  return clone;
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
 * own containment/symlink checks against the CURRENT filesystem state.
 *
 * Exported (internal — never re-exported from `./index`) so the TEST-ONLY,
 * unpackaged `cli/test/standalone-runner-test-support.ts` can perform the
 * IDENTICAL re-resolution production's own `execute` closure performs,
 * without this module ever exporting anything that accepts a delegate
 * (finding 5, 2026-07-22 review). This function only ever resolves a path
 * from disk — it has no capability to execute anything.
 *
 * Called once at bind time (feasibility only, via `planStandaloneProductBinding`)
 * and again, unconditionally, immediately before every `execute` call
 * (finding 2 — TOCTOU; the residual, non-zero window between that
 * re-verification and the OS actually opening the file for exec is
 * documented as finding 6 above and in `docs/specs/intent-binding-consent.md`).
 */
export async function resolveExecutableForCommand(
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

/** An immutable, execution-time-safe snapshot of everything a binding's `execute` reads (finding 4, 2026-07-22 review). */
export interface StandaloneBindingPlan {
  readonly descriptor: ProductCapabilityDescriptor;
  readonly command: ProductCommandDeclaration;
  readonly candidateRoots: readonly string[];
}

export type StandaloneBindingPlanResult =
  | { ok: true; plan: StandaloneBindingPlan }
  | { ok: false; error: StandaloneBindingError; diagnostics?: readonly ProductCapabilityDiagnostic[] };

/**
 * Validate, snapshot, and resolve everything a standalone binding needs —
 * EXCEPT which delegate function actually executes it. Shared, delegate-free
 * core reused by both production's `resolveStandaloneProductBinding` (below,
 * hardcoded to `delegateProduct`) and the TEST-ONLY, unpackaged
 * `cli/test/standalone-runner-test-support.ts` (finding 5, 2026-07-22
 * review) — both build their own tiny `execute` composition against the
 * IDENTICAL validated, frozen plan this function produces, so test coverage
 * can never silently drift from what production actually validates/resolves.
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
 * - `command-not-found` — no command in the (frozen, snapshotted)
 *   descriptor has this exact `path`.
 * - `executable-unresolved` — no candidate root's OWN manifest (read fresh
 *   from disk — never the caller's assertion about it, finding 1b) declares
 *   a bin that resolves to a real, contained file. No plan is produced in
 *   this case either; there is no fallback, guess, or partial resolution
 *   (never-authority invariant).
 *
 * The descriptor is deep-cloned-and-frozen (`deepFreezeClone`) BEFORE
 * anything else reads it, so post-return mutation of the caller's original
 * descriptor/command objects has zero effect on the returned plan or on
 * anything built from it (finding 4).
 */
export async function planStandaloneProductBinding(
  descriptor: ProductCapabilityDescriptor,
  commandPath: readonly string[],
  candidateRoots: readonly string[],
): Promise<StandaloneBindingPlanResult> {
  const validated = validateProductCapabilityDescriptor(descriptor);
  if (!validated.ok) return { ok: false, error: "descriptor-invalid", diagnostics: validated.diagnostics };

  // Snapshot BEFORE any further read: nothing below this line — including
  // whatever `execute` closure a caller eventually builds from this plan —
  // ever reads the caller's live, mutable descriptor/command objects again.
  const frozenDescriptor = deepFreezeClone(validated.descriptor);
  const frozenRoots = Object.freeze([...candidateRoots]);

  const joined = commandPath.join(" ");
  const command = frozenDescriptor.commands.find((candidate) => candidate.path.join(" ") === joined);
  if (!command) return { ok: false, error: "command-not-found" };

  const mutates = command.sideEffect === "write-local" || command.sideEffect === "write-external";
  if (mutates && command.authority.confirmation === "never") {
    return { ok: false, error: "confirmation-contradiction" };
  }

  // Bind-time feasibility check only. The plan's consumer must re-resolve
  // unconditionally immediately before delegating (finding 2).
  const feasibility = await resolveExecutableForCommand(frozenDescriptor, command, frozenRoots);
  if (!feasibility.ok) return { ok: false, error: "executable-unresolved", diagnostics: feasibility.diagnostics };

  return { ok: true, plan: { descriptor: frozenDescriptor, command, candidateRoots: frozenRoots } };
}

/**
 * Build an `execute` from a validated plan and a delegate. PRIVATE and
 * NEVER exported — not even internally — so there is no code path anywhere
 * in this module's packaged output that accepts a delegate other than the
 * hardcoded `delegateProduct` `resolveStandaloneProductBinding` passes
 * below (finding 5, 2026-07-22 review). The TEST-ONLY, unpackaged
 * `cli/test/standalone-runner-test-support.ts` duplicates this same ~10
 * lines rather than importing it, precisely so this function never needs
 * to be exported.
 */
function buildExecute<TIntent extends BindableIntent>(
  plan: StandaloneBindingPlan,
  delegate: DelegateFn,
  delegateOptions: DelegateOptions | undefined,
): (intent: TIntent) => Promise<void> {
  return async () => {
    const fresh = await resolveExecutableForCommand(plan.descriptor, plan.command, plan.candidateRoots);
    if (!fresh.ok) {
      throw new StandaloneRunnerExecutionError(
        "The resolved product executable could not be re-verified immediately before execution.",
        fresh.diagnostics,
      );
    }
    // Defensive copy: never hand a shared/mutable argv array to a delegate.
    await delegate(fresh.executablePath, [...fresh.argv], delegateOptions);
  };
}

/**
 * Resolve ONE `HostIntentBinding` for a standalone host: given a descriptor
 * and the command path it declares, resolve that command's executable
 * against a set of candidate package ROOT directories, and produce an
 * `execute` that re-resolves and delegates to the resolved bin.
 *
 * See `planStandaloneProductBinding` above for the full validation/error
 * contract this delegates to. The only thing this function adds is wiring
 * the validated plan to the real `delegateProduct` — hardcoded, never
 * read from `options` or anywhere else a caller could influence
 * (finding 5, 2026-07-22 review: `StandaloneProductBindingOptions` has
 * never had, and still does not have, a delegate field of any kind).
 *
 * The produced `execute` re-resolves the executable from scratch
 * immediately before delegating (finding 2 — TOCTOU, residual window
 * documented as finding 6 above) and always calls the real
 * `delegateProduct` with the resolved executable path and a freshly-copied
 * argv array — never a shell string.
 */
export async function resolveStandaloneProductBinding<TIntent extends BindableIntent = BindableIntent>(
  descriptor: ProductCapabilityDescriptor,
  commandPath: readonly string[],
  candidateRoots: readonly string[],
  options: StandaloneProductBindingOptions = {},
): Promise<StandaloneProductBindingResult<TIntent>> {
  const planned = await planStandaloneProductBinding(descriptor, commandPath, candidateRoots);
  if (!planned.ok) return planned;

  const execute = buildExecute<TIntent>(planned.plan, delegateProduct, options.delegateOptions);
  return intentBindingFromCommand<TIntent>(planned.plan.descriptor, commandPath, execute);
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
