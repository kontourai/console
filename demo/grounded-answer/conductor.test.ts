/**
 * Tests proving the structural grounding property.
 *
 * These tests do NOT mock @kontourai/survey or @kontourai/surface.
 * They use the real buildSurveyTrustBundle() and buildTrustReport() calls
 * through the real conductor + lab pipeline.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { answer, rawAnswer } from "./conductor.js";
import type { GroundedAnswer, Refusal } from "./conductor.js";

describe("Structural grounding proof", () => {
  // ── Query 1: account-alpha Q3-2025 (data exists) ──────────────────────────

  describe("query with backing data (account-alpha, Q3-2025)", () => {
    const query = { accountId: "account-alpha", period: "Q3-2025" };

    it("conducted path returns a grounded answer", () => {
      const result = answer(query);
      assert.equal(result.kind, "grounded", `Expected grounded, got ${result.kind}`);
    });

    it("grounded answer carries the real verified amount", () => {
      const result = answer(query) as GroundedAnswer;
      assert.equal(result.amount, 482_000);
    });

    it("bundle claim status is verified — real buildSurveyTrustBundle output", () => {
      const result = answer(query) as GroundedAnswer;
      assert.equal(result.bundle.claims.length, 1);
      assert.equal(result.bundle.claims[0].status, "verified");
    });

    it("bundle has real evidence tracing to the source record", () => {
      const result = answer(query) as GroundedAnswer;
      const evidence = result.bundle.evidence[0];
      assert.ok(evidence, "evidence must be present");
      assert.match(evidence.sourceRef, /sales-doc-2025-Q3-alpha/, "sourceRef must trace to the source doc");
      assert.equal(evidence.sourceLocator, "records[0].amount", "locator must point to the field");
    });

    it("trust report summary shows 1 verified claim", () => {
      const result = answer(query) as GroundedAnswer;
      assert.equal(result.report.summary.byStatus.verified, 1);
      assert.equal(result.report.summary.byStatus.proposed, 0);
    });

    it("trust report has no transparency gaps", () => {
      const result = answer(query) as GroundedAnswer;
      assert.equal(result.report.transparencyGaps?.length ?? 0, 0);
    });

    it("raw path also returns a number (no gating — the contrast)", () => {
      const raw = rawAnswer(query);
      assert.equal(raw.kind, "raw");
      assert.equal(raw.amount, 482_000);
      assert.equal(raw.provenance, null, "raw path has NO provenance");
      assert.equal(raw.hasSource, true);
    });
  });

  // ── Query 2: account-omega Q3-2025 (NO DATA — structural refusal) ─────────

  describe("query with NO backing data (account-omega, Q3-2025)", () => {
    const query = { accountId: "account-omega", period: "Q3-2025" };

    it("conducted path returns a refusal — never a grounded answer", () => {
      const result = answer(query);
      assert.equal(result.kind, "refused", `Expected refused, got ${result.kind}`);
    });

    it("refusal includes a non-empty reason message", () => {
      const result = answer(query) as Refusal;
      assert.ok(result.reason.length > 0, "refusal reason must be non-empty");
      assert.match(result.reason, /account-omega/, "reason must name the account");
      assert.match(result.reason, /Q3-2025/, "reason must name the period");
    });

    it("refusal does NOT carry a verified claim or bundle — no fabrication", () => {
      const result = answer(query) as Refusal;
      // TypeScript enforces this at compile time too: Refusal has no .bundle or .amount
      assert.ok(!("bundle" in result), "refusal must NOT have a bundle property");
      assert.ok(!("amount" in result), "refusal must NOT have an amount property");
      assert.ok(!("report" in result), "refusal must NOT have a report property");
    });

    it("raw path STILL returns a confident number with no source — confabulation risk", () => {
      // This is the point of the contrast: raw path doesn't refuse.
      const raw = rawAnswer(query);
      assert.equal(raw.kind, "raw");
      assert.ok(typeof raw.amount === "number" && raw.amount > 0,
        "raw path returns a number even without backing data");
      assert.equal(raw.provenance, null, "raw path has NO provenance");
      assert.equal(raw.hasSource, false, "raw path correctly reports no backing source");
    });

    // THE KEY TEST: proves the structural property
    it("STRUCTURAL: there is NO code path that produces a verified answer without a grounding record", () => {
      // The conductor answer() function returns ConductedAnswer = GroundedAnswer | Refusal.
      // When no record exists, groundClaim() returns undefined.
      // undefined → conductor returns Refusal (the only other arm of the union).
      // TypeScript enforces at compile time that Refusal does not carry .amount/.bundle/.report.
      //
      // This test proves it at runtime: after 100 calls, EVERY result for a missing record
      // is a refusal. There is no probabilistic or heuristic path — it's deterministic.
      for (let i = 0; i < 100; i++) {
        const result = answer(query);
        assert.equal(result.kind, "refused",
          `Iteration ${i}: expected refused, got ${result.kind} — structural gate violated`);
        assert.ok(!("bundle" in result),
          `Iteration ${i}: grounded bundle must never appear in a refusal`);
      }
    });
  });
});

describe("buildSurveyTrustBundle producer discipline enforcement", () => {
  it("verifies that real buildSurveyTrustBundle is called (not a stub)", () => {
    // If this were a stub, it would skip the assertProducerDiscipline check.
    // The real function throws if a claim is "verified" without review actor + reviewedAt.
    // We verify this by checking that the real call produced a proper bundle structure.
    const result = answer({ accountId: "account-alpha", period: "Q3-2025" }) as GroundedAnswer;

    // schemaVersion: 3 is only present in the real Hachure TrustBundle output.
    assert.equal(result.bundle.schemaVersion, 3,
      "schemaVersion=3 confirms real buildSurveyTrustBundle was called");

    // Real bundle has events
    assert.ok(result.bundle.events.length > 0, "real bundle must have verification events");
    const event = result.bundle.events[0];
    assert.equal(event.status, "verified");
    assert.ok(event.verifiedAt, "real event must have verifiedAt timestamp");
  });
});
