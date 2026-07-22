---
title: Intent Binding And Consent Policy
description: How a host binds console-ui component intents to product-owned execution authority, and the consent policy for a bound intent that would execute a side effect.
---

# Intent Binding And Consent Policy

`@kontourai/console-ui` components (the board/timeline/fleet view layer, console#230) emit **intents** — data describing a user-triggered request — through an `onIntent` callback. A component never executes anything itself. This mirrors the same discipline the [Product Capability Descriptor Protocol](product-capability-descriptor.md) already states for the CLI router: a descriptor, and by extension an intent, is **transparency, not consent**. Console routes; the named product remains the execution authority (ADR 0001, ADR 0003 §6).

This spec defines the piece that sits between "a component emitted an intent" and "a product-owned side effect happened": how a **host** (the application mounting console-ui components — Station is the first Console-external host; the bundled Console app is a host of its own components) declares which authorities it can bind, what a component does with an intent nobody bound, and the consent policy that governs actually invoking a bound, side-effecting intent. It is local-only; hosted/multi-tenant act is explicitly out of scope (ADR 0003).

## Vocabulary

- **Intent**: a `ConsoleIntent` value (console-ui, `lib/src/intent.ts`), structurally derived from console-core's `ConsoleAction` (`operating-state.ts`) — `id`, `kind`, `readOnly`, `authority: { product, command }`, `subjectRefs`. A component constructs and emits intents; it never interprets `authority` as permission to act.
- **Authority ref**: the `{ product, command }` pair an intent names. It identifies *which product's command* would need to run to satisfy the intent — the same two-part identity a `ProductCapabilityDescriptor` command declares (`product.id` + a command path), not a new vocabulary.
- **Host binding**: a host-declared mapping from one exact authority ref to a product-owned `execute` function, plus the side-effect and confirmation metadata that governs calling it. A host declares zero or more bindings; declaring none leaves every intent unbound.
- **Resolution**: matching one intent against a host's declared bindings. Resolution either returns the *exact* binding the host declared for that authority, or it fails closed — it never returns a substitute, a guess, or a partial match.
- **Consent**: the decision to actually invoke a bound intent's `execute`, governed by the binding's `confirmation` requirement. Resolution surfaces this decision point; it does not make the decision.

## The two boundaries a host must satisfy

### 1. Component boundary — an intent nobody is listening for renders inert

This is unchanged from console#230 and is not new in this spec: a console-ui component left `onIntent`-unbound renders every affected element as inert, read-only content — no button, no fake affordance for an action nobody can receive. `@kontourai/console-ui`'s `BoardView` (`lib/src/BoardView.tsx`) is the reference implementation: when `onIntent` is `undefined`, `BoardCardView` renders a plain `<li>`, never a `<button>` (see `BoardView.test.ts`, `"unbound onIntent renders every card inert"`). Every exported console-ui component follows this rule. This spec's binding/consent layer sits *above* this boundary: a host that wires `onIntent` at all has already opted a component into emitting; whether any given emitted intent goes anywhere is what the next two boundaries answer.

### 2. Binding boundary — an intent whose authority nobody declared resolves inert

A host does not get "everything bound" or "nothing bound" as a single switch. It declares bindings per exact `(product, command)` authority pair, and every other authority — including one that merely looks related — stays unbound. `@kontourai/console-core` exports the resolution primitive:

```ts
import { resolveIntentBinding, type HostIntentBinding } from "@kontourai/console-core";

const hostBindings: HostIntentBinding[] = [
  {
    product: "flow",
    command: "cancel",
    sideEffect: "write-local",
    confirmation: "user-request",
    execute: (intent) => flowCli.cancel(intent.subjectRefs)
  }
];

const resolution = resolveIntentBinding(intent, hostBindings);
// resolution.bound === true  -> { product, command, sideEffect, confirmation, execute }
// resolution.bound === false -> { reason: "missing-authority" | "no-matching-binding" | "ambiguous-binding" | "invalid-consent-metadata" }
```

`sideEffect` and `confirmation` reuse the exact vocabulary `ProductCapabilityDescriptor` commands already declare (`ProductCommandSideEffect`, `ProductCommandConfirmation` — see [Product Capability Descriptor Protocol](product-capability-descriptor.md#descriptor-fields)), so a host publishing both a CLI descriptor and a UI binding for the same command states its policy once. `intentBindingFromCommand(descriptor, command, execute)` derives a `HostIntentBinding` directly from a validated descriptor's command declaration, so the CLI router path (`@kontourai/cli`, [Kontour CLI Router](kontour-cli-router.md)) and a UI binding for the same authority can share one declared policy instead of drifting.

`resolveIntentBinding` fails closed on every case that is not one exact, unique match:

| `bound` | Meaning |
| --- | --- |
| `true` | Exactly one host binding declared this intent's `(product, command)`, and its `sideEffect`/`confirmation` are valid values. The result carries that binding's metadata and its `execute` reference — the identical function the host supplied, never a wrapper or a rebuilt copy. |
| `false`, `reason: "missing-authority"` | The intent carries no `authority.product`/`authority.command` (or either is empty). There is nothing to resolve against. |
| `false`, `reason: "no-matching-binding"` | No host binding declares this exact `(product, command)` pair. This is the common case for most intents most hosts emit — e.g. any host that has not opted into a given write authority. |
| `false`, `reason: "ambiguous-binding"` | More than one host binding declares the same `(product, command)` pair. Resolving to either one would be an unaudited pick between two conflicting policies, so neither wins. |
| `false`, `reason: "invalid-consent-metadata"` | The one matching binding's `sideEffect` or `confirmation` value is not a recognized member of the shared vocabulary. Malformed consent metadata cannot resolve bound. |

## 3. Consent boundary — a bound, side-effecting intent still needs its confirmation gate satisfied

Binding answers "is a product-owned executor available for this authority"; consent answers "may this particular invocation actually run." The two stay separate because a host can declare a binding once (at startup) while consent is a per-invocation, often user-facing, decision.

A bound intent's `confirmation` field is the authoritative statement of what the binding requires, carried unchanged from `ProductCommandConfirmation`:

- `"never"` — no additional confirmation gate. Typically paired with `sideEffect: "none"` or a read-only intent (e.g. `BoardView`'s own `board.select-card`, which is `readOnly: true` and never a write in the first place).
- `"user-request"` — the action may run only in direct response to an explicit end-user request (a click plus, where the action is destructive or hard to reverse, a confirmation step the host UI owns).
- `"operator-request"` — the action requires an operator-level confirmation above a normal end-user click; the host UI decides what that means locally (a distinct role, a typed confirmation, a second approval step).

Resolution never invokes `execute` itself and never decides consent — it only tells the caller which confirmation tier applies. `@kontourai/console-ui` ships one small consumption helper, `bindIntentHandler(hostBindings, options)` (`lib/src/intent.ts`), that turns a host's bindings directly into an `onIntent` callback and enforces the policy structurally, not just by convention:

- an intent with `confirmation: "never"` executes immediately once bound;
- an intent with `confirmation: "user-request"` or `"operator-request"` executes **only** if the host supplied a `confirm(intent, resolution) => boolean | Promise<boolean>` gate and that gate resolved `true`;
- if no `confirm` gate is wired at all, such an intent **never self-executes** — `bindIntentHandler` calls an optional `onConsentRequired` observer instead of assuming consent, so a host with no confirmation UI yet gets a safe no-op instead of a silent bypass;
- an intent whose authority nobody bound calls an optional `onUnbound` observer and never executes, matching the component boundary above.

This means the never-authority invariant is enforced by construction at every layer that can reach `execute`: `resolveIntentBinding` never returns an `execute` for an authority the host did not declare, and `bindIntentHandler` never calls the `execute` it did return unless the resolved confirmation tier's gate actually passed. A host is still responsible for its own confirmation UI (a dialog, an inline second click, an operator-approval flow) — this spec defines the gate's contract, not its presentation.

## Local-only; hosted act is out of scope

This spec, `resolveIntentBinding`, and `bindIntentHandler` describe an in-process binding a single host process holds — a `HostIntentBinding[]` array constructed and consumed in the same runtime, with no network transport, remote authorization service, or cross-tenant identity model. ADR 0003 §6 states the invariant this spec extends: Console is never the authority for a gate, claim, evidence, or coordination decision, and every capability degrades to fully-functional-local. Hosted, multi-tenant execution authority (who, across tenants, may bind or invoke which authority) is explicitly deferred — see ADR 0003 and the epic's Decision 9 (`kontourai/station#580`, work-plane-composition).

## Non-goals

This spec and its reference implementation do not provide:

- a standalone action runner or click-to-act surface with no host product (console#232/C5 — trailing work that consumes this contract, not part of it)
- execution transport, retries, queueing, or audit logging for an invoked `execute` (host- and product-owned)
- a confirmation UI (dialogs, approval flows) — `bindIntentHandler`'s `confirm`/`onConsentRequired` are extension points, not a rendered component
- discovery of which authorities exist (that remains the [Product Capability Descriptor Protocol](product-capability-descriptor.md)'s job; this spec only binds an already-known authority to a host-local executor)
- hosted or multi-tenant act-plane authorization (ADR 0003; explicitly deferred)
- any change to `ConsoleAction`/`ConsoleIntent`'s own "transparency, not consent" contract — this spec is the layer above it, not a redefinition

## Reference implementation

- `@kontourai/console-core`: `resolveIntentBinding`, `HostIntentBinding`, `IntentBindingResolution`, `intentBindingFromCommand`, `BindableIntent` (`console-core/src/intent-binding.ts`; tests in `console-core/test/intent-binding.test.ts`, including the never-authority invariant as an explicit test).
- `@kontourai/console-ui`: `bindIntentHandler`, `BindIntentHandlerOptions` (`console-ui/lib/src/intent.ts`; tests in `console-ui/test/intent.test.ts`), consumable as the `onIntent` a host passes to `BoardView` or any future console-ui component without changing that component's own inert-when-unbound rendering contract.
