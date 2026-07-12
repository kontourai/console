---
title: Kontour CLI Router
description: Offline suite navigation that delegates commands to product-owned executables without merging product authority.
---

# Kontour CLI Router

`@kontourai/cli` provides the suite-level `kontour` command. It owns navigation, descriptor discovery, diagnostics, and safe subprocess delegation. It does not implement product commands, import product kernels, download products, or acquire authority to mutate product state.

## Install and invoke

Node.js 22 or newer is required. Install the router explicitly:

```sh
npm install --global @kontourai/cli
kontour products
kontour capabilities
kontour doctor
kontour console serve
```

For a one-off invocation, pin the router version and opt into each product package explicitly:

```sh
npx --yes \
  --package @kontourai/cli@<exact-version> \
  --package @kontourai/console@<exact-version> \
  kontour console serve
```

`npx` package flags are installation consent. The router itself never invokes npm, searches a registry, downloads a missing package, or silently changes a version. For reproducible and offline work, preinstall exact package versions, retain the npm cache or a lockfile-backed installation, and pass product roots explicitly. A missing local product produces a stable diagnostic rather than a network fallback.

## Explicit product roots

Product roots use an explicit, repeatable mapping:

```sh
kontour --product-root=flow=/absolute/path/to/flow-package \
        --product-root=flow-agents=/absolute/path/to/flow-agents-package \
        --product-root=console=/absolute/path/to/console-package \
        products
```

Each key selects one exact catalog product/package and each value supplies its local package root. The router reads only those caller-supplied roots and its packaged compatibility catalog. It does not scan `$PATH`, global npm directories, parent workspaces, home directories, or the network. Product-shipped, validated descriptors take precedence over compatibility entries.

## Namespace and ownership

The suite namespace is deliberately declarative:

| Suite command | Owner and direct bin |
| --- | --- |
| `kontour flow ...` | Flow; direct `flow ...` remains supported. |
| `kontour flow kit validate/install/inspect ...` | Flow kit lifecycle; direct `flow kit ...` remains supported. |
| `kontour flow agents ...` | Flow Agents; direct `flow-agents ...` remains supported. |
| `kontour flow agents kit install/activate/status ...` | Flow Agents kit distribution and activation; Flow does not absorb this lifecycle. |
| `kontour console ...` | Console; `console-inspect` and Console's product bins remain supported. |

Longest-prefix matching gives `flow agents` to Flow Agents before general Flow routing. The router removes only the suite-owned prefix, then passes the descriptor-owned argv and remaining user argv as literal subprocess arguments with the caller's cwd and stdio. Station is intentionally excluded: it is an application and operating environment, not a nested router product.

## Transparency, confirmation, and authority

`products`, `capabilities`, and `doctor` are read-only router commands. They expose descriptor identity, package/version, provenance, protocol compatibility, command side effects, prerequisites, and required confirmation. This is transparency metadata, not consent.

`kontour init` adds an explicit suite onboarding transaction above the router. Inspect and plan are read-only, and plan emits its deterministic artifact and SHA-256 plan id on stdout. Apply recomputes that plan from the same requested state plus live repository and package authority, requires the exact `--plan-id` with explicit `--yes` consent, and then delegates every action to Flow Agents. Saved plan files and output paths are unsupported; `--plan-file` and `--output` are rejected. See [Kontour Init](kontour-init.md). It does not broaden normal router discovery or grant the router product authority.

Every delegated command remains under the named product's authority. The product owns its artifacts, gates, lifecycle, confirmation, exit status, and signal behavior. The router cannot skip a Flow step, synthesize a cancellation, grant an exception, weaken a confirmation rule, or reinterpret a product failure. Cancellation remains a user-requested product operation where the product descriptor says so.

## Compatibility catalog

The packaged compatibility catalog is a temporary, source-attributed bridge for products that do not yet ship a validated descriptor. Every entry records the owning product/package, source version, catalog version, and provenance. Catalog data is inert and passes the same descriptor validation and protocol negotiation as product-owned data; it never supplies executable code or installation instructions.

An entry is removed only after the owning product publishes a validated descriptor covering the supported commands, its release is available through the documented product root, and conformance tests prove equivalent routing and metadata. Removal is per product, not an all-or-nothing catalog retirement. A product-owned descriptor always wins when both sources are present.

## Legacy Console migration

`@kontourai/console` continues to ship its legacy `kontour serve` bin with unchanged server parsing and behavior during the compatibility window. New suite usage should install `@kontourai/cli` and invoke:

```sh
kontour console serve
```

The legacy alias is deprecated but will not be removed before Console 3.0. Removal additionally requires a released router migration path, published documentation, and compatibility evidence for the delegated Console command. The legacy bin does not proxy through the router.

## Safety and non-goals

Delegation uses a validated descriptor, an explicitly resolved contained package bin, an argv array, and no shell. Discovery and diagnostic commands are offline. The router does not merge packages, host Station, implement server behavior, authorize side effects, manage product upgrades, or replace the independently usable Flow, Flow Agents, and Console CLIs.
