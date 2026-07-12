---
title: Product Capability Descriptor Protocol
description: Versioned, inert declarations for discovering product-owned Kontour CLI capabilities safely and offline.
---

# Product Capability Descriptor Protocol

The product capability descriptor is the shared discovery contract for Kontour command-line products. It lets a suite-level router learn which local commands a product exposes without importing that product's kernel, interpreting its semantics, or acquiring its authority.

The v1 JSON Schema is published by `@kontourai/console-core` at `schemas/product-capability-descriptor.schema.json`. The browser-safe TypeScript contract, validator, and negotiator are exported from `@kontourai/console-core/product-capability-descriptor`. The filesystem resolver is intentionally isolated at the Node-only `@kontourai/console-core/product-capability-descriptor/node` subpath.

Descriptors are inert data. A descriptor never contains executable code, shell source, callbacks, URLs, installation instructions, or permission grants. The named product remains the owner of command behavior, artifacts, projections, confirmation requirements, and all resulting side effects.

## Ownership and lifecycle

Each product authors and versions its own descriptor alongside its package and CLI. The descriptor's `product.id`, package name, bin declarations, command paths, and authority metadata must describe that product's current public contract. Console owns the shared descriptor protocol and validation behavior, but it does not own the meaning or implementation of product commands.

A product release should validate its descriptor against both the checked-in schema and the runtime validator. A changed descriptor is reviewed like any other public API change. Consumers must reject unknown schema versions rather than guessing or falling back to legacy behavior.

