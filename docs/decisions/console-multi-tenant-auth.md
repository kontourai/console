---
status: current
subject: Console multi-tenant authentication and MCP authorization
decided: 2026-06-29
evidence:
  - kind: adr
    ref: docs/adr/0006-console-multitenant-auth.md
  - kind: pr
    ref: https://github.com/kontourai/console/pull/96
  - kind: pr
    ref: https://github.com/kontourai/console/pull/101
  - kind: pr
    ref: https://github.com/kontourai/console/pull/102
  - kind: pr
    ref: https://github.com/kontourai/console/pull/103
  - kind: pr
    ref: https://github.com/kontourai/console/pull/107
---
# Console multi-tenant authentication and MCP authorization

The console is an OAuth 2.1 Resource Server for any OIDC authorization server
chosen by configuration, as [ADR 0006](../adr/0006-console-multitenant-auth.md)
proposed. Its phases 1 to 3 landed on 2026-06-29: JWT verification, per-route
scopes, machine tenant binding, OIDC login, and the authenticated MCP server.
Those pull requests cite the ADR as "ADR 0003", its number before the
2026-07-20 renumbering.

Still open: phase 4 (per-organization enterprise SSO and SCIM), and retiring
the static `hostedAuthTokens`, which the console still accepts alongside JWTs.
