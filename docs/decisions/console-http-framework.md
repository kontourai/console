---
status: needs-decision
subject: Console HTTP framework
decided: 2026-10-14
evidence:
  - kind: adr
    ref: docs/adr/0004-console-http-framework.md
---
# Console HTTP framework

This subject has provenance in frozen ADR history ([0004-console-http-framework.md](../adr/0004-console-http-framework.md)) but no living
decision has been ratified yet under the topic-keyed decision registry
([format](https://github.com/kontourai/corpus/blob/main/docs/decisions.md)).
This stub records that the subject is open and links the frozen ADR(s) as
provenance; it is not a decision.

ADR 0004 proposed adopting Fastify incrementally and was never accepted. The
console HTTP server is still a `node:http` server, and no package depends on
Fastify.

When a living decision is ratified for the console HTTP framework,
update this file's `status` to `current`, add rationale, and keep the
`adr` evidence links as provenance for the history that led here.
