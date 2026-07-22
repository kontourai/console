/**
 * TEST-ONLY (finding 5, 2026-07-22 confirmation follow-up security review).
 *
 * This module lives under `cli/test/`, NOT `cli/src/`:
 * `cli/tsconfig.build.json`'s `rootDir`/`include` is scoped to `src/**`, and
 * `cli/package.json`'s `files` never lists `test`, so nothing here is ever
 * compiled into `dist/` or published in the npm tarball — there is no
 * `require.resolve('@kontourai/cli')`-relative absolute path that reaches
 * this file at all, packaged or not.
 *
 * It exists so this workspace's OWN tests can observe what a resolved
 * standalone binding WOULD run without spawning a real process. The
 * previous approach (`__TEST_ONLY_withDelegateOverride` + a runtime
 * `options.__TEST_ONLY_delegate` property read inside
 * `../src/standalone-runner`) was itself finding 5: ANY caller of the
 * PUBLIC `resolveStandaloneProductBinding` could pass
 * `{ __TEST_ONLY_delegate: fn }` and have it take effect regardless of
 * what the TS type declared, and the bypass-constructing helper shipped in
 * packaged `dist` besides. `../src/standalone-runner` now has NO
 * delegate-accepting exported function anywhere — not even internally —
 * so there is nothing left to smuggle a delegate into. This module
 * instead duplicates the small (~10 line) plan-to-`execute` composition
 * step against `../src/standalone-runner`'s exported, delegate-FREE
 * `planStandaloneProductBinding`/`resolveExecutableForCommand` internals,
 * taking the delegate as a genuine, explicit parameter of its own,
 * separately-exported, never-packaged function.
 */
import type { BindableIntent, HostIntentBinding } from "@kontourai/console-core/intent-binding";
import { intentBindingFromCommand } from "@kontourai/console-core/intent-binding";
import type { ProductCapabilityDescriptor, ProductCapabilityDiagnostic } from "@kontourai/console-core/product-capability-descriptor";
import type { DelegateOptions } from "../src/delegate";
import {
  planStandaloneProductBinding,
  resolveExecutableForCommand,
  StandaloneRunnerExecutionError,
  type DelegateFn,
  type StandaloneBindingError,
} from "../src/standalone-runner";

export type { DelegateFn };

export type StandaloneTestBindingResult<TIntent extends BindableIntent = BindableIntent> =
  | { ok: true; binding: HostIntentBinding<TIntent> }
  | { ok: false; error: StandaloneBindingError; diagnostics?: readonly ProductCapabilityDiagnostic[] };

/**
 * Test-only equivalent of `resolveStandaloneProductBinding` that takes a
 * delegate as a genuine, explicit parameter (never a property sniffed off
 * an options bag), so a test can assert what WOULD run without spawning a
 * real process.
 *
 * Reuses the IDENTICAL validated/frozen plan production builds
 * (`planStandaloneProductBinding` — same validation, same finding-1
 * forged-descriptor/candidate rejection, same finding-4 deep-freeze
 * snapshot) and the IDENTICAL TOCTOU re-resolution
 * (`resolveExecutableForCommand`) production's own `execute` performs. The
 * ONLY difference from production is which function `execute` calls at the
 * end — this test-only composition step is duplicated here rather than
 * shared with production specifically so production never exports (even
 * internally) a delegate-accepting function (finding 5).
 */
export async function resolveStandaloneProductBindingForTest<TIntent extends BindableIntent = BindableIntent>(
  descriptor: ProductCapabilityDescriptor,
  commandPath: readonly string[],
  candidateRoots: readonly string[],
  delegate: DelegateFn,
  delegateOptions?: DelegateOptions,
): Promise<StandaloneTestBindingResult<TIntent>> {
  const planned = await planStandaloneProductBinding(descriptor, commandPath, candidateRoots);
  if (!planned.ok) return planned;
  const { plan } = planned;

  const execute = async (): Promise<void> => {
    const fresh = await resolveExecutableForCommand(plan.descriptor, plan.command, plan.candidateRoots);
    if (!fresh.ok) {
      throw new StandaloneRunnerExecutionError(
        "The resolved product executable could not be re-verified immediately before execution.",
        fresh.diagnostics,
      );
    }
    await delegate(fresh.executablePath, [...fresh.argv], delegateOptions);
  };

  return intentBindingFromCommand<TIntent>(plan.descriptor, commandPath, execute);
}
