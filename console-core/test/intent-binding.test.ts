import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  intentBindingFromCommand,
  resolveIntentBinding,
  validateProductCapabilityDescriptor,
  type HostIntentBinding,
  type ProductCapabilityDescriptor
} from "../src/index";

async function readFixture(name: "flow" | "flow-agents" | "console"): Promise<ProductCapabilityDescriptor> {
  const url = new URL(`./fixtures/product-capability-descriptors/${name}.json`, import.meta.url);
  const input = JSON.parse(await readFile(url, "utf8"));
  const result = validateProductCapabilityDescriptor(input);
  assert.equal(result.ok, true, `fixture ${name} did not validate: ${JSON.stringify((result as { diagnostics: unknown }).diagnostics)}`);
  return (result as { ok: true; descriptor: ProductCapabilityDescriptor }).descriptor;
}

function intent(product: string, command: string) {
  return { authority: { product, command } };
}

test("resolveIntentBinding: unique matching binding resolves bound, with the EXACT execute reference supplied", () => {
  const execute = () => {};
  const bindings: HostIntentBinding[] = [
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "user-request", execute }
  ];

  const result = resolveIntentBinding(intent("flow", "cancel"), bindings);

  assert.equal(result.bound, true);
  if (!result.bound) throw new Error("unreachable");
  assert.equal(result.product, "flow");
  assert.equal(result.command, "cancel");
  assert.equal(result.sideEffect, "write-local");
  assert.equal(result.confirmation, "user-request");
  // Identity, not a wrapped/rebuilt function: the resolver never synthesizes
  // an executor, it only ever returns the host-supplied reference.
  assert.equal(result.execute, execute);
});

test("resolveIntentBinding: an intent with no authority never resolves bound", () => {
  const bindings: HostIntentBinding[] = [
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "user-request", execute: () => {} }
  ];

  assert.deepEqual(resolveIntentBinding({}, bindings), { bound: false, reason: "missing-authority" });
  assert.deepEqual(resolveIntentBinding({ authority: {} }, bindings), { bound: false, reason: "missing-authority" });
  assert.deepEqual(resolveIntentBinding({ authority: { product: "flow" } }, bindings), { bound: false, reason: "missing-authority" });
});

test("never-authority invariant: a host binding for a DIFFERENT authority never binds an unrelated intent", () => {
  // Host only declared console's own board-select authority.
  const bindings: HostIntentBinding[] = [
    { product: "console", command: "board.select-card", sideEffect: "none", confirmation: "never", execute: () => {} }
  ];

  // An intent asking for Flow's write authority must not resolve, even
  // though a binding array is non-empty and the resolver has SOME bindings
  // to choose from — it must never pick "the closest" or "the only" one for
  // an authority nobody declared.
  const result = resolveIntentBinding(intent("flow", "cancel"), bindings);
  assert.deepEqual(result, { bound: false, reason: "no-matching-binding", product: "flow", command: "cancel" });
  assert.ok(!("execute" in result));
});

test("never-authority invariant: an empty binding set never binds anything", () => {
  const result = resolveIntentBinding(intent("flow", "cancel"), []);
  assert.deepEqual(result, { bound: false, reason: "no-matching-binding", product: "flow", command: "cancel" });
});

test("never-authority invariant: two bindings claiming the same authority resolve unbound, not 'first wins'", () => {
  const first = () => {};
  const second = () => {};
  const bindings: HostIntentBinding[] = [
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "user-request", execute: first },
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "never", execute: second }
  ];

  const result = resolveIntentBinding(intent("flow", "cancel"), bindings);
  assert.deepEqual(result, { bound: false, reason: "ambiguous-binding", product: "flow", command: "cancel" });
});

test("resolveIntentBinding: malformed consent metadata on the matched binding fails closed, not silently accepted", () => {
  const bindings: HostIntentBinding[] = [
    // Cast bypasses compile-time checking to exercise the runtime guard a
    // hostile or buggy caller (e.g. data assembled from an untrusted source)
    // could still hit.
    { product: "flow", command: "cancel", sideEffect: "delete-everything" as never, confirmation: "user-request", execute: () => {} }
  ];

  const result = resolveIntentBinding(intent("flow", "cancel"), bindings);
  assert.deepEqual(result, { bound: false, reason: "invalid-consent-metadata", product: "flow", command: "cancel" });
});

test("intentBindingFromCommand: derives product/command/sideEffect/confirmation from a validated descriptor command, unchanged", async () => {
  const descriptor = await readFixture("flow");
  const cancelCommand = descriptor.commands.find((c) => c.path.join(" ") === "cancel");
  assert.ok(cancelCommand, "flow fixture must declare a cancel command");

  const execute = () => {};
  const binding = intentBindingFromCommand(descriptor, cancelCommand!, execute);

  assert.deepEqual(binding, {
    product: "flow",
    command: "cancel",
    sideEffect: "write-local",
    confirmation: "user-request",
    execute
  });

  // The derived binding round-trips through resolution exactly like a
  // hand-authored one.
  const result = resolveIntentBinding(intent("flow", "cancel"), [binding]);
  assert.equal(result.bound, true);
  if (!result.bound) throw new Error("unreachable");
  assert.equal(result.execute, execute);
});

test("intentBindingFromCommand: a multi-segment command path joins with a single space, matching descriptor diagnostics convention", async () => {
  const descriptor = await readFixture("flow-agents");
  const multiSegment = descriptor.commands.find((c) => c.path.length > 1);
  assert.ok(multiSegment, "flow-agents fixture must declare a multi-segment command for this assertion to be meaningful");

  const binding = intentBindingFromCommand(descriptor, multiSegment!, () => {});
  assert.equal(binding.command, multiSegment!.path.join(" "));
  assert.ok(binding.command.includes(" "));
});

test("read-only, never-confirmation bindings (e.g. console's own board.select-card) resolve bound with confirmation 'never'", () => {
  const execute = () => {};
  const bindings: HostIntentBinding[] = [
    { product: "console", command: "board.select-card", sideEffect: "none", confirmation: "never", execute }
  ];

  const result = resolveIntentBinding(intent("console", "board.select-card"), bindings);
  assert.equal(result.bound, true);
  if (!result.bound) throw new Error("unreachable");
  assert.equal(result.sideEffect, "none");
  assert.equal(result.confirmation, "never");
});
