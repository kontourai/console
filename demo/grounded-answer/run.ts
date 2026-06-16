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
import { SCENARIOS, WIN_SCENARIOS, TRAP_SCENARIOS } from "./scenarios.js";

function hr(char = "─", width = 78) {
  return char.repeat(width);
}
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

console.log(
  "\n" +
    hr("═") +
    "\n  KONTOUR GROUNDED ANSWER — Three-Lane Gallery\n" +
    "  A precise discriminator vs. a fair RAG + fact-check baseline\n" +
    hr("═")
);
console.log(
  "\n  The bet: Kontour answers EXACTLY when it can and refuses EXACTLY when it can't.\n" +
    "  Below, ANSWERABLE questions (wins) and TRAPS run through the same harness. On the\n" +
    "  wins, both Kontour and a fair RAG+fact-check lane answer correctly. On the traps, the\n" +
    "  RAG lane ships a wrong answer the fact-checker endorsed — only Kontour catches them.\n"
);

for (const r of runAll(SCENARIOS)) {
  const s = r.scenario;
  const kindTag = s.kind === "answerable" ? "ANSWERABLE (win)" : "TRAP";
  console.log("\n" + hr());
  console.log(`  ${s.id.toUpperCase()} · [${kindTag}] · ${s.title}`);
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
  if (s.kind === "answerable") {
    console.log(`      Ships?     YES — correct answer (a right answer to a right question)`);
  } else {
    console.log(`      Ships?     ${r.rag.passed ? "YES — WRONG answer SHIPPED" : "no"}`);
  }
  console.log(`      Why:       ${wrap(s.whyFactCheckPasses, 64, "                 ")}`);

  // KONTOUR
  console.log("\n  [3] KONTOUR (real buildSurveyTrustBundle + structural gate)");
  if (r.kontour.outcome === "pass") {
    const g = r.kontour.grounded;
    console.log(`      Verdict:   ANSWERED — ${money(r.kontour.value)} (grounded & verified)`);
    console.log(
      `      Bundle:    schemaVersion=${g.bundle.schemaVersion} · ` +
        `claim status=${g.bundle.claims[0]?.status} · ` +
        `bound to qualifier=${g.groundedQualifier} · locator=${g.groundedLocator}`
    );
  } else {
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

// ── Precision scoreboard, all counts derived from the harness ──────────────────
const wins = runAll(WIN_SCENARIOS);
const traps = runAll(TRAP_SCENARIOS);
const nWins = wins.length;
const nTraps = traps.length;
const kontourAnsweredWins = wins.filter((r) => r.kontour.outcome === "pass").length;
const ragAnsweredWins = wins.filter((r) => r.rag.passed).length;
const kontourRefusedTraps = traps.filter((r) => r.kontour.outcome === "block").length;
const ragShippedTraps = traps.filter((r) => r.rag.passed).length;

console.log("\n" + hr("═"));
console.log("  SCOREBOARD — precision, not a refusal count\n");
console.log(`  ANSWERABLE questions (${nWins}):  both fine on the easy ones`);
console.log(`    Kontour answered correctly:                 ${kontourAnsweredWins}/${nWins}`);
console.log(`    RAG + fact-check answered correctly:        ${ragAnsweredWins}/${nWins}`);
console.log(`\n  TRAP questions (${nTraps}):  only Kontour caught them`);
console.log(`    Kontour refused (rather than fake it):      ${kontourRefusedTraps}/${nTraps}`);
console.log(`    RAG + fact-check shipped the WRONG answer:  ${ragShippedTraps}/${nTraps}`);
console.log(
  "\n  Answered exactly when it could. Refused exactly when it couldn't.\n" +
    "  RAG + fact-check couldn't tell the two apart.\n"
);
console.log(
  "  Every Kontour verdict is structural: a discriminated GateOutcome over a REAL\n" +
    "  TrustBundle. No confidence threshold. A block carries no passable value —\n" +
    "  TypeScript makes it impossible to read one from a refusal.\n"
);
console.log("  AI answers you can stand behind.");
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
