import assert from "node:assert/strict";
import test from "node:test";
import type { ConsoleInquiry, OperatingState } from "../src/index";

test("ConsoleInquiry type carries outcome, claimRefs, ruleRefs, and asker", () => {
  const matched: ConsoleInquiry = {
    id: "inquiry-provider-npi-active-123",
    label: "Is provider 123 NPI active?",
    outcome: "matched",
    asker: "agent-session-42",
    claimRefs: [{ product: "surface", kind: "claim", id: "claim-provider-123-npi-active" }],
    statusFunctionVersion: "v1",
    resolvedAt: "2026-06-10T09:00:00Z"
  };

  assert.equal(matched.outcome, "matched");
  assert.equal(matched.claimRefs?.length, 1);
  assert.equal(matched.ruleRefs, undefined);
  assert.equal(matched.asker, "agent-session-42");
});

test("ConsoleInquiry outcome can be unsupported with no claimRefs", () => {
  const unsupported: ConsoleInquiry = {
    id: "inquiry-unmapped-question-001",
    outcome: "unsupported",
    asker: "agent-session-42",
    statusFunctionVersion: "v1",
    resolvedAt: "2026-06-10T09:01:00Z"
  };

  assert.equal(unsupported.outcome, "unsupported");
  assert.equal(unsupported.claimRefs, undefined);
  assert.equal(unsupported.ruleRefs, undefined);
});

test("ConsoleInquiry outcome can be derived with ruleRefs", () => {
  const derived: ConsoleInquiry = {
    id: "inquiry-release-ready-001",
    outcome: "derived",
    asker: "agent-session-42",
    ruleRefs: [{ product: "surface", kind: "derivation_rule", id: "rule-release-ready" }],
    claimRefs: [
      { product: "surface", kind: "claim", id: "claim-tests-pass" },
      { product: "surface", kind: "claim", id: "claim-coverage-above-90" }
    ],
    statusFunctionVersion: "v1",
    resolvedAt: "2026-06-10T09:02:00Z"
  };

  assert.equal(derived.outcome, "derived");
  assert.equal(derived.ruleRefs?.length, 1);
  assert.equal(derived.claimRefs?.length, 2);
});

test("OperatingState can carry inquiries alongside claims and learnings", () => {
  const state: OperatingState = {
    claims: [{ id: "claim-1", status: "verified" }],
    inquiries: [
      {
        id: "inquiry-1",
        outcome: "matched",
        claimRefs: [{ product: "surface", kind: "claim", id: "claim-1" }]
      },
      {
        id: "inquiry-2",
        outcome: "unsupported"
      }
    ],
    learnings: []
  };

  assert.equal(state.inquiries?.length, 2);
  assert.equal(state.inquiries?.[0].outcome, "matched");
  assert.equal(state.inquiries?.[1].outcome, "unsupported");
  assert.equal(state.claims?.length, 1);
});
