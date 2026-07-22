import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { ProductCapabilityDescriptor } from "@kontourai/console-core/product-capability-descriptor";
import {
  createStandaloneRunner,
  resolveStandaloneProductBinding,
  StandaloneRunnerExecutionError,
  type StandaloneProductBindingOptions,
} from "../src/standalone-runner";
import { resolveStandaloneProductBindingForTest, type DelegateFn } from "./standalone-runner-test-support";

const fixtures = resolve(fileURLToPath(new URL("./fixtures/packages", import.meta.url)));

/** Copies a fixture package into a writable tmp dir and chmods its declared bins so it is a genuine, executable, on-disk package root. */
async function fixtureRoot(id: "flow" | "flow-agents" | "console"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `kontour-standalone-${id}-`));
  await cp(join(fixtures, id), root, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { bin: Record<string, string> };
  for (const bin of Object.values(manifest.bin)) await chmod(join(root, bin), 0o755);
  return root;
}

/** Minimal, hand-authored descriptor mirroring console-core's own flow fixture, with one `confirmation: "never"` and one `confirmation: "user-request"` command. */
function flowDescriptor(): ProductCapabilityDescriptor {
  return {
    schemaVersion: "1.0.0",
    protocolVersion: "1.0.0",
    product: { id: "flow", displayName: "Flow", packageName: "@kontourai/flow" },
    executables: [{ id: "flow-cli", packageBin: "flow" }],
    commands: [
      {
        path: ["status"],
        summary: "Read a product-owned Flow run.",
        executableId: "flow-cli",
        argv: ["status"],
        sideEffect: "read-local",
        authority: { kind: "product", productId: "flow", confirmation: "never" },
      },
      {
        path: ["cancel"],
        summary: "Request cancellation of a product-owned Flow run.",
        executableId: "flow-cli",
        argv: ["cancel"],
        sideEffect: "write-local",
        authority: { kind: "product", productId: "flow", confirmation: "user-request" },
      },
    ],
    artifacts: [],
    projections: [],
  };
}

function intent(product: string, command: string): { authority: { product: string; command: string } } {
  return { authority: { product, command } };
}

function recordingDelegate(): { delegate: DelegateFn; calls: Array<{ executable: string; argv: readonly string[] }> } {
  const calls: Array<{ executable: string; argv: readonly string[] }> = [];
  const delegate: DelegateFn = async (executable, argv) => {
    calls.push({ executable, argv });
    return 0;
  };
  return { delegate, calls };
}

/**
 * `execute` now re-resolves the executable from disk (real fs I/O, finding
 * 2's TOCTOU fix) immediately before delegating, so a fixed short sleep
 * after triggering a runner is not a safe bound under system I/O
 * contention. Poll for the expected observable effect instead.
 */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!(await predicate())) throw new Error("timed out waiting for condition");
}

test("resolveStandaloneProductBinding: resolves a confirmation:never command and delegates to the resolved product bin", async () => {
  const descriptor = flowDescriptor();
  const root = await fixtureRoot("flow");
  const { delegate, calls } = recordingDelegate();

  const result = await resolveStandaloneProductBindingForTest(descriptor, ["status"], [root], delegate);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding.product, "flow");
  assert.equal(result.binding.command, "status");
  assert.equal(result.binding.confirmation, "never");

  const runner = createStandaloneRunner([result.binding]);
  runner(intent("flow", "status"));
  await waitFor(() => calls.length > 0);

  assert.equal(calls.length, 1);
  assert.match(calls[0].executable, /bin[/\\]record\.mjs$/);
  assert.deepEqual(calls[0].argv, ["status"]);
});