Console issue [#145](https://github.com/kontourai/console/issues/145) is the first planned router consumer. That router may discover, validate, negotiate, display, and delegate declared commands. It must still invoke the product-owned executable with an argv vector and must not recreate product semantics inside Console.

## Descriptor fields

Every object is closed: unknown fields fail validation with `DESCRIPTOR_UNKNOWN_FIELD`.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Exact shape version. v1 accepts only `1.0.0`. A different value requires regeneration or a consumer upgrade. |
| `protocolVersion` | Semantic compatibility version. Consumers negotiate its major version independently of package versions. |
| `product` | Stable kebab-case `id`, human `displayName`, and npm `packageName`. |
| `executables` | Descriptor-local executable IDs mapped to exact keys in the installed package's `bin` map. Optional `argvPrefix` entries are literal argv tokens. |
| `commands` | Product-relative command paths, summaries, executable references, literal argv, side-effect classification, and authority requirements. |
| `artifacts` | Declarative input/output relationships, media types, and descriptions. They do not grant file access. |
| `projections` | Read-only projection identities and schema references. They do not transfer semantic ownership to Console. |

Command `sideEffect` is one of `none`, `read-local`, `write-local`, or `write-external`. Command authority always has `kind: "product"`, must name the same `productId` as the descriptor, and declares a minimum `confirmation` of `never`, `user-request`, or `operator-request`. This metadata lets a router present and enforce a conservative delegation boundary; it is not itself authorization.

Identifiers, collection sizes, text, paths, and argv tokens are bounded by the schema. Authors should validate with the packaged schema rather than duplicating those limits in downstream tooling.

## Discovery and precedence

Discovery is local and caller-directed. A consumer supplies an ordered list of descriptor candidates and an ordered list of package roots with the exact package name and bin map parsed from each `package.json`. The resolver considers a root only when that immutable caller-supplied package name exactly matches `descriptor.product.packageName`. The protocol performs no ambient discovery.

Candidate order is precedence order:

1. Validate candidates in the order supplied by the caller.
2. Retain the first valid descriptor for each `product.id`.
3. Diagnose later occurrences as `DESCRIPTOR_DUPLICATE_IDENTITY`; they never replace the first descriptor.
4. When resolving an executable, inspect only supplied roots whose parsed package name exactly matches the descriptor, in order, and return the first contained regular file matching the declared package bin.

The caller is responsible for defining where its explicit candidate list comes from. There is no implicit global npm scan, `$PATH` search, home-directory crawl, workspace crawl, package-manager invocation, registry request, download, or remote fallback. A future consumer may define documented sources, but it must convert them into an explicit ordered candidate list before calling this protocol.

## Version negotiation

Schema and protocol versions serve different purposes:

- `schemaVersion` selects the exact descriptor shape. v1 accepts only `1.0.0`; unsupported or superseded shapes fail loudly with `DESCRIPTOR_SCHEMA_UNSUPPORTED`.
- `protocolVersion` expresses consumer compatibility. v1 accepts semantic versions with major `1`, including later minor and patch versions. A malformed semantic version produces `DESCRIPTOR_MALFORMED`; another major produces `DESCRIPTOR_PROTOCOL_UNSUPPORTED`.

Package versions do not participate in protocol negotiation. A product may publish multiple package releases that use the same descriptor protocol major.

Negotiation validates every candidate, returns valid first-wins descriptors in caller order, and returns diagnostics in deterministic code/product/message order. `ok` is false when any diagnostic is present; callers must not silently discard errors and present a partial set as fully negotiated.

## Diagnostics

Diagnostics contain a stable `code`, `severity: "error"`, a safe message, and optional `productId` and `commandPath`. Messages avoid host-specific absolute paths and secrets. Automations should branch on codes, not prose.

| Code | Meaning |
| --- | --- |
| `DESCRIPTOR_MALFORMED` | A required field, value, bound, or structural rule is invalid. |
| `DESCRIPTOR_UNKNOWN_FIELD` | A closed object contains an undeclared field. |
| `DESCRIPTOR_SCHEMA_UNSUPPORTED` | The exact schema version is not supported. |
| `DESCRIPTOR_PROTOCOL_UNSUPPORTED` | The protocol semantic-version major is unsupported. |
| `DESCRIPTOR_DUPLICATE_IDENTITY` | A later candidate repeats a product identity. |
| `DESCRIPTOR_DUPLICATE_EXECUTABLE` | An executable ID is repeated within one descriptor. |
| `DESCRIPTOR_DUPLICATE_COMMAND` | A command path is repeated within one descriptor. |
| `DESCRIPTOR_UNKNOWN_EXECUTABLE` | A command or resolver request references an undeclared executable. |
| `DESCRIPTOR_AUTHORITY_MISMATCH` | Command authority names a different product. |
| `DESCRIPTOR_UNSAFE_ARGV` | An argv token attempts shell evaluation or executable selection. |
| `DESCRIPTOR_EXECUTABLE_MISSING` | No safe matching executable exists in the supplied roots. |
| `DESCRIPTOR_EXECUTABLE_UNSAFE` | Reserved for an executable that is present but cannot be accepted safely. |

Validation and negotiation diagnostics are sorted deterministically. Resolution intentionally reports a generic missing result for absent, unreadable, traversing, escaping, or non-file candidates so it does not expose local filesystem structure.

## Offline and execution security

Validation and negotiation are pure data operations. Resolution uses local filesystem metadata only. The protocol never opens a network connection, queries DNS, invokes a package manager, starts a subprocess, imports a product kernel, or executes a discovered file.

Executable resolution applies all of these rules:

- Roots and parsed bin maps must be supplied explicitly by the caller.
- A bin target must be relative, printable, non-empty, and contain no `..` path segment.
- Lexical containment is checked before filesystem resolution.
- The root and target are canonicalized with `realpath`; the canonical target must remain beneath the canonical root.
- The final target must be a regular file. Directories, devices, missing files, unreadable entries, and escaping symlinks are rejected.
- A symlink is accepted only when its resolved regular-file target remains inside the supplied package root.
- Candidate failures do not leak absolute root or target paths through diagnostics.

`argvPrefix` and command `argv` are arrays of bounded literal tokens, never shell strings. Control characters, NUL, `-c`, `--shell`, and executable-selection options are rejected. Harmless punctuation remains literal because the future router must pass the final argv vector directly to a product executable with no shell interpolation. Descriptor data must never be concatenated into a command string or evaluated as code.

The packaged JSON Schema and runtime validator enforce the same per-field structural argv policy. Runtime-only relational checks—duplicate product/executable/command identities, executable references, authority/product equality, and supported protocol-major negotiation—operate across fields or candidate sets and are therefore intentionally additional to JSON Schema validation.

Authority and confirmation must be checked again at delegation time. Discovery is not consent, and a descriptor cannot turn a write or lifecycle operation into an authorized action.

## Authoring examples

This Flow excerpt declares a read-only status command and a user-requested lifecycle command:

```json
{
  "schemaVersion": "1.0.0",
  "protocolVersion": "1.0.0",
  "product": {
    "id": "flow",
    "displayName": "Flow",
    "packageName": "@kontourai/flow"
  },
  "executables": [
    { "id": "flow-cli", "packageBin": "flow" }
  ],
  "commands": [
    {
      "path": ["status"],
      "summary": "Read a product-owned Flow run.",
      "executableId": "flow-cli",
      "argv": ["status"],
      "sideEffect": "read-local",
      "authority": { "kind": "product", "productId": "flow", "confirmation": "never" }
    },
    {
      "path": ["cancel"],
      "summary": "Request cancellation of a product-owned Flow run.",
      "executableId": "flow-cli",
      "argv": ["cancel"],
      "sideEffect": "write-local",
      "authority": { "kind": "product", "productId": "flow", "confirmation": "user-request" }
    }
  ],
  "artifacts": [],
  "projections": []
}
```

The conformance fixtures also model:

- Flow Agents commands beneath paths such as `workflow status`, `workflow start`, and `workflow cancel`, delegated to the `flow-agents` package bin.
- Console's `inspect` and `serve` capabilities, delegated to its `console-inspect` and `kontour` package bins.

These fixtures demonstrate the protocol; they are not substitutes for descriptors shipped and maintained by their product packages. Run the focused contract and boundary checks with:

```sh
npm --workspace @kontourai/console-core test -- --test-name-pattern='descriptor schema|descriptor fixtures|descriptor negotiation|descriptor diagnostics|descriptor offline|descriptor hostile'
npm run check:descriptor-boundary
```

## Non-goals

The v1 descriptor protocol does not provide:

- the `kontour` router UX or command execution (Console #145)
- product installation, updates, downloads, or remote catalogs
- ambient package or executable discovery
- executable plugins, dynamic imports, callbacks, or script evaluation
- product authentication, authorization, or user consent
- a replacement for Flow, Flow Agents, Console, or other product semantics
- mutation of product artifacts or projections
- dashboard, onboarding, status aggregation, or hosted-service behavior
- telemetry descriptor semantics or MCP capability negotiation

Those concerns may consume the descriptor contract, but they must preserve the product authority and offline safety boundaries defined here.
