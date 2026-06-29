# ADR 0003: Console Multi-Tenant Authentication & MCP Authorization

Date: 2026-06-29

## Status

Proposed

## Context

The console is moving toward being a properly hosted, multi-tenant product. Today
authentication is intentionally minimal:

- **Opaque bearer tokens** (`Authorization: Bearer …`, or `x-console-api-token` /
  `x-console-telemetry-token`) matched against a configured `hostedAuthTokens` list,
  each carrying a `tenantId` (`console-server/src/console-foundation/config.ts`).
- **Signed (HMAC-SHA256) stateless session cookies** —
  `base64url(tenantId).timestampMs.HMAC` (`console-hub-server.ts`).
- A single centralized gate, `authenticateRequest()`, plus per-tenant isolation
  enforced in Postgres (`tenant_id` in the telemetry primary key and on every query).

This is sufficient for trusted first-party ingestion but does **not** support:

1. **Human end-user login** to a console UI (no IdP, no social/SSO login).
2. **Enterprise SSO/SCIM** — customers will eventually require SAML/OIDC SSO and SCIM
   provisioning per organization.
3. **Third-party / MCP clients.** We want the console to expose its telemetry, pricing,
   and cost analytics to Model Context Protocol (MCP) clients (including agents). Per the
   MCP authorization spec (2025-06-18 and later), an MCP server **MUST** act as an
   OAuth 2.1 Resource Server: validate **audience-bound** access tokens (RFC 8707),
   implement RFC 9728 Protected Resource Metadata, return 401 on invalid/expired tokens,
   and never accept or pass through tokens not minted for it (confused-deputy rule). Our
   opaque tokens carry no `aud`/`scope` claims and there is no Authorization Server, so we
   cannot satisfy this today.

The three subject types we must serve — **users**, **machines** (agents/CI posting
telemetry, M2M), and **MCP OAuth clients** — argue for a real OAuth 2.1 model rather than
extending the opaque-token scheme.

### Constraints (stakeholder-confirmed)

- **Free/cheap to start; pay-as-you-grow.** The initial tier must be free or near-free.
  The ideal cost curve incurs enterprise-SSO cost *only when enterprise customers arrive*,
  not as a function of total users.
- **Dev-tool now, enterprise later** — self-serve first, but able to add SSO/SCIM without
  re-platforming.
- **Stack (verified):** Node.js HTTP server + Postgres, deployed via Docker on
  **Render/Fly.io** (not AWS-native). AWS Cognito therefore has no native-integration
  advantage and adds cross-cloud coupling.

### Options evaluated (research, ~June 2026; see Sources)

| Provider | Free tier | Enterprise SSO/SCIM cost model | OAuth 2.1 AS (M2M, scopes, **RFC 8707 aud**, DCR) | MCP-forward | Self-host |
|---|---|---|---|---|---|
| **WorkOS AuthKit** | **Free to 1M MAU** | **Per IdP connection** (~$125/conn SSO + ~$125 SCIM, declining) — scales with # enterprise customers, not MAU | Yes — AS for MCP apps: PKCE, scopes, JWT validation, **RFC 8707 audience binding**, DCR | **Yes — ships MCP auth product** (`workos/authkit-xmcp`, FastMCP integration) | No |
| **ZITADEL** | **$0** (100 DAU, unlimited users/orgs, SSO/SAML/SCIM un-gated), $100/mo Pro (25k DAU) | Included even on free tier (DAU-priced) | Partial — **lacks DCR (RFC 7591) and RFC 8707** resource indicators today (both in-flight) | Partial | **Yes (OSS)** |
| **Ory Hydra (+Kratos)** | OSS free; Ory Network free tier | Self-run | Yes — OpenID-certified OAuth 2.1 AS; demonstrated as MCP AS | Yes (community) | **Yes (OSS)** |
| **Keycloak** | OSS free | Self-run | AS yes, but **no native RFC 8707** (non-standard `aud` via mappers; issue open) | Partial | **Yes (OSS)** |
| Auth0/Okta, Clerk, Stytch, Cognito, Supabase, SuperTokens | (not independently re-verified this pass) | — | Auth0/Stytch also offer turnkey MCP auth per third-party note | varies | varies |

The differentiator for **this** profile is the cost curve **and** MCP-readiness. WorkOS is
the only candidate that is simultaneously (a) free to a very high MAU ceiling, (b) prices
enterprise SSO/SCIM **per connection** (so cost tracks enterprise logos, not user count),
and (c) ships a first-class MCP authorization-server product implementing exactly the spec
requirements above (PKCE, scopes, RFC 8707 audience binding, DCR). ZITADEL is the strongest
free/OSS alternative but currently lacks DCR and RFC 8707 — the two MCP-relevant gaps.

## Decision

Adopt **WorkOS AuthKit** as the console's Authorization Server / IdP, and re-shape the
console itself into an **OAuth 2.1 Resource Server** that validates audience-bound JWTs.

