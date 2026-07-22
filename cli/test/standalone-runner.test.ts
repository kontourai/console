import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { LocalProductPackageCandidate, ProductCapabilityDescriptor } from "@kontourai/console-core/product-capability-descriptor";
import {
  createStandaloneRunner,
  resolveStandaloneProductBinding,
  type DelegateFn,
} from "../src/standalone-runner";

const fixtures = resolve(fileURLToPath(new URL("./fixtures/packages", import.meta.url)));

async function fixtureCandidate(id: "flow" | "flow-agents" | "console"): Promise<LocalProductPackageCandidate> {
  const root = await mktempFixture(id);
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name: string; bin: Record<string, string> };
  for (const bin of Object.values(manifest.bin)) await chmod(join(root, bin), 0o755);
  return { root, packageName: manifest.name, bins: manifest.bin };
}

async function mktempFixture(id: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `kontour-standalone-${id}-`));
  await cp(join(fixtures, id), root, { recursive: true });
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

test("resolveStandaloneProductBinding: resolves a confirmation:never command and delegates to the resolved product bin", async () => {
  const descriptor = flowDescriptor();
  const candidate = await fixtureCandidate("flow");
  const { delegate, calls } = recordingDelegate();

  const result = await resolveStandaloneProductBinding(descriptor, ["status"], [candidate], { delegate });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding.product, "flow");
  assert.equal(result.binding.command, "status");
  assert.equal(result.binding.confirmation, "never");

  const runner = createStandaloneRunner([result.binding]);
  runner(intent("flow", "status"));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(calls.length, 1);
  assert.match(calls[0].executable, /bin[/\\]record\.mjs$/);
  assert.deepEqual(calls[0].argv, ["status"]);
});

test("createStandaloneRunner: a user-request command never delegates until confirm resolves the literal true", async () => {
  const descriptor = flowDescriptor();
  const candidate = await fixtureCandidate("flow");
  const { delegate, calls } = recordingDelegate();

  const result = await resolveStandaloneProductBinding(descriptor, ["cancel"], [candidate], { delegate });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.binding.confirmation, "user-request");

  const adversarialValues: unknown[] = ["yes", 1, {}, 0, "", null, undefined, false, "true"];
  for (const value of adversarialValues) {
    const runner = createStandaloneRunner([result.binding], { confirm: () => value });
    runner(intent("flow", "cancel"));
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(calls.length, 0, "no adversarial confirm value ever authorized execution");

  // No confirm gate wired at all: still withheld, and onConsentRequired fires instead.
  let consentRequired = 0;
  const withoutConfirm = createStandaloneRunner([result.binding], { onConsentRequired: () => { consentRequired += 1; } });
  withoutConfirm(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 0);
  assert.equal(consentRequired, 1);

  // A throwing confirm gate withholds execution and routes to onConsentError.
  let consentError: unknown;
  const throwing = createStandaloneRunner([result.binding], {
    confirm: () => { throw new Error("boom"); },
    onConsentError: (_intent, _resolution, error) => { consentError = error; },
  });
  throwing(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 0);
  assert.ok(consentError instanceof Error);

  // A rejecting confirm gate withholds execution and routes to onConsentError.
  let rejectionError: unknown;
  const rejecting = createStandaloneRunner([result.binding], {
    confirm: () => Promise.reject(new Error("nope")),
    onConsentError: (_intent, _resolution, error) => { rejectionError = error; },
  });
  rejecting(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 0);
  assert.ok(rejectionError instanceof Error);

  // Only the literal boolean true authorizes execution.
  const authorized = createStandaloneRunner([result.binding], { confirm: () => true });
  authorized(intent("flow", "cancel"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ["cancel"]);
});

test("never-authority invariant: an unresolvable executable produces NO binding/executor", async () => {
  const descriptor = flowDescriptor();

  const noCandidates = await resolveStandaloneProductBinding(descriptor, ["status"], []);
  assert.equal(noCandidates.ok, false);
  if (noCandidates.ok) return;
  assert.equal(noCandidates.error, "executable-unresolved");
  assert.ok(!("binding" in noCandidates));

  const unknownCommand = await resolveStandaloneProductBinding(descriptor, ["does-not-exist"], []);
  assert.equal(unknownCommand.ok, false);
  if (unknownCommand.ok) return;
  assert.equal(unknownCommand.error, "command-not-found");

  // A command whose authority disagrees with the descriptor's own product
  // identity (a laundering attempt) never produces a binding either, even
  // though a resolvable executable exists.
  const launderedDescriptor: ProductCapabilityDescriptor = {
    ...descriptor,
    commands: [
      { ...descriptor.commands[0], authority: { kind: "product", productId: "flow-agents", confirmation: "never" } },
      descriptor.commands[1],
    ],
  };
  const candidate = await fixtureCandidate("flow");
  const laundered = await resolveStandaloneProductBinding(launderedDescriptor, ["status"], [candidate]);
  assert.equal(laundered.ok, false);
  if (laundered.ok) return;
  assert.equal(laundered.error, "authority-mismatch");
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
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(calls.length, 0);
  assert.equal(unboundReason, "no-matching-binding");
});
