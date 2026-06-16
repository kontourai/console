#!/usr/bin/env -S node --import tsx
/**
 * Runnable demo entry: executes both queries through the grounded and raw paths
 * and prints the structural difference to the terminal.
 *
 * Usage: npm run demo:grounded
 *   or:  node --import tsx demo/grounded-answer/run.ts
 */
import { answer, rawAnswer } from "./conductor.js";

const QUERIES = [
  { accountId: "account-alpha", period: "Q3-2025", label: "Alpha Corp Q3-2025 (data exists)" },
  { accountId: "account-omega", period: "Q3-2025", label: "Omega Ltd Q3-2025 (NO DATA — structural refusal)" },
];

function hr(char = "─", width = 72) {
  return char.repeat(width);
}

console.log("\n" + hr("═") + "\n  KONTOUR GROUNDED ANSWER DEMO — Structural Grounding Proof\n" + hr("═"));
console.log("\nThis demo proves that the conducted (grounded) path is categorically");
console.log("more trustworthy because it REFUSES instead of confabulating when");
console.log("the source is not there. The refusal is structural — not heuristic.\n");

for (const query of QUERIES) {
  console.log("\n" + hr());
  console.log(`  Query: What is ${query.label}?`);
  console.log(hr());

  // Raw path
  const raw = rawAnswer({ accountId: query.accountId, period: query.period });
  console.log("\n  [RAW / UNGROUNDED PATH]");
  console.log(`    Amount:     $${raw.amount.toLocaleString()}`);
  console.log(`    Provenance: ${raw.provenance ?? "NONE"}`);
  console.log(`    Has source: ${raw.hasSource}`);
  if (!raw.hasSource) {
    console.log("    !! Raw path returned a number with NO backing data — confabulation risk !!");
  }

  // Conducted (grounded) path
  const conducted = answer({ accountId: query.accountId, period: query.period });
  console.log("\n  [CONDUCTED / GROUNDED PATH]");

  if (conducted.kind === "grounded") {
    console.log(`    Result:     GROUNDED ANSWER`);
    console.log(`    Amount:     $${conducted.amount.toLocaleString()}`);
    console.log(`    Provenance: ${conducted.provenance}`);
    console.log(`    Claim status: ${conducted.bundle.claims[0]?.status ?? "unknown"}`);
    console.log(`    Trust report summary:`);
    const summary = conducted.report.summary;
    console.log(`      Verified: ${summary.byStatus.verified}`);
    console.log(`      Transparency gaps: ${conducted.report.transparencyGaps?.length ?? 0}`);
    console.log(`      Evidence count: ${conducted.report.evidence.length}`);
  } else {
    console.log(`    Result:     STRUCTURAL REFUSAL`);
    console.log(`    Reason:     ${conducted.reason}`);
    console.log(`    ✓ No fabricated number. No fake provenance. REFUSED.`);
  }
}

console.log("\n" + hr("═"));
console.log("  Structural honesty: the grounded path cannot emit a verified answer");
console.log("  without a real grounding record. TypeScript enforces it via the");
console.log("  GroundedAnswer | Refusal discriminated union. No runtime heuristic.");
console.log(hr("═") + "\n");