1. **WorkOS is the Authorization Server and user-identity provider.** It issues JWT access
   tokens (with `aud`, `scope`, and an organization/tenant claim), runs the login UI
   (AuthKit) for human users, handles M2M client-credentials for machine subjects, and acts
   as the OAuth 2.1 AS for MCP clients (PKCE, scopes, RFC 8707, DCR, discovery metadata).
2. **The console becomes an OAuth 2.1 Resource Server.** `authenticateRequest()` is
   extended to verify WorkOS JWTs (signature via JWKS, `iss`, `aud`, expiry), derive
   `tenantId` from the organization claim, and enforce `scope`. Existing per-tenant Postgres
   isolation and centralized routing are unchanged.
3. **Console exposes an authenticated MCP server** (telemetry / pricing / cost analytics)
   that publishes **RFC 9728 Protected Resource Metadata** at
   `/.well-known/oauth-protected-resource` pointing at WorkOS, validates the `aud` names the
   console, and rejects non-audience tokens (no passthrough).
4. **Enterprise SSO/SCIM is deferred but unblocked.** When an enterprise customer arrives,
   enable a WorkOS SSO/SCIM connection for that org — incremental per-connection cost, no
   re-platforming.

We explicitly do **not** build our own Authorization Server first (correct per MCP guidance
and our cost constraint), and we do **not** adopt Cognito (non-AWS hosting).

### Migration path (opaque tokens → JWT/OAuth), cutover-safe

1. **Stand up WorkOS** (AS + AuthKit login). Add JWKS-based JWT verification to the console
   alongside the existing opaque-token + cookie checks — **dual acceptance** during cutover.
2. **Machine subjects → client-credentials.** Issue WorkOS M2M clients for agents/CI;
   migrate telemetry posters from static `hostedAuthTokens` to client-credential JWTs
   (audience = console). Keep the opaque token path until all posters are migrated, then
   retire it.
3. **Human sessions.** Move console UI login to AuthKit; the existing signed cookie can
   remain as the browser session wrapper around the WorkOS session initially.
4. **MCP surface.** Add the RFC 9728 metadata endpoint + MCP server behind JWT/audience
   validation. (For the Node stack use `workos/authkit-xmcp`, not the Python FastMCP example.)
5. **Enterprise tier.** Per-org SSO/SCIM connections enabled on demand.

## Consequences

**Positive**
- Free to start (≤1M MAU); enterprise-auth cost arrives with enterprise revenue.
- One model covers users, machines, and MCP clients; console becomes spec-compliant as an
  MCP Resource Server, unlocking "agents can query cost/telemetry over MCP."
- Existing tenant isolation + routing are reused; migration is additive with dual-token
  cutover (no big-bang).

**Negative / risks**
- New vendor dependency (WorkOS) on the auth critical path.
- Node MCP tooling (`authkit-xmcp`) is younger than the Python/FastMCP path — verify its
  DCR + RFC 9728 surface before committing (open question).
- **Time-sensitive facts:** re-verify WorkOS's 1M-MAU free threshold and per-connection
  SSO/SCIM tiers, and ZITADEL's DAU tiers, before signing.
- **MCP spec is fast-moving:** the RFC 8707 resource parameter is currently a MUST but there
  is active debate (MCP issue #1614) about relaxing it to OPTIONAL; authorization is OPTIONAL
  in MCP overall. The spec mandates *audience validation*, not JWT specifically — opaque-token
  introspection also satisfies MCP, so JWT is our choice, not a spec requirement.
- OSS gaps that could shift the calculus toward a cheaper self-host path are in-flight:
  ZITADEL DCR (#9810) + RFC 8707 (oidc #794); Keycloak RFC 8707 (#14355, milestone 26.8.0).
  Re-check release notes before a self-host decision.

**Revisit if** an enterprise deal lands before self-serve traction (re-weight toward
SSO-first economics), if WorkOS pricing changes materially, or if ZITADEL/Keycloak close the
DCR + RFC 8707 gaps (a free OSS path on our existing Render/Fly + Postgres footprint then
becomes viable).

## Sources

- WorkOS pricing — https://workos.com/pricing
- WorkOS MCP (AuthKit as MCP AS) — https://workos.com/mcp · https://github.com/workos/authkit-xmcp · https://gofastmcp.com/integrations/authkit
- MCP authorization spec — https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- ZITADEL pricing — https://zitadel.com/pricing ; gaps — https://github.com/zitadel/zitadel/issues/9810 · https://github.com/zitadel/oidc/issues/794
- Ory Hydra as MCP AS — https://www.ory.com/blog/mcp-server-oauth-with-ory-hydra-authentication-ai-agent-integration-guide
- Keycloak RFC 8707 — https://github.com/keycloak/keycloak/issues/14355
- RFCs: 9728 (Protected Resource Metadata), 8414 (AS Metadata), 8707 (Resource Indicators), 7591 (Dynamic Client Registration)
