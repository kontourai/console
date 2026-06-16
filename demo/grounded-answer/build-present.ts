#!/usr/bin/env -S node --import tsx
/**
 * Builds the standalone PRESENTATION-MODE deck (dist/present.html).
 *
 * This is a guided, keyboard-advanceable slide deck — one beat per screen — that a
 * founder walks an audience through. It is a PRESENTATION LAYER ONLY: every number,
 * verdict, and refusal reason is pulled from the SAME shared harness the gallery and
 * the tests use (runAll(SCENARIOS)). Nothing here is hardcoded — change a scenario and
 * the deck follows. The Kontour lane embeds the REAL <surface-trust-panel> fed the REAL
 * TrustReport, exactly like the gallery.
 *
 * Narrative arc (matches PRESENTATION.md):
 *   1  title (dark)            — "The Fact-Checker That Says Yes"
 *   2  setup                   — RAG + fact-check as the smart, state-of-the-art defense
 *   3..  per-scenario reveal   — order s1, s2, s4 (strong SUPPORTED), then s3, s0.
 *        Each scenario = TWO steps: (A) question + "does it catch it?"  (B) three lanes.
 *   N  insight                 — "The error was never in the text. It was in the binding."
 *   N  kontour answer          — decompose → ground → gate
 *   N  close (dark)            — scoreboard + "AI answers you can stand behind."
 *
 * Editorial styling: Fraunces / Hanken Grotesk / IBM Plex Mono;
 *   paper #f5f4ef, ink #0a0e13, mint #14a37a, cobalt #1f6f88, amber #c98a14.
 *   Presentation mode is more dramatic: bigger type, dark title/closing screens.
 *
 * Usage: npm run demo:grounded:present  →  demo/grounded-answer/dist/present.html
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "./harness.js";
import { SCENARIOS } from "./scenarios.js";
import type { LaneResults } from "./harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const outDir = join(__dirname, "dist");

mkdirSync(outDir, { recursive: true });
copyFileSync(
  join(root, "console-ui", "public", "surface-trust-panel.js"),
  join(outDir, "surface-trust-panel.js")
);

const results = runAll(SCENARIOS);
const byId = (id: string) => results.find((r) => r.scenario.id === id)!;

// Present in order of strength: the unbeatable SUPPORTED trio first, then the abstains.
const PRESENT_ORDER = ["s1", "s2", "s4", "s3", "s0"];
const ordered = PRESENT_ORDER.map(byId);

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Compute the live scoreboard from the harness (NOT hardcoded) ───────────────
const total = results.length;
const ragShippedWrong = results.filter((r) => r.rag.passed).length;
const kontourRefused = results.filter((r) => r.kontour.outcome === "block").length;

// Each scenario gives the panel its real grounded report (if any).
const panelReports: Record<string, unknown> = {};
for (const r of results) {
  const g = r.kontour.outcome === "block" ? r.kontour.grounded : r.kontour.grounded;
  if (g) panelReports[`panel-${r.scenario.id}`] = g.report;
}

const MISMATCH_LABEL: Record<string, string> = {
  qualifier: "qualifier mismatch",
  freshness: "stale / freshness breach",
  join: "invalid join",
  locator: "unsupported locator",
  absent: "no source — nothing to ground",
};

// ── Lane fragments (presentation-tuned, real data) ─────────────────────────────

function rawLane(r: LaneResults): string {
  return `
    <div class="lane lane-raw">
      <div class="lane-head"><span class="lane-badge raw">Raw LLM</span>
        <span class="lane-sub">no grounding</span></div>
      <div class="lane-body">
        <div class="amount neutral">${money(r.raw.answer)}</div>
        <div class="lane-verdict shipped">&#10003; answered confidently</div>
        <p class="lane-note">No source. No provenance. No refusal. A confident number whether or
          not it answers the question asked.</p>
      </div>
    </div>`;
}

function ragLane(r: LaneResults): string {
  const fc = r.rag.factCheck;
  const v = fc.verdict; // "supported" | "abstain" | "unsupported"
  // SUPPORTED on a wrong answer is the irony — render it as an alarming green check.
  const heroClass = v === "supported" ? "hero-supported" : "hero-abstain";
  const heroText = v === "supported" ? "&#10003; SUPPORTED" : "ABSTAIN";
  const heroSub =
    v === "supported"
      ? "the fact-checker endorsed this number"
      : "no contradicting evidence &mdash; pipeline ships anyway";
  return `
    <div class="lane lane-rag">
      <div class="lane-head"><span class="lane-badge rag">RAG + Fact-check</span>
        <span class="lane-sub">real retriever &middot; real entailment check</span></div>
      <div class="lane-body">
        <div class="amount neutral">${money(r.rag.answer)}</div>
        <div class="rag-hero ${heroClass}">
          <div class="rag-hero-badge">${heroText}</div>
          <div class="rag-hero-sub">${heroSub}</div>
        </div>
        <div class="ship-line ${r.rag.passed ? "shipped" : "held"}">
          ${r.rag.passed ? "&rarr; the wrong answer SHIPS to the user" : "held"}
        </div>
        <div class="why">
          <div class="why-label">Why a fair fact-checker passes this</div>
          <p>${esc(r.scenario.whyFactCheckPasses)}</p>
        </div>
      </div>
    </div>`;
}

function kontourLane(r: LaneResults): string {
  const k = r.kontour;
  const grounded = k.grounded;
  if (k.outcome !== "block") {
    // (Never happens in this deck — every scenario blocks — but keep it honest.)
    return `
    <div class="lane lane-kontour is-pass">
      <div class="lane-head"><span class="lane-badge kontour">Kontour Conducted</span></div>
      <div class="lane-body"><div class="amount mint">${money((k as { value: number }).value)}</div>
        <div class="lane-verdict held">&#10003; grounded &amp; verified</div></div>
    </div>`;
  }
  const panelBlock = grounded
    ? `
        <div class="panel-wrap">
          <div class="panel-label">Real Surface trust panel &mdash; what the bundle actually proves</div>
          <surface-trust-panel id="panel-${r.scenario.id}"></surface-trust-panel>
        </div>`
    : `<div class="panel-absent">Nothing could be grounded &mdash; no source record exists to build
        a bundle from. The gate refuses structurally; no panel because no claim exists.</div>`;
  return `
    <div class="lane lane-kontour is-block">
      <div class="lane-head"><span class="lane-badge kontour">Kontour Conducted</span>
        <span class="lane-sub">real bundle &middot; structural gate</span></div>
      <div class="lane-body">
        <div class="refuse-head">&#8856; Structural refusal</div>
        <div class="refuse-tag">${esc(MISMATCH_LABEL[k.mismatch])}</div>
        <div class="refuse-reason">${esc(k.reason)}</div>
        ${panelBlock}
      </div>
    </div>`;
}

// ── Step builders ──────────────────────────────────────────────────────────────

type Step = { name: string; cls: string; html: string };
const steps: Step[] = [];
function addStep(name: string, cls: string, html: string) {
  steps.push({ name, cls, html });
}

// 1 — Title (dark)
addStep("title", "step-dark step-center", `
  <div class="title-wrap">
    <div class="kicker">Kontour</div>
    <h1 class="title">The Fact-Checker<br>That Says <em>Yes</em>.</h1>
    <p class="title-dek">
      You ask AI about your own data &mdash; <em>&ldquo;what were Q3 sales for Alpha Corp?&rdquo;</em>
      It hands you a confident number. You almost drop it in the board deck. Then you check:
      <strong>it made it up.</strong>
    </p>
    <p class="title-foot">Everyone who has pointed AI at real data has had this exact moment.</p>
  </div>`);

// 2 — Setup: the reasonable defense
addStep("setup", "step-center", `
  <div class="setup-wrap">
    <div class="kicker cobalt">The reasonable defense</div>
    <h2 class="setup-h">So you do the responsible thing.</h2>
    <p class="setup-lead">You don&rsquo;t just trust the model. You build the defense a careful team ships:</p>
    <div class="setup-cols">
      <div class="setup-col">
        <div class="setup-num">1</div>
        <div class="setup-col-h">Retrieval</div>
        <p>Ground every answer in your <strong>real documents</strong> &mdash; a genuine
          retriever pulls the on-topic evidence.</p>
      </div>
      <div class="setup-plus">+</div>
      <div class="setup-col">
        <div class="setup-num">2</div>
        <div class="setup-col-h">Fact-check</div>
        <p>A second pass <strong>verifies the answer against the retrieved evidence</strong>
          before it ships.</p>
      </div>
    </div>
    <p class="setup-foot">This is <strong>RAG + fact-check</strong>. This is the state of the art.
      <span class="setup-foot-q">So &mdash; does it work?</span></p>
  </div>`);

// 3..N — per-scenario, two steps each (question, then reveal)
ordered.forEach((r, i) => {
  const s = r.scenario;
  const idx = i + 1;
  // (A) prediction beat — question only
  addStep(`${s.id}-question`, "step-center", `
    <div class="q-wrap">
      <div class="kicker cobalt">Scenario ${idx} of ${ordered.length} &middot; ${s.id.toUpperCase()}</div>
      <div class="q-label">A user asks</div>
      <p class="q-query">${esc(s.query)}</p>
      <div class="q-frame">
        <span class="q-frame-on">RAG + fact-check is on.</span>
        The retriever pulls the real source. The fact-checker verifies the number against it.
      </div>
      <p class="q-predict">Does it catch the error?</p>
    </div>`);
  // (B) reveal — three lanes
  addStep(`${s.id}-reveal`, "step-reveal", `
    <div class="reveal-head">
      <div class="kicker cobalt">${s.id.toUpperCase()} &middot; ${esc(s.title)}</div>
      <p class="reveal-query">${esc(s.query)}</p>
      <p class="reveal-truth"><strong>Truth:</strong> ${esc(s.correctAnswer)}</p>
    </div>
    <div class="lanes">
      ${rawLane(r)}
      ${ragLane(r)}
      ${kontourLane(r)}
    </div>`);
});

// Insight
addStep("insight", "step-dark step-center", `
  <div class="insight-wrap">
    <div class="kicker">The insight</div>
    <h2 class="insight-h">The error was never in the text.<br>It was in the <em>binding</em>.</h2>
    <p class="insight-lead">Every time, the fact-checker was <strong>right</strong> &mdash; the number
      really is in your evidence. What was wrong was the <strong>binding</strong>:</p>
    <div class="insight-grid">
      <div class="insight-chip">wrong <strong>period</strong></div>
      <div class="insight-chip">stale <strong>version</strong></div>
      <div class="insight-chip">wrong <strong>locator</strong></div>
      <div class="insight-chip">mixed-period <strong>join</strong></div>
    </div>
    <p class="insight-foot">A fact-checker reads <strong>text</strong>. It
      <strong>structurally cannot see a binding error</strong>, because the binding isn&rsquo;t in
      the text. You can&rsquo;t fix this by buying a better fact-checker. Checking <em>after</em>
      is the wrong shape.</p>
  </div>`);

// Kontour answer
addStep("kontour-answer", "step-center", `
  <div class="answer-wrap">
    <div class="kicker mint">The Kontour answer</div>
    <h2 class="answer-h">So we don&rsquo;t check after. We change the shape.</h2>
    <div class="answer-steps">
      <div class="answer-step">
        <div class="answer-step-n">Decompose</div>
        <p>Break the question into the claims it needs &mdash; and each claim carries its
          <strong>binding</strong>: this value, this entity, this <strong>period</strong>, this
          <strong>source location</strong>.</p>
      </div>
      <div class="answer-arrow">&rarr;</div>
      <div class="answer-step">
        <div class="answer-step-n">Ground</div>
        <p>Ground each claim against a <strong>real source</strong> &mdash; emitting a portable,
          recomputable trust bundle.</p>
      </div>
      <div class="answer-arrow">&rarr;</div>
      <div class="answer-step">
        <div class="answer-step-n">Gate</div>
        <p>The answer can&rsquo;t be presented as verified unless <strong>every binding matches
          what was asked</strong>. When it doesn&rsquo;t &mdash; it <strong>refuses</strong>.</p>
      </div>
    </div>
    <p class="answer-foot">It will not hand you a wrong number dressed as a right one. And every
      grounded claim emits a <strong>portable trust bundle</strong> &mdash; the Surface panel you
      saw &mdash; recomputable and auditable by someone who doesn&rsquo;t trust us.</p>
  </div>`);

// Close (dark) — scoreboard from the harness
addStep("close", "step-dark step-center", `
  <div class="close-wrap">
    <div class="kicker">The proof</div>
    <div class="scoreboard">
      <div class="score score-rag">
        <span class="score-num">${ragShippedWrong} / ${total}</span>
        <span class="score-lbl">a fair, competent RAG + fact-check pipeline<br>
          <strong>shipped the wrong answer</strong></span>
      </div>
      <div class="score-vs">vs</div>
      <div class="score score-kontour">
        <span class="score-num">${kontourRefused} / ${total}</span>
        <span class="score-lbl">the conducted path<br><strong>refused</strong></span>
      </div>
    </div>
    <p class="close-line">Not because it&rsquo;s smarter &mdash; because grounding is
      <strong>structural, not best-effort.</strong></p>
    <h2 class="close-tag">AI answers you can stand behind.</h2>
  </div>`);

// ── Assemble the deck ──────────────────────────────────────────────────────────

const stepsHtml = steps
  .map(
    (st, i) => `
    <section class="step ${st.cls}" data-step="${i}" data-name="${st.name}">
      <div class="step-inner">${st.html}</div>
    </section>`
  )
  .join("\n");

const stepNames = JSON.stringify(steps.map((s) => s.name));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kontour &middot; The Fact-Checker That Says Yes</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,0,500;9..144,0,600;9..144,0,700;9..144,1,500;9..144,1,600&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script type="module" src="./surface-trust-panel.js"><\/script>
  <style>
    :root {
      --paper: #f5f4ef;
      --ink: #0a0e13;
      --mint: #14a37a;
      --cobalt: #1f6f88;
      --amber: #c98a14;
      --red: #b03030;
      --line: rgba(10,14,19,0.12);
      --line-strong: rgba(10,14,19,0.22);
      --muted: rgba(10,14,19,0.62);
      --faint: rgba(10,14,19,0.42);
      --card: #fffefb;
      --serif: "Fraunces", Georgia, serif;
      --sans: "Hanken Grotesk", system-ui, sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      background: var(--paper);
      color: var(--ink);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }
    .kicker {
      font-family: var(--mono);
      font-size: 13px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--mint);
      font-weight: 600;
      margin-bottom: 22px;
    }
    .kicker.cobalt { color: var(--cobalt); }
    .kicker.mint { color: var(--mint); }
    em { font-style: italic; }

    /* ── Deck mechanics ───────────────────────────────────────────── */
    .deck { height: 100vh; width: 100vw; position: relative; }
    .step {
      position: absolute; inset: 0;
      display: none;
      padding: 56px 72px 92px;
      overflow-y: auto;
    }
    .step.is-active { display: flex; }
    .step-center { align-items: center; justify-content: center; text-align: center; }
    .step-inner { width: 100%; max-width: 1280px; margin: 0 auto; }
    .step-center > .step-inner { max-width: 980px; }

    .step-dark {
      background: var(--ink);
      color: var(--paper);
    }
    .step-dark .kicker { color: var(--mint); }

    /* ── Title ────────────────────────────────────────────────────── */
    .title { font-family: var(--serif); font-weight: 600; font-size: clamp(48px, 7vw, 92px);
      line-height: 1.02; letter-spacing: -0.02em; }
    .title em { color: var(--mint); font-style: italic; }
    .title-dek { font-size: clamp(18px, 2.1vw, 25px); color: rgba(245,244,239,0.82);
      max-width: 46ch; margin: 30px auto 0; line-height: 1.5; }
    .title-dek em { color: var(--paper); font-style: italic; }
    .title-dek strong { color: var(--amber); font-weight: 600; }
    .title-foot { margin-top: 28px; font-family: var(--mono); font-size: 14px;
      letter-spacing: 0.04em; color: rgba(245,244,239,0.5); }

    /* ── Setup ────────────────────────────────────────────────────── */
    .setup-h { font-family: var(--serif); font-weight: 600; font-size: clamp(34px, 4.6vw, 56px);
      letter-spacing: -0.015em; line-height: 1.06; }
    .setup-lead { font-size: clamp(17px, 2vw, 21px); color: var(--muted); margin: 18px auto 0;
      max-width: 56ch; }
    .setup-cols { display: flex; align-items: stretch; justify-content: center; gap: 22px;
      margin: 40px auto; max-width: 880px; }
    .setup-col { flex: 1; background: var(--card); border: 1px solid var(--line);
      border-radius: 12px; padding: 26px 24px; text-align: left; }
    .setup-num { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--cobalt);
      width: 28px; height: 28px; border: 1.5px solid var(--cobalt); border-radius: 50%;
      display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
    .setup-col-h { font-family: var(--serif); font-weight: 600; font-size: 24px; margin-bottom: 8px; }
    .setup-col p { font-size: 15.5px; color: var(--muted); }
    .setup-col strong { color: var(--ink); }
    .setup-plus { align-self: center; font-family: var(--serif); font-size: 40px; color: var(--faint); }
    .setup-foot { font-size: clamp(18px, 2.2vw, 24px); }
    .setup-foot strong { color: var(--cobalt); font-weight: 600; }
    .setup-foot-q { display: block; margin-top: 12px; font-family: var(--serif); font-style: italic;
      font-size: clamp(20px, 2.6vw, 30px); color: var(--ink); }

    /* ── Question / prediction beat ───────────────────────────────── */
    .q-label { font-family: var(--mono); font-size: 12px; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--faint); margin-bottom: 14px; }
    .q-query { font-family: var(--serif); font-weight: 600; font-size: clamp(34px, 5vw, 62px);
      letter-spacing: -0.015em; line-height: 1.08; max-width: 18ch; margin: 0 auto; }
    .q-query::before { content: "\\201C"; }
    .q-query::after { content: "\\201D"; }
    .q-frame { font-size: clamp(16px, 1.9vw, 20px); color: var(--muted); max-width: 54ch;
      margin: 36px auto 0; line-height: 1.5; }
    .q-frame-on { color: var(--cobalt); font-weight: 600; }
    .q-predict { font-family: var(--serif); font-style: italic; font-weight: 600;
      font-size: clamp(26px, 3.6vw, 44px); color: var(--ink); margin-top: 38px; }

    /* ── Reveal (three lanes) ─────────────────────────────────────── */
    .step-reveal .step-inner { max-width: 1320px; }
    .reveal-head { margin-bottom: 22px; }
    .reveal-head .kicker { margin-bottom: 10px; }
    .reveal-query { font-family: var(--serif); font-weight: 600; font-size: clamp(22px, 2.8vw, 30px);
      letter-spacing: -0.01em; }
    .reveal-query::before { content: "\\201C"; }
    .reveal-query::after { content: "\\201D"; }
    .reveal-truth { font-size: 14px; color: var(--muted); margin-top: 8px; max-width: 110ch; }
    .reveal-truth strong { color: var(--cobalt); }

    .lanes { display: grid; grid-template-columns: 0.92fr 1.18fr 1.25fr; gap: 20px; }
    @media (max-width: 1100px) { .lanes { grid-template-columns: 1fr; } }
    .lane { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
      display: flex; flex-direction: column; overflow: hidden; }
    .lane-rag { border-color: rgba(201,138,20,0.4); }
    .lane-kontour.is-block { border-color: rgba(31,111,136,0.5); }
    .lane-head { padding: 12px 16px; border-bottom: 1px solid var(--line);
      display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .lane-badge { font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.1em;
      text-transform: uppercase; padding: 3px 9px; border-radius: 4px; }
    .lane-badge.raw { background: rgba(10,14,19,0.07); color: var(--muted); }
    .lane-badge.rag { background: rgba(201,138,20,0.16); color: var(--amber); }
    .lane-badge.kontour { background: rgba(20,163,122,0.16); color: var(--mint); }
    .lane-sub { font-size: 11px; color: var(--faint); font-family: var(--mono); }
    .lane-body { padding: 18px 16px; display: flex; flex-direction: column; gap: 14px; flex: 1;
      text-align: left; }
    .amount { font-family: var(--serif); font-size: 34px; font-weight: 600; letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums; line-height: 1; }
    .amount.neutral { color: var(--ink); }
    .amount.mint { color: var(--mint); }
    .lane-verdict { font-family: var(--mono); font-size: 12px; font-weight: 600; }
    .lane-verdict.shipped { color: var(--muted); }
    .lane-verdict.held { color: var(--mint); }
    .lane-note { font-size: 13px; color: var(--muted); line-height: 1.5; }

    /* the SUPPORTED hero — alarming green check on a wrong answer */
    .rag-hero { border-radius: 10px; padding: 16px 16px; text-align: center; }
    .rag-hero.hero-supported {
      background: linear-gradient(180deg, rgba(20,163,122,0.16), rgba(20,163,122,0.07));
      border: 1.5px solid rgba(20,163,122,0.55);
    }
    .rag-hero.hero-abstain {
      background: rgba(201,138,20,0.08); border: 1.5px solid rgba(201,138,20,0.4);
    }
    .rag-hero-badge { font-family: var(--serif); font-weight: 700; letter-spacing: -0.01em;
      line-height: 1; }
    .hero-supported .rag-hero-badge { font-size: clamp(34px, 4vw, 50px); color: var(--mint); }
    .hero-abstain .rag-hero-badge { font-size: clamp(30px, 3.4vw, 42px); color: var(--amber); }
    .rag-hero-sub { font-size: 12.5px; margin-top: 8px; }
    .hero-supported .rag-hero-sub { color: var(--mint); }
    .hero-abstain .rag-hero-sub { color: var(--amber); }
    .ship-line { font-family: var(--mono); font-size: 12.5px; font-weight: 600; text-align: center;
      letter-spacing: 0.01em; }
    .ship-line.shipped { color: var(--red); }
    .why { margin-top: auto; background: rgba(201,138,20,0.07);
      border: 1px solid rgba(201,138,20,0.22); border-radius: 8px; padding: 12px 13px; }
    .why-label { font-size: 10px; letter-spacing: 0.07em; text-transform: uppercase;
      font-weight: 700; color: var(--amber); margin-bottom: 6px; }
    .why p { font-size: 12px; color: var(--muted); line-height: 1.5; }

    /* Kontour refusal lane */
    .refuse-head { font-family: var(--serif); font-size: 21px; font-weight: 600; color: var(--cobalt); }
    .refuse-tag { font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--cobalt); background: rgba(31,111,136,0.10);
      border: 1px solid rgba(31,111,136,0.3); border-radius: 4px; padding: 3px 9px; align-self: flex-start; }
    .refuse-reason { font-size: 13px; color: var(--ink); background: rgba(31,111,136,0.06);
      border-left: 3px solid var(--cobalt); border-radius: 0 6px 6px 0; padding: 11px 13px; line-height: 1.5; }
    .panel-wrap { margin-top: 2px; }
    .panel-label { font-size: 10.5px; color: var(--faint); letter-spacing: 0.04em;
      text-transform: uppercase; font-weight: 600; margin-bottom: 8px; padding-bottom: 6px;
      border-bottom: 1px solid var(--line); }
    .panel-absent { font-size: 13px; color: var(--muted); background: rgba(31,111,136,0.05);
      border: 1px dashed rgba(31,111,136,0.3); border-radius: 6px; padding: 12px 14px; line-height: 1.5; }
    surface-trust-panel { display: block; }
    .refuse-reason code, .panel-label code { font-family: var(--mono); font-size: 0.86em;
      background: rgba(31,111,136,0.12); color: var(--cobalt); padding: 1px 4px; border-radius: 3px; }

    /* ── Insight ──────────────────────────────────────────────────── */
    .insight-h { font-family: var(--serif); font-weight: 600; font-size: clamp(36px, 5.4vw, 68px);
      line-height: 1.04; letter-spacing: -0.02em; }
    .insight-h em { color: var(--mint); font-style: italic; }
    .insight-lead { font-size: clamp(17px, 2vw, 22px); color: rgba(245,244,239,0.82);
      max-width: 60ch; margin: 26px auto 0; }
    .insight-lead strong { color: var(--paper); }
    .insight-grid { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;
      margin: 28px auto; max-width: 720px; }
    .insight-chip { font-family: var(--mono); font-size: 14px; padding: 9px 16px;
      border: 1px solid rgba(245,244,239,0.28); border-radius: 999px; color: rgba(245,244,239,0.85); }
    .insight-chip strong { color: var(--mint); font-weight: 600; }
    .insight-foot { font-size: clamp(16px, 1.9vw, 21px); color: rgba(245,244,239,0.82);
      max-width: 62ch; margin: 0 auto; line-height: 1.5; }
    .insight-foot strong { color: var(--paper); }
    .insight-foot em { color: var(--amber); font-style: italic; }

    /* ── Kontour answer ───────────────────────────────────────────── */
    .answer-h { font-family: var(--serif); font-weight: 600; font-size: clamp(32px, 4.4vw, 54px);
      letter-spacing: -0.015em; line-height: 1.06; }
    .answer-steps { display: flex; align-items: stretch; justify-content: center; gap: 14px;
      margin: 40px auto; max-width: 1080px; }
    .answer-step { flex: 1; background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      padding: 24px 22px; text-align: left; }
    .answer-step-n { font-family: var(--serif); font-weight: 600; font-size: 25px; color: var(--mint);
      margin-bottom: 10px; }
    .answer-step p { font-size: 15px; color: var(--muted); }
    .answer-step strong { color: var(--ink); }
    .answer-arrow { align-self: center; font-size: 26px; color: var(--faint); }
    .answer-foot { font-size: clamp(15px, 1.8vw, 19px); color: var(--muted); max-width: 70ch;
      margin: 0 auto; line-height: 1.5; }
    .answer-foot strong { color: var(--ink); }

    /* ── Close ────────────────────────────────────────────────────── */
    .scoreboard { display: flex; align-items: center; justify-content: center; gap: 30px;
      margin: 12px auto 36px; }
    .score { display: flex; flex-direction: column; align-items: center; }
    .score-num { font-family: var(--serif); font-weight: 700; font-size: clamp(56px, 9vw, 120px);
      line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .score-rag .score-num { color: var(--amber); }
    .score-kontour .score-num { color: var(--mint); }
    .score-lbl { font-size: 14px; color: rgba(245,244,239,0.7); margin-top: 14px; line-height: 1.4; }
    .score-lbl strong { color: var(--paper); font-weight: 600; }
    .score-vs { font-family: var(--serif); font-style: italic; font-size: 28px;
      color: rgba(245,244,239,0.45); }
    .close-line { font-size: clamp(16px, 2vw, 22px); color: rgba(245,244,239,0.82); max-width: 52ch;
      margin: 0 auto 30px; }
    .close-line strong { color: var(--paper); }
    .close-tag { font-family: var(--serif); font-weight: 600; font-style: italic;
      font-size: clamp(34px, 5vw, 62px); color: var(--mint); letter-spacing: -0.01em; }

    /* ── Chrome: nav + indicator + progress ───────────────────────── */
    .chrome { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 28px; pointer-events: none; }
    .chrome .nav { display: flex; gap: 8px; pointer-events: auto; }
    .nav button { font-family: var(--mono); font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
      text-transform: uppercase; padding: 8px 16px; border-radius: 6px; cursor: pointer;
      border: 1px solid var(--line-strong); background: var(--card); color: var(--ink); }
    .nav button:hover { border-color: var(--ink); }
    .nav button:disabled { opacity: 0.32; cursor: default; }
    .indicator { font-family: var(--mono); font-size: 12px; letter-spacing: 0.1em;
      color: var(--faint); pointer-events: auto; }
    .step-dark ~ .chrome .indicator { color: rgba(245,244,239,0.5); }
    .progress { position: fixed; top: 0; left: 0; height: 3px; background: var(--mint);
      z-index: 60; transition: width 0.25s ease; }

    /* On dark steps, recolor the chrome for contrast via body class. */
    body.dark .nav button { background: rgba(245,244,239,0.08); color: var(--paper);
      border-color: rgba(245,244,239,0.3); }
    body.dark .nav button:hover { border-color: var(--paper); }
    body.dark .indicator { color: rgba(245,244,239,0.55); }

    @media print { .chrome, .progress { display: none; } }
  </style>
</head>
<body>
  <div class="progress" id="progress"></div>
  <div class="deck" id="deck">
    ${stepsHtml}
  </div>
  <div class="chrome">
    <div class="indicator"><span id="ind-num">1</span> / <span id="ind-total">${steps.length}</span>
      &nbsp;&middot;&nbsp; <span id="ind-name">title</span></div>
    <div class="nav">
      <button id="prev" aria-label="Previous">&larr; Prev</button>
      <button id="next" aria-label="Next">Next &rarr;</button>
    </div>
  </div>

  <script type="module">
    const reports = ${JSON.stringify(panelReports)};
    customElements.whenDefined("surface-trust-panel").then(() => {
      for (const [id, report] of Object.entries(reports)) {
        const el = document.getElementById(id);
        if (el) el.report = report;
      }
    });

    const names = ${stepNames};
    const stepEls = Array.from(document.querySelectorAll(".step"));
    const total = stepEls.length;
    const prevBtn = document.getElementById("prev");
    const nextBtn = document.getElementById("next");
    const indNum = document.getElementById("ind-num");
    const indName = document.getElementById("ind-name");
    const progress = document.getElementById("progress");

    // Allow deep-linking + restoring via #step-N (and Playwright targeting).
    function readHash() {
      const m = /^#step-(\\d+)$/.exec(location.hash || "");
      if (m) { const n = parseInt(m[1], 10); if (n >= 0 && n < total) return n; }
      return 0;
    }
    let cur = readHash();

    function render() {
      stepEls.forEach((el, i) => el.classList.toggle("is-active", i === cur));
      const isDark = stepEls[cur].classList.contains("step-dark");
      document.body.classList.toggle("dark", isDark);
      indNum.textContent = String(cur + 1);
      indName.textContent = names[cur];
      progress.style.width = ((cur + 1) / total * 100) + "%";
      prevBtn.disabled = cur === 0;
      nextBtn.disabled = cur === total - 1;
      if (location.hash !== "#step-" + cur) {
        history.replaceState(null, "", "#step-" + cur);
      }
      // Scroll the active step back to top when entering it.
      stepEls[cur].scrollTop = 0;
    }
    function go(n) { cur = Math.max(0, Math.min(total - 1, n)); render(); }

    prevBtn.addEventListener("click", () => go(cur - 1));
    nextBtn.addEventListener("click", () => go(cur + 1));
    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(cur + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(cur - 1); }
      else if (e.key === "Home") { go(0); }
      else if (e.key === "End") { go(total - 1); }
    });
    window.addEventListener("hashchange", () => { const n = readHash(); if (n !== cur) go(n); });
    render();
  </script>
</body>
</html>`;

writeFileSync(join(outDir, "present.html"), html, "utf8");

console.log(`\nPresentation deck built (${steps.length} steps):`);
steps.forEach((s, i) =>
  console.log(`  ${String(i + 1).padStart(2, "0")}  ${s.name}`)
);
console.log(`\n  HTML:  ${join(outDir, "present.html")}`);
console.log(`  Panel: ${join(outDir, "surface-trust-panel.js")}`);
console.log(`\n  Scoreboard (from harness): RAG shipped wrong ${ragShippedWrong}/${total} · Kontour refused ${kontourRefused}/${total}`);
console.log(`\nOpen: file://${join(outDir, "present.html")}\n`);