test("createStandaloneRunner: a user-request command never delegates until confirm resolves the literal true", async () => {
  const descriptor = flowDescriptor();
  const root = await fixtureRoot("flow");
  const { delegate, calls } = recordingDelegate();

  const result = await resolveStandaloneProductBindingForTest(descriptor, ["cancel"], [root], delegate);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding.confirmation, "user-request");

  const adversarialValues: unknown[] = ["yes", 1, {}, 0, "", null, undefined, false, "true"];
  for (const value of adversarialValues) {
    const runner = createStandaloneRunner([result.binding], { confirm: () => value });
    runner(intent("flow", "cancel"));
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(calls.length, 0, "no adversarial confirm value ever authorized execution");

  // No confirm gate wired at all: still withheld, and onConsentRequired fires instead.
  let consentRequired = 0;
  const withoutConfirm = createStandaloneRunner([result.binding], { onConsentRequired: () => { consentRequired += 1; } });
  withoutConfirm(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 0);
  assert.equal(consentRequired, 1);

  // A throwing confirm gate withholds execution and routes to onConsentError.
  let consentError: unknown;
  const throwing = createStandaloneRunner([result.binding], {
    confirm: () => { throw new Error("boom"); },
    onConsentError: (_intent, _resolution, error) => { consentError = error; },
  });
  throwing(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 0);
  assert.ok(consentError instanceof Error);

  // A rejecting confirm gate withholds execution and routes to onConsentError.
  let rejectionError: unknown;
  const rejecting = createStandaloneRunner([result.binding], {
    confirm: () => Promise.reject(new Error("nope")),
    onConsentError: (_intent, _resolution, error) => { rejectionError = error; },
  });
  rejecting(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 0);
  assert.ok(rejectionError instanceof Error);

  // Only the literal boolean true authorizes execution.
  const authorized = createStandaloneRunner([result.binding], { confirm: () => true });
  authorized(intent("flow", "cancel"));
  await waitFor(() => calls.length > 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ["cancel"]);
});

test("never-authority invariant: an unresolvable executable produces NO binding/executor", async () => {
  const descriptor = flowDescriptor();

  const noRoots = await resolveStandaloneProductBinding(descriptor, ["status"], []);
  assert.equal(noRoots.ok, false);
  if (noRoots.ok) return;
  assert.equal(noRoots.error, "executable-unresolved");
  assert.ok(!("binding" in noRoots));

  // A root that is not even a directory (or has no package.json at all)
  // never contributes a candidate — there is no caller-supplied
  // packageName/bins fallback to fall back to.
  const emptyRoot = await mkdtemp(join(tmpdir(), "kontour-standalone-empty-"));
  const emptyRootResult = await resolveStandaloneProductBinding(descriptor, ["status"], [emptyRoot]);
  assert.equal(emptyRootResult.ok, false);
  if (emptyRootResult.ok) return;
  assert.equal(emptyRootResult.error, "executable-unresolved");

  const unknownCommand = await resolveStandaloneProductBinding(descriptor, ["does-not-exist"], []);
  assert.equal(unknownCommand.ok, false);
  if (unknownCommand.ok) return;
  assert.equal(unknownCommand.error, "command-not-found");

  // A command whose authority disagrees with the descriptor's own product
  // identity (a laundering attempt) never produces a binding either, even
  // though a resolvable executable exists. `validateProductCapabilityDescriptor`
  // (run up front — finding 1a) already rejects this shape as
  // DESCRIPTOR_AUTHORITY_MISMATCH, so it surfaces as "descriptor-invalid"
  // before `intentBindingFromCommand`'s own redundant authority re-check
  // would even run.
  const launderedDescriptor: ProductCapabilityDescriptor = {
    ...descriptor,
    commands: [
      { ...descriptor.commands[0], authority: { kind: "product", productId: "flow-agents", confirmation: "never" } },
      descriptor.commands[1],
    ],
  };
  const root = await fixtureRoot("flow");
  const laundered = await resolveStandaloneProductBinding(launderedDescriptor, ["status"], [root]);
  assert.equal(laundered.ok, false);
  if (laundered.ok) return;
  assert.equal(laundered.error, "descriptor-invalid");
});

