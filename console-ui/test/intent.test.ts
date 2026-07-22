import assert from "node:assert/strict";
import test from "node:test";
import type { HostIntentBinding } from "@kontourai/console-core";
import { bindIntentHandler, type ConsoleIntent } from "../lib/src/intent";

function intent(product: string, command: string, overrides: Partial<ConsoleIntent> = {}): ConsoleIntent {
  return {
    id: `${product}:${command}`,
    kind: command,
    readOnly: false,
    authority: { product, command },
    ...overrides
  };
}

test("bindIntentHandler: confirmation 'never' executes immediately, calling the exact host-supplied executor", () => {
  const calls: ConsoleIntent[] = [];
  const bindings: HostIntentBinding<ConsoleIntent>[] = [
    { product: "console", command: "board.select-card", sideEffect: "none", confirmation: "never", execute: (i) => calls.push(i) }
  ];
  const handler = bindIntentHandler(bindings);

  const emitted = intent("console", "board.select-card");
  handler(emitted);

  assert.deepEqual(calls, [emitted]);
});

test("bindIntentHandler: an unbound authority never executes anything — onUnbound observes it instead", () => {
  const calls: unknown[] = [];
  const unbound: unknown[] = [];
  const bindings: HostIntentBinding<ConsoleIntent>[] = [
    { product: "console", command: "board.select-card", sideEffect: "none", confirmation: "never", execute: (i) => calls.push(i) }
  ];
  const handler = bindIntentHandler(bindings, { onUnbound: (i, resolution) => unbound.push([i, resolution]) });

  handler(intent("flow", "cancel"));

  assert.deepEqual(calls, []);
  assert.equal(unbound.length, 1);
  const [, resolution] = unbound[0] as [ConsoleIntent, { bound: false; reason: string }];
  assert.equal(resolution.bound, false);
  assert.equal(resolution.reason, "no-matching-binding");
});

test("bindIntentHandler: a bound side-effecting intent with NO confirm gate wired never executes — onConsentRequired observes it", () => {
  const calls: unknown[] = [];
  const consentRequired: unknown[] = [];
  const bindings: HostIntentBinding<ConsoleIntent>[] = [
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "user-request", execute: (i) => calls.push(i) }
  ];
  const handler = bindIntentHandler(bindings, { onConsentRequired: (i) => consentRequired.push(i) });

  handler(intent("flow", "cancel"));

  assert.deepEqual(calls, []);
  assert.equal(consentRequired.length, 1);
});

test("bindIntentHandler: confirm() returning false withholds execution", async () => {
  const calls: unknown[] = [];
  const bindings: HostIntentBinding<ConsoleIntent>[] = [
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "user-request", execute: (i) => calls.push(i) }
  ];
  const handler = bindIntentHandler(bindings, { confirm: () => false });

  handler(intent("flow", "cancel"));
  // confirm/execute run through a microtask (Promise.resolve().then(...)).
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, []);
});

test("bindIntentHandler: confirm() returning/resolving true executes the bound handler", async () => {
  const calls: ConsoleIntent[] = [];
  const bindings: HostIntentBinding<ConsoleIntent>[] = [
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "operator-request", execute: (i) => calls.push(i) }
  ];
  const handler = bindIntentHandler(bindings, { confirm: async () => true });

  const emitted = intent("flow", "cancel");
  handler(emitted);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [emitted]);
});

test("bindIntentHandler: never-authority invariant — two hosts binding the same command under different products stay isolated", () => {
  const consoleCalls: unknown[] = [];
  const flowCalls: unknown[] = [];
  const bindings: HostIntentBinding<ConsoleIntent>[] = [
    { product: "console", command: "cancel", sideEffect: "none", confirmation: "never", execute: (i) => consoleCalls.push(i) },
    { product: "flow", command: "cancel", sideEffect: "write-local", confirmation: "never", execute: (i) => flowCalls.push(i) }
  ];
  const handler = bindIntentHandler(bindings);

  handler(intent("flow", "cancel"));

  assert.equal(consoleCalls.length, 0);
  assert.equal(flowCalls.length, 1);
});
