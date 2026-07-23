import assert from "node:assert/strict";
import test from "node:test";
import { deriveSourceRefs } from "../src/utils/sourceRefs";
import { isSafeExternalUrl } from "../src/utils/safeUrl";

// console#256: the single shared derivation every link-out surface (fleet
// cards, run detail) reuses for `state.processes[i].sourceOfTruthRefs`
// (console#254). Kept product-agnostic — no per-kind special-casing beyond
// the deterministic sort order this task asks for.

// ── missing / malformed / empty ─────────────────────────────────────────────

test("deriveSourceRefs: a record with no sourceOfTruthRefs field is an empty array, never fabricated", () => {
  assert.deepEqual(deriveSourceRefs({}), []);
  assert.deepEqual(deriveSourceRefs(undefined), []);
  assert.deepEqual(deriveSourceRefs(null), []);
});

test("deriveSourceRefs: a non-array sourceOfTruthRefs value is tolerated as empty, never crashes", () => {
  assert.deepEqual(deriveSourceRefs({ sourceOfTruthRefs: "not-an-array" }), []);
  assert.deepEqual(deriveSourceRefs({ sourceOfTruthRefs: { label: "not wrapped in an array" } }), []);
});

test("deriveSourceRefs: an empty sourceOfTruthRefs array stays empty", () => {
  assert.deepEqual(deriveSourceRefs({ sourceOfTruthRefs: [] }), []);
});

test("deriveSourceRefs: non-object entries (string/number/null) in the array are silently skipped", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: ["a string", 42, null, undefined, { label: "Real ref" }],
  });
  assert.deepEqual(refs, [{ kind: "ref", label: "Real ref" }]);
});

test("deriveSourceRefs: an entry with neither a label nor an id is skipped — nothing honest to show", () => {
  const refs = deriveSourceRefs({ sourceOfTruthRefs: [{ kind: "work-item", url: "https://example.test/x" }] });
  assert.deepEqual(refs, []);
});

test("deriveSourceRefs: id is used as a fallback label when label is absent", () => {
  const refs = deriveSourceRefs({ sourceOfTruthRefs: [{ kind: "work-item", id: "github:org/repo#42" }] });
  assert.deepEqual(refs, [{ kind: "work-item", label: "github:org/repo#42" }]);
});

test("deriveSourceRefs: a missing kind falls back to a generic 'ref' kind rather than crashing/guessing a real one", () => {
  const refs = deriveSourceRefs({ sourceOfTruthRefs: [{ label: "Untyped ref" }] });
  assert.deepEqual(refs, [{ kind: "ref", label: "Untyped ref" }]);
});

// ── no-url-no-anchor: refs without a real url are kept, just not linkified ──

test("deriveSourceRefs: an assignment ref with no url is kept (rendered as text elsewhere), not dropped", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [{ kind: "assignment-branch", label: "feature/checkout-banner" }],
  });
  assert.deepEqual(refs, [{ kind: "assignment-branch", label: "feature/checkout-banner" }]);
});

test("deriveSourceRefs: href is tolerated as an alternate url key, matching producer field-name flexibility", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [{ kind: "work-item", label: "Issue", href: "https://example.test/issues/9" }],
  });
  assert.deepEqual(refs, [{ kind: "work-item", label: "Issue", url: "https://example.test/issues/9" }]);
});

// ── unsafe scheme rejection via the shared util ─────────────────────────────

test("deriveSourceRefs: an unsafe javascript: url is stripped, but the ref itself is kept as text (never a fake or dead anchor)", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [{ kind: "work-item", label: "evil", url: "javascript:alert(1)" }],
  });
  assert.deepEqual(refs, [{ kind: "work-item", label: "evil" }]);
});

test("deriveSourceRefs: an unsafe data: url is stripped the same way", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [{ kind: "work-item", label: "evil-data", url: "data:text/html,<script>alert(1)</script>" }],
  });
  assert.deepEqual(refs, [{ kind: "work-item", label: "evil-data" }]);
});

test("deriveSourceRefs: an unparsable url string is stripped honestly, never a broken href", () => {
  const refs = deriveSourceRefs({ sourceOfTruthRefs: [{ kind: "work-item", label: "broken", url: "not a url at all" }] });
  assert.deepEqual(refs, [{ kind: "work-item", label: "broken" }]);
});

test("deriveSourceRefs: both https: and http: urls are accepted", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [
      { kind: "work-item", label: "Secure", url: "https://example.test/x" },
      { kind: "work-item", label: "Local dev", url: "http://intranet.local/y" },
    ],
  });
  assert.deepEqual(refs, [
    { kind: "work-item", label: "Secure", url: "https://example.test/x" },
    { kind: "work-item", label: "Local dev", url: "http://intranet.local/y" },
  ]);
});

// ── deterministic chip ordering ──────────────────────────────────────────────

test("deriveSourceRefs: work-item sorts first, then assignment-branch, assignment-actor, assignment-artifact-dir, regardless of input order", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [
      { kind: "assignment-artifact-dir", label: "artifact-dir" },
      { kind: "assignment-actor", label: "actor" },
      { kind: "assignment-branch", label: "branch" },
      { kind: "work-item", label: "work-item", url: "https://example.test/issues/1" },
    ],
  });
  assert.deepEqual(refs.map((r) => r.kind), ["work-item", "assignment-branch", "assignment-actor", "assignment-artifact-dir"]);
});

test("deriveSourceRefs: unknown/future kinds sort after the known ones, preserving their original relative order (stable)", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [
      { kind: "workflow-owner", label: "owner-first" },
      { kind: "assignment-branch", label: "branch" },
      { kind: "something-else", label: "owner-second" },
      { kind: "work-item", label: "work-item", url: "https://example.test/issues/1" },
    ],
  });
  assert.deepEqual(refs.map((r) => r.label), ["work-item", "branch", "owner-first", "owner-second"]);
});

test("deriveSourceRefs: multiple entries of the SAME kind keep their original relative order among themselves", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [
      { kind: "assignment-actor", label: "actor-b" },
      { kind: "assignment-actor", label: "actor-a" },
    ],
  });
  assert.deepEqual(refs.map((r) => r.label), ["actor-b", "actor-a"]);
});

// ── full producer-shaped fixture (console#254's workflow-trust-bridge.test.ts shape) ─

test("deriveSourceRefs: a full console#254-shaped work-item ref (product/kind/id/label/url/sourcePath) yields exactly the label + url this component needs", () => {
  const refs = deriveSourceRefs({
    sourceOfTruthRefs: [
      {
        product: "github",
        kind: "work-item",
        id: "github:kontourai/flow-agents#254",
        label: "github:kontourai/flow-agents#254",
        url: "https://github.com/kontourai/flow-agents/issues/254",
        sourcePath: "checkout-banner/state.json",
      },
    ],
  });
  assert.deepEqual(refs, [
    { kind: "work-item", label: "github:kontourai/flow-agents#254", url: "https://github.com/kontourai/flow-agents/issues/254" },
  ]);
});

// ── isSafeExternalUrl (safeUrl.ts) — the shared allow-list itself ──────────

test("isSafeExternalUrl: accepts https: and http:", () => {
  assert.equal(isSafeExternalUrl("https://example.test/x"), true);
  assert.equal(isSafeExternalUrl("http://example.test/x"), true);
});

test("isSafeExternalUrl: rejects javascript:, data:, and other unsafe schemes", () => {
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
});

test("isSafeExternalUrl: rejects an unparsable string", () => {
  assert.equal(isSafeExternalUrl("not a url at all"), false);
  assert.equal(isSafeExternalUrl(""), false);
});
