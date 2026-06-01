# Kontour Console

Kontour Console is the suite-level management and visibility product for Kontour.

The primitives remain portable:

- Surface owns claim trust state.
- Flow owns process transparency and gate control.
- Survey owns fact-review records.
- Veritas owns repo/change governance.
- Flow Agents owns agent-facing runtime distribution.

Kontour Console brings those products together into one operating plane for claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions.

This repo ships a small local read-only fixture inspector package alongside the product context and architecture decisions; it is not an app or hosted service.

## Local Fixture Inspection

Run the read-only fixture inspector from the repo root:

```sh
npm run inspect:fixtures
```

The command reads checked-in files under `docs/examples/event-streams/` and `docs/examples/projections/`, validates the local v0 envelopes, and prints event counts plus current claim, process, gate, review, action, and link summaries. Actions are shown as inert descriptors only; the inspector does not execute product commands, follow URLs, or mutate product-owned state.

## Docs

- [Product Boundaries](docs/product-boundaries.md)
- [Event And Projection Schema](docs/specs/projection-schema.md)
- [Example event streams](docs/examples/event-streams/)
- [ADR 0001: Kontour Console As Suite Management Plane](docs/adr/0001-kontour-console-as-suite-management-plane.md)
