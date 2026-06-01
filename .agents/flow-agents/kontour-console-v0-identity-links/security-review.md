## Security Review

Files analyzed: 1
Findings: 0 critical, 0 high, 0 medium, 0 low
Verdict: PASS

### Scope

- `docs/specs/projection-schema.md`

### Findings

No security findings.

### Evidence

- URL handling for `CrossProductRef.url` is documented as navigation-only and untrusted until validated by a trusted product adapter or URL allowlist: `docs/specs/projection-schema.md:577`.
- Action navigation/execution fields are explicitly descriptor-only, and consumers are warned not to blindly call endpoints, execute commands, or open URLs from event/projection data: `docs/specs/projection-schema.md:487`.
- Product authority boundaries are documented for product-local identity semantics: `docs/specs/projection-schema.md:569`.
- Surface remains the authority for claim trust derivation, rather than Kontour Console deriving trust from links: `docs/specs/projection-schema.md:348`.
- Flow remains the authority for gate, transition, exception, and run-control semantics: `docs/specs/projection-schema.md:372`.
- Required v0 links are framed as console usefulness links without giving the console authority over product semantics: `docs/specs/projection-schema.md:609`.
- The spec states required v0 behavior must not depend on automatically inferring missing links: `docs/specs/projection-schema.md:581`.
- The spec rejects global identity service requirements for v0 identity links: `docs/specs/projection-schema.md:622`.
- Inline examples use synthetic provider/run/claim/review IDs and do not include secrets, tokens, passwords, private keys, email addresses, or private PII: `docs/specs/projection-schema.md:628`.

### Dependency Audit

Not applicable. The reviewed scope is a Markdown specification only, with no runtime code or dependency manifest changes.

### Summary

The issue #3 docs implementation passes security review for the requested focus areas. The spec treats link URLs as untrusted navigation hints, keeps product authority boundaries explicit, avoids implying global identity authority or automatic inference, and uses non-secret synthetic examples.
