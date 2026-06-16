/**
 * Structural tests for the three-lane gallery.
 *
 * For every scenario these prove the central bet:
 *   (a) the RAG + fact-check lane PASSES the wrong answer (a fair baseline ships it),
 *   (b) the Kontour lane CATCHES it (the structural gate BLOCKs),
 *   (c) no code path lets the Kontour lane emit a verified PASS when the binding /
 *       freshness / locator / join check fails.
 *
 * The Kontour lane uses the REAL buildSurveyTrustBundle() + buildTrustReport()
 * (not stubs). These tests assert on the real bundle (schemaVersion 3, verified
 * events) to prove that.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { runAll, runScenario } from "./harness.js";
import { SCENARIOS, TRAP_SCENARIOS, WIN_SCENARIOS, OKF_WIN, OKF_TRAP } from "./scenarios.js";
import { factCheck, retrieve } from "./rag-baseline.js";
import { loadOkfConcept, countSchemaFields, sha256Of } from "./okf.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const byId = (id: string) => SCENARIOS.find((s) => s.id === id)!;

describe("three-lane gallery — the central bet (TRAP scenarios)", () => {
  for (const scenario of TRAP_SCENARIOS) {
    describe(`${scenario.id} — ${scenario.title}`, () => {
      const result = runScenario(scenario);

      it("(a) RAG + fact-check lane PASSES the wrong answer (fair baseline ships it)", () => {
        assert.equal(
          result.rag.passed,
          true,
          `RAG lane must pass the bad answer for ${scenario.id}; ` +
            `verdict was ${result.rag.factCheck.verdict}. If a fair checker caught it, ` +
            `this scenario does not clear the honesty bar.`
        );
      });

      it("(b) Kontour lane CATCHES the wrong answer (structural gate BLOCKs)", () => {
        assert.equal(
          result.kontour.outcome,
          "block",
          `Kontour gate must block ${scenario.id}, got ${result.kontour.outcome}`
        );
      });

      it("(c) a BLOCKed Kontour outcome carries NO passable value (TS + runtime)", () => {
        if (result.kontour.outcome === "block") {
          // TypeScript: GateBlock has no `value`. Runtime: confirm it is absent.
          assert.ok(!("value" in result.kontour), "block must not carry a value");
          assert.ok(result.kontour.reason.length > 0, "block must name a reason");
        } else {
          assert.fail("expected block");
        }
      });
    });
  }

  it("EVERY trap: RAG passes AND Kontour blocks (the whole trap gallery)", () => {
    for (const r of runAll(TRAP_SCENARIOS)) {
      assert.equal(r.rag.passed, true, `${r.scenario.id}: RAG must pass`);
      assert.equal(r.kontour.outcome, "block", `${r.scenario.id}: Kontour must block`);
    }
  });
});

describe("precision: the WIN (answerable) scenarios — Kontour CONFIDENTLY answers", () => {
  it("there are answerable wins AND traps (Kontour is a discriminator, not a refuse-box)", () => {
    assert.ok(WIN_SCENARIOS.length >= 2, "at least 2 win cases prove it answers when it can");
    assert.ok(TRAP_SCENARIOS.length >= 1, "and traps prove it refuses when it can't");
  });

  for (const scenario of WIN_SCENARIOS) {
    describe(`${scenario.id} — ${scenario.title}`, () => {
      const result = runScenario(scenario);

      it("Kontour gate PASSES with the confident grounded value", () => {
        assert.equal(
          result.kontour.outcome,
          "pass",
          `win ${scenario.id} must PASS, got ${result.kontour.outcome}`
        );
        if (result.kontour.outcome !== "pass") return;
        assert.equal(result.kontour.value, scenario.rawAnswer, "answers the right number");
      });

      it("the PASS carries a REAL schemaVersion-3 bundle with a VERIFIED claim", () => {
        assert.equal(result.kontour.outcome, "pass");
        if (result.kontour.outcome !== "pass") return;
        const g = result.kontour.grounded;
        // schemaVersion 3 only comes from the real buildSurveyTrustBundle output.
        assert.equal(g.bundle.schemaVersion, 3, "must be the real bundle");
        assert.equal(g.bundle.claims[0].status, "verified", "claim is verified");
        assert.ok(g.bundle.events.length > 0, "real bundle has verification events");
        assert.ok(g.bundle.events[0].verifiedAt, "verified event has verifiedAt");
        // The report is the real surface report with one verified claim.
        assert.equal(g.report.summary.byStatus.verified, 1);
        // The grounded qualifier matches what was asked — that is WHY it passes. For the
        // sales scenarios the qualifier is a quarter in the query; the OKF win's qualifier
        // is the OKF `timestamp` (not in the query), asserted in its own dedicated tests.
        const quarter = scenario.query.match(/Q\d-\d{4}/)?.[0];
        if (quarter) assert.equal(g.groundedQualifier, quarter);
      });

      it("the RAG baseline ALSO answers the easy one correctly (both fine on wins)", () => {
        assert.equal(result.rag.passed, true, "RAG correctly supports the right answer");
        assert.equal(result.rag.factCheck.verdict, "supported");
      });
    });
  }

  it("HERO PAIRING: w1 (Alpha Q2) ANSWERS $451k while s1 (Alpha Q3) REFUSES — same $451k", () => {
    const win = runScenario(byId("w1"));
    const trap = runScenario(byId("s1"));
    // The win answers, verified, with the real value.
    assert.equal(win.kontour.outcome, "pass");
    if (win.kontour.outcome !== "pass") return;
    assert.equal(win.kontour.value, 451_000, "the win answers the real Q2 figure");
    assert.equal(win.kontour.grounded.groundedQualifier, "Q2-2025");
    // The trap refuses — bound to the SAME $451k Q2 figure, asked for Q3.
    assert.equal(trap.kontour.outcome, "block");
    if (trap.kontour.outcome !== "block") return;
    assert.equal(trap.kontour.grounded!.value, 451_000, "same $451k, refused for Q3");
    assert.equal(trap.kontour.grounded!.groundedQualifier, "Q2-2025");
    assert.equal(trap.kontour.mismatch, "qualifier");
  });

  it("precision counts: Kontour answers all wins and refuses all traps; RAG ships every trap", () => {
    const wins = runAll(WIN_SCENARIOS);
    const traps = runAll(TRAP_SCENARIOS);
    // Kontour: answered exactly when it could, refused exactly when it couldn't.
    assert.equal(
      wins.filter((r) => r.kontour.outcome === "pass").length,
      wins.length,
      "Kontour answers EVERY answerable question"
    );
    assert.equal(
      traps.filter((r) => r.kontour.outcome === "block").length,
      traps.length,
      "Kontour refuses EVERY trap"
    );
    // RAG: fine on the wins, wrong on every trap.
    assert.equal(
      wins.filter((r) => r.rag.passed).length,
      wins.length,
      "RAG also answers the wins"
    );
    assert.equal(
      traps.filter((r) => r.rag.passed).length,
      traps.length,
      "RAG ships the wrong answer on EVERY trap"
    );
  });
});

describe("Kontour lane uses the REAL survey/surface kernel (not stubs)", () => {
  for (const scenario of TRAP_SCENARIOS.filter((s) => s.id !== "s0")) {
    it(`${scenario.id}: blocked outcome still carries a real schemaVersion-3 bundle`, () => {
      const result = runScenario(scenario);
      assert.equal(result.kontour.outcome, "block");
      if (result.kontour.outcome !== "block") return;
      const grounded = result.kontour.grounded;
      assert.ok(grounded, "non-absence blocks should carry the grounded bundle");
      // schemaVersion 3 only comes from the real buildSurveyTrustBundle output.
      assert.equal(grounded!.bundle.schemaVersion, 3, "must be the real bundle");
      assert.equal(grounded!.bundle.claims[0].status, "verified");
      assert.ok(grounded!.bundle.events.length > 0, "real bundle has verification events");
      assert.ok(grounded!.bundle.events[0].verifiedAt, "verified event has verifiedAt");
      // The report is the real surface report.
      assert.equal(grounded!.report.summary.byStatus.verified, 1);
    });
  }

  it("s0 (absence) produces NO bundle — structurally cannot ground", () => {
    const result = runScenario(byId("s0"));
    assert.equal(result.kontour.outcome, "block");
    if (result.kontour.outcome !== "block") return;
    assert.equal(result.kontour.mismatch, "absent");
    assert.equal(result.kontour.grounded, undefined, "absence cannot carry a bundle");
  });
});

describe("per-scenario gate mechanism is the RIGHT one", () => {
  const expected: Record<string, string> = {
    s1: "qualifier",
    s2: "freshness",
    s3: "join",
    s4: "locator",
    s0: "absent",
    sokf: "freshness", // OKF stale-snapshot trap blocks via content-change invalidation
  };
  for (const scenario of TRAP_SCENARIOS) {
    it(`${scenario.id} blocks via the ${expected[scenario.id]} mismatch`, () => {
      const result = runScenario(scenario);
      assert.equal(result.kontour.outcome, "block");
      if (result.kontour.outcome !== "block") return;
      assert.equal(result.kontour.mismatch, expected[scenario.id]);
    });
  }

  it("s1 HERO: the grounded value is the real Q2 figure bound to Q2, refused for Q3", () => {
    const result = runScenario(byId("s1"));
    assert.equal(result.kontour.outcome, "block");
    if (result.kontour.outcome !== "block") return;
    assert.equal(result.kontour.grounded!.value, 451_000, "the real Q2 figure");
    assert.equal(result.kontour.grounded!.groundedQualifier, "Q2-2025", "bound to Q2");
    assert.match(result.kontour.reason, /Q3-2025/, "reason names the requested period");
    assert.match(result.kontour.reason, /Q2-2025/, "reason names the grounded period");
  });

  it("s2 STALE: the freshness reason names the integrity-ref boundary", () => {
    const result = runScenario(byId("s2"));
    assert.equal(result.kontour.outcome, "block");
    if (result.kontour.outcome !== "block") return;
    assert.match(result.kontour.reason, /STALE|stale/);
    assert.match(result.kontour.reason, /488,000/, "names the restated current value");
  });

  it("s4 CITATION: the locator reason names the cited locator", () => {
    const result = runScenario(byId("s4"));
    assert.equal(result.kontour.outcome, "block");
    if (result.kontour.outcome !== "block") return;
    assert.match(result.kontour.reason, /records\[0\]\.forecast/, "names the cited locator");
    assert.equal(result.kontour.grounded!.groundedLocator, "records[0].forecast");
  });
});

describe("OKF interop — grounded against a REAL, public Google OKF concept", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(__dirname, "okf-fixture", "blocks.md");
  const provenancePath = join(__dirname, "okf-fixture", "PROVENANCE.json");
  const concept = loadOkfConcept();

  it("the vendored fixture's sha256 matches PROVENANCE.json (un-riggable provenance)", () => {
    const raw = readFileSync(fixturePath, "utf8");
    const sha = sha256Of(raw);
    const prov = JSON.parse(readFileSync(provenancePath, "utf8"));
    assert.equal(sha, prov.sha256, "fixture sha256 must match recorded provenance");
    assert.equal(
      sha,
      "2e110091dd19ae94c2e095e7d6559061e29ef6b094a52d690779873d3b188d77",
      "the integrityRef is the real sha256 of Google's file"
    );
    assert.equal(concept.currentIntegrityRef, sha, "adapter computes the same hash");
  });

  it("the grounded fact (12 fields) genuinely appears in Google's file", () => {
    const count = countSchemaFields(concept);
    assert.equal(count, 12, "the OKF schema table has 12 field rows");
    assert.equal(OKF_WIN.rawAnswer, count, "the win grounds the counted value, not a literal");
    // Spot-check that real field names are present in the body (not fabricated).
    for (const f of ["merkle_root", "transaction_count", "coinbase_param"]) {
      assert.ok(concept.body.includes(f), `body must contain real field ${f}`);
    }
  });

  it("the OKF frontmatter maps resource→locator and timestamp→freshness anchor", () => {
    assert.match(
      concept.frontmatter.resource ?? "",
      /crypto_bitcoin\/tables\/blocks$/,
      "resource is the BigQuery table URI"
    );
    assert.equal(concept.frontmatter.timestamp, "2026-05-28T22:43:59+00:00");
    assert.equal(concept.frontmatter.type, "BigQuery Table");
  });

  it("OKF WIN: Kontour grounds the real source — sourceLocator==resource, integrityRef==sha256", () => {
    const result = runScenario(OKF_WIN);
    assert.equal(result.kontour.outcome, "pass", "the OKF win must PASS");
    if (result.kontour.outcome !== "pass") return;
    const g = result.kontour.grounded;
    // Real schemaVersion-3 bundle with a verified claim.
    assert.equal(g.bundle.schemaVersion, 3, "real buildSurveyTrustBundle output");
    assert.equal(g.bundle.claims[0].status, "verified", "claim is verified");
    assert.equal(g.report.summary.byStatus.verified, 1);
    // The evidence sourceLocator == the OKF resource URI.
    assert.equal(
      g.groundedLocator,
      concept.frontmatter.resource,
      "sourceLocator is the OKF resource URI"
    );
    assert.match(g.bundle.evidence[0].sourceLocator ?? "", /crypto_bitcoin\/tables\/blocks$/);
    // The integrityRef is the real sha256 of the vendored file content.
    assert.equal(
      g.groundingHashSnapshot,
      concept.currentIntegrityRef,
      "integrityRef == sha256 of the fixture"
    );
    // The real bundle surfaces the integrity-ref on the evidence (OKF's missing field).
    assert.equal(g.bundle.evidence[0].integrityRef, concept.currentIntegrityRef);
    // The freshness anchor is the OKF timestamp.
    assert.equal(g.groundedQualifier, concept.frontmatter.timestamp);
    assert.equal(result.kontour.value, 12, "answers the real field count");
  });

  it("OKF WIN: a fair RAG baseline ALSO answers the easy one (consistent precision framing)", () => {
    const result = runScenario(OKF_WIN);
    assert.equal(result.rag.passed, true, "RAG supports 12 fields from the OKF chunk");
    assert.equal(result.rag.factCheck.verdict, "supported");
  });

  it("OKF TRAP: stale integrity-ref no longer matches the file's current content hash → STALE", () => {
    const result = runScenario(OKF_TRAP);
    assert.equal(result.kontour.outcome, "block", "the OKF stale trap must BLOCK");
    if (result.kontour.outcome !== "block") return;
    assert.equal(result.kontour.mismatch, "freshness", "blocks via freshness invalidation");
    // The grounding snapshot is the STALE one; the current hash is the real sha256.
    assert.notEqual(
      result.kontour.grounded!.groundingHashSnapshot,
      concept.currentIntegrityRef,
      "the trap grounds a STALE snapshot, not the current hash"
    );
    assert.match(result.kontour.reason, /STALE|stale/);
    assert.match(result.kontour.reason, /integrity-ref/, "names the integrity-ref boundary");
    assert.match(result.kontour.reason, /OKF/, "explains OKF's timestamp cannot detect it");
    // Still a real schemaVersion-3 bundle (the stale grounding is real, just stale).
    assert.equal(result.kontour.grounded!.bundle.schemaVersion, 3);
  });

  it("OKF TRAP: a naive OKF-trusting / RAG consumer would serve the stale fact (the gap)", () => {
    const result = runScenario(OKF_TRAP);
    assert.equal(result.rag.passed, true, "RAG trusts the cached chunk and ships the stale value");
    assert.equal(result.rag.factCheck.verdict, "supported");
  });
});

describe("the RAG retriever + fact-checker are real and deterministic", () => {
  it("retrieval ranks by cosine similarity and is deterministic", () => {
    const a = retrieve("Alpha Corp Q3-2025 sales");
    const b = retrieve("Alpha Corp Q3-2025 sales");
    assert.deepEqual(
      a.map((r) => r.chunk.id),
      b.map((r) => r.chunk.id),
      "retrieval is deterministic"
    );
    assert.ok(a.length > 0, "retrieval finds Alpha chunks");
    // The Alpha Q2 chunk (which states $451k) is surfaced — the qualifier-blind blur
    // the demo relies on: a Q3 query retrieves the Q2 figure as on-topic Alpha sales.
    assert.ok(
      a.some((r) => r.chunk.id === "chunk-alpha-q2"),
      "Alpha Q2 chunk is retrieved for an Alpha Q3 query"
    );
  });

  it("fact-check honestly SUPPORTS $451k for an Alpha sales query (the blur)", () => {
    const fc = factCheck("Alpha Corp Q3-2025 sales", 451_000, ["Alpha"]);
    assert.equal(fc.verdict, "supported");
    assert.equal(fc.supportingChunkId, "chunk-alpha-q2");
  });

  it("fact-check ABSTAINS when no on-subject chunk exists (Vega absence)", () => {
    const fc = factCheck("Vega Labs Q3-2025 sales", 295_000, ["Vega"]);
    assert.equal(fc.verdict, "abstain", "no Vega chunk → cannot corroborate → abstain");
  });

  it("fact-check is subject-aware: a Beta chunk cannot support a Vega claim", () => {
    // Even though Beta/Gamma chunks are retrieved for a Vega query, none mention Vega,
    // so the checker abstains rather than falsely corroborating.
    const fc = factCheck("Vega Labs Q3-2025 sales", 512_000, ["Vega"]);
    assert.notEqual(fc.verdict, "supported", "must not falsely support from off-subject chunk");
  });
});