test("opt-in default: without a runner (or with no bindings wired), the identical intent stays inert", async () => {
  const { delegate, calls } = recordingDelegate();
  void delegate;

  // No standalone runner constructed at all for this authority: nothing in
  // this module is ever invoked — this is not a special case to test, it is
  // simply never calling `createStandaloneRunner`/`resolveStandaloneProductBinding`.

  // An explicitly-constructed runner with no bindings wired (the opt-in
  // surface exists, but the host declared nothing) resolves unbound and
  // never executes anything, exactly like the C4 host-binding contract.
  let unboundReason: string | undefined;
  const runner = createStandaloneRunner([], {
    onUnbound: (_intent, resolution) => { unboundReason = resolution.reason; },
  });
  runner(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(calls.length, 0);
  assert.equal(unboundReason, "no-matching-binding");
});

// --- 2026-07-20 security review regression tests ---

test("finding 1a: a structurally-typed but invalid descriptor is rejected before anything is resolved", async () => {
  const forged: ProductCapabilityDescriptor = { ...flowDescriptor(), commands: [] };
  const result = await resolveStandaloneProductBinding(forged, ["status"], []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "descriptor-invalid");
  assert.ok(result.diagnostics && result.diagnostics.length > 0);
});

test("finding 1b: candidate identity is derived from the ACTUAL on-disk manifest, never trusted from a caller-provided root alone", async () => {
  const descriptor = flowDescriptor();
  // A real, legitimate, executable package root — but its manifest declares
  // "@kontourai/flow-agents", not the "@kontourai/flow" the descriptor
  // expects. Even though this root is a genuine, unforged product package,
  // it must never be accepted as a candidate for a DIFFERENT product's
  // descriptor merely because the caller listed its directory.
  const mismatchedRoot = await fixtureRoot("flow-agents");
  const result = await resolveStandaloneProductBinding(descriptor, ["status"], [mismatchedRoot]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "executable-unresolved");
});

test("finding 1c: a write-* command declaring confirmation:'never' is rejected as a semantic contradiction", async () => {
  const contradictory: ProductCapabilityDescriptor = {
    ...flowDescriptor(),
    commands: [
      {
        path: ["cancel"],
        summary: "Request cancellation of a product-owned Flow run.",
        executableId: "flow-cli",
        argv: ["cancel"],
        sideEffect: "write-local",
        authority: { kind: "product", productId: "flow", confirmation: "never" },
      },
    ],
  };
  const root = await fixtureRoot("flow");
  const result = await resolveStandaloneProductBinding(contradictory, ["cancel"], [root]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "confirmation-contradiction");

  // write-external is the same contradiction.
  const contradictoryExternal: ProductCapabilityDescriptor = {
    ...contradictory,
    commands: [{ ...contradictory.commands[0], sideEffect: "write-external" }],
  };
  const resultExternal = await resolveStandaloneProductBinding(contradictoryExternal, ["cancel"], [root]);
  assert.equal(resultExternal.ok, false);
  if (resultExternal.ok) return;
  assert.equal(resultExternal.error, "confirmation-contradiction");

  // A read-local command with confirmation:"never" is NOT a contradiction.
  const readNever: ProductCapabilityDescriptor = {
    ...contradictory,
    commands: [{ ...contradictory.commands[0], path: ["status"], sideEffect: "read-local" }],
  };
  const okResult = await resolveStandaloneProductBinding(readNever, ["status"], [root]);
  assert.equal(okResult.ok, true);
});

test("finding 2: a path swapped between binding and a delayed confirm:true does NOT execute the swapped target", async () => {
  const descriptor = flowDescriptor();
  const root = await fixtureRoot("flow");
  const { delegate, calls } = recordingDelegate();

  const result = await resolveStandaloneProductBindingForTest(descriptor, ["cancel"], [root], delegate);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Swap the resolved bin, AFTER binding but BEFORE consent settles, for a
  // symlink escaping the candidate root — the classic TOCTOU substitution.
  const outsideRoot = await mkdtemp(join(tmpdir(), "kontour-standalone-outside-"));
  const swappedTarget = join(outsideRoot, "swapped.mjs");
  await writeFile(swappedTarget, "#!/usr/bin/env node\n");
  await chmod(swappedTarget, 0o755);
  const originalBin = join(root, "bin", "record.mjs");
  await rm(originalBin);
  await symlink(swappedTarget, originalBin);

  let executeError: unknown;
  const runner = createStandaloneRunner([result.binding], {
    // Simulate an arbitrarily-delayed user confirmation.
    confirm: () => new Promise((resolve) => setTimeout(() => resolve(true), 20)),
    onExecuteError: (_intent, _resolution, error) => { executeError = error; },
  });
  runner(intent("flow", "cancel"));
  await waitFor(() => executeError !== undefined || calls.length > 0);

  assert.equal(calls.length, 0, "the swapped/escaping target must never be spawned");
  assert.ok(executeError instanceof StandaloneRunnerExecutionError, "re-verification failure is surfaced, not silently swallowed");
});

// --- 2026-07-22 confirmation follow-up review regression tests ---

test("finding 4: mutable-object reuse — post-bind mutation of the caller's own command does not change what executes", async () => {
  const descriptor = flowDescriptor();
  const root = await fixtureRoot("flow");
  const { delegate, calls } = recordingDelegate();

  // The caller's OWN, still-mutable command object — `flowDescriptor()`
  // never freezes anything, exactly like a real host's descriptor.
  const statusCommand = descriptor.commands.find((c) => c.path.join(" ") === "status");
  assert.ok(statusCommand);
  assert.equal(statusCommand!.authority.confirmation, "never");

  const result = await resolveStandaloneProductBindingForTest(descriptor, ["status"], [root], delegate);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding.confirmation, "never");

  // Mutate the bound command's argv, sideEffect, and confirmation IN PLACE
  // after binding. Pre-fix, `execute` re-derived argv from this exact live
  // object at call time, so this would run "cancel" under the "status"
  // binding's already-fixed confirmation:"never" gate — a write command
  // executed with NO consent check at all.
  const mutableArgv = statusCommand!.argv as string[];
  mutableArgv.length = 0;
  mutableArgv.push("cancel");
  (statusCommand as unknown as { sideEffect: string }).sideEffect = "write-local";
  (statusCommand!.authority as unknown as { confirmation: string }).confirmation = "user-request";

  const runner = createStandaloneRunner([result.binding]);
  runner(intent("flow", "status"));
  await waitFor(() => calls.length > 0);

  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].argv,
    ["status"],
    "the bound execute must run the argv snapshot captured at bind time, never a post-bind mutation of the caller's live command object",
  );
});

