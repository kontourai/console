#!/usr/bin/env -S node --import tsx
/**
 * Terminal runner for the three-lane gallery.
 *
 * Prints, for every scenario, the verdict of all three lanes:
 *   RAW       — confident, ungrounded answer (no gate).
 *   RAG       — real retrieve + real fact-check; ships the wrong answer.
 *   KONTOUR   — real buildSurveyTrustBundle + structural gate; refuses.
 *
 * Usage: npm run demo:grounded
 */

import { runAll } from "./harness.js";
import { SCENARIOS } from "./scenarios.js";

function hr(char = "─", width = 78) {
  return char.repeat(width);
}
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

console.log(
  "\n" +
    hr("═") +
    "\n  KONTOUR GROUNDED ANSWER — Three-Lane Gallery\n" +
    "  Structural grounding vs. a fair RAG + fact-check baseline\n" +
    hr("═")
);
console.log(
  "\n  The bet: structural grounding is categorically more trustworthy than a good\n" +
    "  RAG + fact-check pipeline. In EVERY scenario below, a fair, real RAG+fact-check\n" +
    "  lane PASSES the wrong answer, while the Kontour lane STRUCTURALLY refuses it.\n"
);

let ragShippedBad = 0;
let kontourCaught = 0;

for (const r of runAll(SCENARIOS)) {
  const s = r.scenario;
  console.log("\n" + hr());
  console.log(`  ${s.id.toUpperCase()} · ${s.title}`);
  console.log(`  Q: ${s.query}`);
  console.log(hr());

  // RAW
  console.log("\n  [1] RAW LLM (no grounding)");
  console.log(`      Answer:    ${money(r.raw.answer)}   (confident, no provenance)`);

  // RAG
  console.log("\n  [2] RAG + FACT-CHECK (real retriever + real entailment check)");
  console.log(`      Answer:    ${money(r.rag.answer)}`);
  console.log(
    `      Retrieved: ${r.rag.factCheck.retrieved
      .map((x) => `${x.chunk.id}(${x.score.toFixed(2)})`)
      .join(", ") || "(none)"}`
  );
  console.log(`      Verdict:   ${r.rag.factCheck.verdict.toUpperCase()}`);
  console.log(`      Ships?     ${r.rag.passed ? "YES — bad answer SHIPPED" : "no"}`);
  console.log(`      Why pass:  ${wrap(s.whyFactCheckPasses, 64, "                 ")}`);
  if (r.rag.passed) ragShippedBad++;

  // KONTOUR
  console.log("\n  [3] KONTOUR (real buildSurveyTrustBundle + structural gate)");
  if (r.kontour.outcome === "pass") {
    console.log(`      Verdict:   PASS — ${money(r.kontour.value)} (grounded)`);
  } else {
    kontourCaught++;
    const g = r.kontour.grounded;
    console.log(`      Verdict:   REFUSED  [mismatch: ${r.kontour.mismatch}]`);
    if (g) {
      console.log(
        `      Bundle:    schemaVersion=${g.bundle.schemaVersion} · ` +
          `claim status=${g.bundle.claims[0]?.status} · ` +
          `value=${money(g.value)} · bound to qualifier=${g.groundedQualifier} · ` +
          `locator=${g.groundedLocator}`
      );
    } else {
      console.log(`      Bundle:    (none — nothing could be grounded)`);
    }
    console.log(`      Reason:    ${wrap(r.kontour.reason, 64, "                 ")}`);
  }
  console.log(`\n      Truth:     ${wrap(s.correctAnswer, 64, "                 ")}`);
}

console.log("\n" + hr("═"));
console.log(
  `  SCOREBOARD across ${SCENARIOS.length} scenarios:\n` +
    `    RAG + fact-check shipped the WRONG answer:  ${ragShippedBad}/${SCENARIOS.length}\n` +
    `    Kontour structurally REFUSED the wrong answer: ${kontourCaught}/${SCENARIOS.length}`
);
console.log(
  "\n  Every Kontour refusal is structural: a discriminated GateOutcome over a REAL\n" +
    "  TrustBundle. No confidence threshold. The block carries no passable value —\n" +
    "  TypeScript makes it impossible to read one from a refusal."
);
console.log(hr("═") + "\n");

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line += " " + w;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n" + indent);
}
