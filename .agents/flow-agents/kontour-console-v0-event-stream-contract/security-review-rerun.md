## Security Review

Files analyzed: 2
Findings: 0 total - 0 critical, 0 high, 0 medium, 0 low

Verdict: PASS

### Scope

- `docs/specs/projection-schema.md`
- `.agents/flow-agents/kontour-console-v0-event-stream-contract/security-review.md`

### Remediation Check

#### Original finding 1: Local stream path convention lacked path sanitization/containment/symlink constraints

Status: Remediated

Evidence:

- `docs/specs/projection-schema.md:53` now states that local path tokens are sanitized identifiers, not raw path fragments.
- `docs/specs/projection-schema.md:53` requires rejecting absolute paths, `..`, path separators, control characters, and values that escape identifier syntax.
- `docs/specs/projection-schema.md:53` requires resolving candidate stream files under an allowed stream root, verifying containment, and rejecting symlink escapes before opening.
- `docs/specs/projection-schema.md:273` clarifies that `streamIds` are provenance labels and must not be blindly reopened as filesystem paths unless separately validated against stream-root, identifier, and symlink-containment checks.

Assessment: The prior traversal/symlink ambiguity is addressed at both the local path convention and projection provenance layers.

#### Original finding 2: `ConsoleActionProjection.authority` lacked warning against blind execution/calls/opens

Status: Remediated

Evidence:

- `docs/specs/projection-schema.md:473` through `docs/specs/projection-schema.md:478` retain the security-sensitive `authority.endpoint`, `authority.command`, and `authority.externalUrl` fields.
- `docs/specs/projection-schema.md:485` states that actions must route through the product that owns authority and must not bypass product-owned APIs, CLIs, or control semantics.
- `docs/specs/projection-schema.md:487` states that the authority fields are descriptors only and consumers must not blindly call endpoints, execute commands, or open URLs from event/projection data.
- `docs/specs/projection-schema.md:487` requires trusted adapter/registry resolution, allowlisting known commands and endpoints, avoiding shell interpretation, confirmation for sensitive actions, and URL scheme/host validation.

Assessment: The prior blind-execution/blind-open ambiguity is addressed with explicit consumer constraints and authority-boundary language.

### Additional Checks

- Secret-pattern scan across `docs`, `README.md`, and the prior security review found no AWS keys, private keys, obvious token/password assignments, or long base64-like assigned secrets.
- Security-sensitive doc scan found no `innerHTML`, `dangerouslySetInnerHTML`, `eval`, child process API examples, SQL construction examples, CSRF-relevant endpoint definitions, or unsafe fetch examples in the scoped docs.
- The only URL found in example streams is a synthetic `https://example.test/providers/118` source fixture.
- No dependency audit was run because this rerun is scoped to documentation and no `package.json`, `pyproject.toml`, `Cargo.toml`, or `requirements.txt` was found in `kontour-console`.

### New Security-Sensitive Docs Issues

No new security-sensitive documentation issues were found in the reviewed scope.

### Summary

Both original medium findings are remediated in `docs/specs/projection-schema.md`. The current schema now documents local stream path sanitization, root containment, symlink escape rejection, provenance-label handling for `streamIds`, and safe handling requirements for action authority descriptors.
