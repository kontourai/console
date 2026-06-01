## Security Review

Files analyzed: 5
Findings: 2 total - 0 critical, 0 high, 2 medium, 0 low

Verdict: FAIL

### Scope

- `docs/specs/projection-schema.md`
- `docs/examples/event-streams/flow-gate-route-back.jsonl`
- `docs/examples/event-streams/surface-claim-freshness.jsonl`
- `docs/examples/event-streams/campfit-field-review.jsonl`
- `README.md`
- `docs/product-boundaries.md`

### Findings

#### [MEDIUM] A03 - docs/specs/projection-schema.md:44 - Local stream path convention lacks traversal/symlink constraints

The local stream convention recommends producer- and scope-derived paths:

```text
.kontour/events/<producer-id>/<scope-kind>-<scope-id>.jsonl
```

The surrounding rules define UTF-8 JSONL, append-only writes, IDs, ordering, replay, and stream identity, but do not state that `producer-id`, `scope-kind`, or `scope-id` must be treated as identifiers rather than raw path fragments. The rebuild section also says a stream id may be "the stable file path" and local replay reads one or more JSONL streams for the projection scope.

If an implementation later interpolates producer/scope values into filesystem paths without normalization and containment checks, malicious or malformed event metadata could encourage path traversal, absolute-path reads, symlink escapes, or accidental ingestion of non-stream files.

**Remediation:** Add a normative rule that path components are sanitized identifiers, not trusted path input. Require rejecting absolute paths, `..`, path separators, control characters, and symlink escapes, and require consumers to resolve candidate files under an allowed stream root such as `.kontour/events`. Clarify that `streamIds` are provenance labels and must not be blindly reopened as filesystem paths unless separately validated.

#### [MEDIUM] A03 - docs/specs/projection-schema.md:471 - Action authority allows executable payload fields without warning against blind execution

The action projection supports product-provided executable/routable fields:

```ts
authority: {
  product: string;
  endpoint?: string;
  command?: string;
  externalUrl?: string;
};
```

The spec correctly says actions route through the owning product and the console should not bypass product-owned APIs, CLIs, or control semantics. However, because event streams and projections are local files and may include product-provided data, `endpoint`, `command`, and `externalUrl` are security-sensitive fields. The current text does not explicitly state that consumers must not execute commands, call endpoints, or open URLs directly from event/projection data without allowlisting and user/product authority checks.

This is especially important because the open questions ask whether action authority should start as CLI commands, local HTTP endpoints, or both.

**Remediation:** Add a warning and validation rule that these fields are descriptors only. Consumers should resolve actions through a trusted product adapter/registry, allowlist known commands/endpoints, avoid shell interpretation, require confirmation for sensitive actions, and treat URLs as untrusted until scheme/host are validated.

### Additional Checks

- Secret-pattern scan over `docs` and `README.md` found no AWS keys, private keys, obvious token/password assignments, or long base64-like assigned secrets.
- Example streams contain synthetic IDs and `example.test` URLs. No private keys, tokens, passwords, or private personal data were found.
- No dependency audit was run because this scoped implementation is documentation/examples only and no package manifest was present in `kontour-console`.

### Summary

The implementation is documentation-only and preserves the major product authority boundary: Surface remains authoritative for trust, Flow remains authoritative for gates/run control, and Kontour Console projections are read models. The examples are synthetic and do not contain secrets.

The review fails pending clarification of two security-sensitive contract ambiguities before runtime consumers are built: local path containment for event streams, and explicit prohibition on blind execution/use of product-provided action authority fields.