test("finding 5: a caller-supplied __TEST_ONLY_delegate property on the PUBLIC options has zero runtime effect", async () => {
  const descriptor = flowDescriptor();
  const root = await fixtureRoot("flow");
  const recordFile = join(root, "record.jsonl");

  let spyCalls = 0;
  // An adversarial JS caller of the PUBLIC `resolveStandaloneProductBinding`
  // — no special import, just an extra property `StandaloneProductBindingOptions`
  // has never declared. The cast simulates what a plain (non-TypeScript, or
  // TS-bypassing) caller can do with zero extra effort.
  const maliciousOptions = {
    delegateOptions: { env: { ...process.env, KONTOUR_RECORD_FILE: recordFile }, stdio: "ignore" },
    __TEST_ONLY_delegate: async () => { spyCalls += 1; return 0; },
  } as unknown as StandaloneProductBindingOptions;

  const result = await resolveStandaloneProductBinding(descriptor, ["status"], [root], maliciousOptions);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const runner = createStandaloneRunner([result.binding]);
  runner(intent("flow", "status"));

  await waitFor(async () => {
    try {
      return (await readFile(recordFile, "utf8")).trim().length > 0;
    } catch {
      return false;
    }
  });

  const recorded = JSON.parse((await readFile(recordFile, "utf8")).trim()) as { product: string; argv: string[] };
  assert.equal(recorded.product, "flow", "the REAL delegateProduct must have spawned the real fixture bin");
  assert.deepEqual(recorded.argv, ["status"]);
  assert.equal(spyCalls, 0, "the injected __TEST_ONLY_delegate property must never be read or called by production code");
});
