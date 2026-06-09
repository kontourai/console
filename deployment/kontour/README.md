# Kontour Hosted Console Overlay

Status: deployment example, non-secret

This directory is the Kontour-owned overlay for hosting the generic Console at
`console.kontourai.io`. It documents composition and operational order only; the
base Console packages remain generic and must not import from this directory.

## Composition

The hosted deployment should provide:

- an approved base Console artifact
- platform routing for `https://console.kontourai.io`
- TLS and network policy outside the Node process
- Postgres connection details from the secret manager
- non-secret runtime defaults from `config/kontour/hosted-console.env.example`
- trusted producer tokens from the secret manager
- tenant allowlist and bootstrap tenant config
- migration execution before production traffic
- platform health checks for `/healthz` and `/readyz`

## Deployment Order

1. Resolve the base Console artifact pin.
2. Materialize non-secret config from `config/kontour/`.
3. Inject secrets from the deployment secret manager.
4. Run Console database migrations:
   `npm --workspace @kontour/console-server run db:migrate`.
5. Start the Console server in hosted mode.
6. Check `/healthz`.
7. Check `/readyz`.
8. Enable route traffic for `console.kontourai.io`.

## SQL Client Responsibility

The deployment is responsible for installing and wiring any SQL client required
by the selected hosted telemetry adapter. Do not assume npm `pg` is installed
unless it is declared in the package manifest used by the deployed artifact.

## Secrets

Keep secrets out of this repository. Use secret-manager references or deployment
platform bindings for:

- `CONSOLE_DATABASE_URL`
- producer bearer tokens
- future OIDC/JWT verifier secrets
- TLS private keys, when not fully platform-managed

## Rollback

Roll back the application artifact or route target first. Database rollback
requires an explicit migration plan. Hosted telemetry records should be retained
and deduped by semantic record identity.
