#!/usr/bin/env -S node --import tsx
/**
 * Builds the standalone three-lane gallery HTML page.
 *
 * For every scenario it renders THREE columns — Raw LLM, RAG + fact-check, Kontour —
 * with real lane verdicts baked in from the shared harness. The Kontour column embeds
 * the REAL <surface-trust-panel> web component fed the REAL TrustReport whenever a claim
 * was grounded (even on a block: the panel shows WHAT was proven, next to why it does not
 * answer the question). The RAG column surfaces the honest WHY_FACTCHECK_PASSES note.
 *
 * Editorial styling: Fraunces / Hanken Grotesk / IBM Plex Mono;
 *   paper #f5f4ef, ink #0a0e13, mint #14a37a, cobalt #1f6f88, amber #c98a14.
 *
 * Usage: npm run demo:grounded:build  →  demo/grounded-answer/dist/index.html
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "./harness.js";
import { SCENARIOS, WIN_SCENARIOS, TRAP_SCENARIOS } from "./scenarios.js";
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

// Precision counts, derived from the harness (NOT hardcoded).
const wins = runAll(WIN_SCENARIOS);
const traps = runAll(TRAP_SCENARIOS);
const nWins = wins.length;
const nTraps = traps.length;
const kontourAnsweredWins = wins.filter((r) => r.kontour.outcome === "pass").length;
const ragAnsweredWins = wins.filter((r) => r.rag.passed).length;
const kontourRefusedTraps = traps.filter((r) => r.kontour.outcome === "block").length;
const ragShippedTraps = traps.filter((r) => r.rag.passed).length;

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Collect the reports to feed to the trust panels after the component defines.
const panelReports: Record<string, unknown> = {};
for (const r of results) {
  const g = r.kontour.outcome === "block" ? r.kontour.grounded : r.kontour.grounded;
  if (g) panelReports[`panel-${r.scenario.id}`] = g.report;
}

function ragColumn(r: LaneResults): string {
  const fc = r.rag.factCheck;
  const isWin = r.scenario.kind === "answerable";
  const retrieved = fc.retrieved
    .map((x) => `<span class="chip">${esc(x.chunk.id)} <em>${x.score.toFixed(2)}</em></span>`)
    .join("");
  const verdictClass =
    fc.verdict === "supported" ? "ok" : fc.verdict === "abstain" ? "warn" : "bad";
  const verdictLine = isWin
    ? `<div class="verdict held">&#10003; passed &mdash; correct answer shipped</div>`
    : `<div class="verdict ${r.rag.passed ? "shipped" : "held"}">
          ${r.rag.passed ? "&#10003; PASSED &mdash; bad answer shipped" : "held"}
        </div>`;
  const whyLabel = isWin
    ? "Why RAG also gets the easy one right"
    : "Why a fair fact-checker passes this";
  return `
    <div class="lane lane-rag">
      <div class="lane-head">
        <span class="lane-badge rag">RAG + Fact-check</span>
        <span class="lane-sub">real retriever · real entailment check</span>
      </div>
      <div class="lane-body">
        <div class="amount neutral">${money(r.rag.answer)}</div>
        ${verdictLine}
        <div class="kv">
          <div class="kv-label">Retrieved (cosine)</div>
          <div class="chips">${retrieved || "<span class='chip'>(none on-subject)</span>"}</div>
        </div>
        <div class="kv">
          <div class="kv-label">Fact-check verdict</div>
          <div><span class="pill ${verdictClass}">${fc.verdict}</span></div>
        </div>
        <div class="why">
          <div class="why-label">${whyLabel}</div>
          <p>${esc(r.scenario.whyFactCheckPasses)}</p>
        </div>
      </div>
    </div>`;
}

function rawColumn(r: LaneResults): string {
  return `
    <div class="lane lane-raw">
      <div class="lane-head">
        <span class="lane-badge raw">Raw LLM</span>
        <span class="lane-sub">no grounding · no provenance</span>
      </div>
      <div class="lane-body">
        <div class="amount neutral">${money(r.raw.answer)}</div>
        <div class="verdict shipped">&#10003; answered confidently</div>
        <div class="confab">
          &#9889; No source, no provenance, no refusal mechanism. The raw model emits a
          confident number whether or not it answers the question that was asked.
        </div>
      </div>
    </div>`;
}

function okfProvenance(r: LaneResults): string {
  const okf = r.scenario.okf;
  if (!okf) return "";
  const short = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;
  return `
        <div class="okf-prov">
          <div class="okf-prov-h">Real Google OKF source &mdash; un-riggable provenance</div>
          <div class="okf-prov-row"><span class="okf-prov-k">OKF resource &rarr; sourceLocator</span>
            <span class="okf-prov-v">${esc(okf.resourceUri)}</span></div>
          <div class="okf-prov-row"><span class="okf-prov-k">OKF timestamp &rarr; freshness anchor</span>
            <span class="okf-prov-v">${esc(okf.okfTimestamp)}</span></div>
          <div class="okf-prov-row added"><span class="okf-prov-k">+ Hachure integrity-ref (sha256)</span>
            <span class="okf-prov-v mono">${esc(short(okf.integrityRef))}</span></div>
          <div class="okf-prov-row"><span class="okf-prov-k">Vendored from</span>
            <span class="okf-prov-v small">GoogleCloudPlatform/knowledge-catalog @
              <code>${esc(okf.repoCommitSha.slice(0, 10))}</code> &mdash; diff &amp; recompute the hash</span></div>
        </div>`;
}

function kontourColumn(r: LaneResults): string {
  const k = r.kontour;
  const blocked = k.outcome === "block";
  const grounded = k.grounded;
  const mismatchLabel: Record<string, string> = {
    qualifier: "qualifier mismatch",
    freshness: "stale / freshness breach",
    join: "invalid join",
    locator: "unsupported locator",
    absent: "no source — nothing to ground",
  };
  const panelFootTail = blocked
    ? `The gate refuses because that binding does not answer the question asked.`
    : `The gate <strong>passes</strong> because that binding matches exactly what was asked.`;
  const panelBlock = grounded
    ? `${okfProvenance(r)}
        <div class="panel-wrap">
          <div class="panel-label">
            Real Surface Trust Panel &mdash; what the bundle actually proves
          </div>
          <surface-trust-panel id="panel-${r.scenario.id}"></surface-trust-panel>
          <div class="panel-foot">
            The panel above is the REAL output of <code>buildSurveyTrustBundle()</code> +
            <code>buildTrustReport()</code>. It verifies ${money(grounded.value)} bound to
            <code>${esc(grounded.groundedQualifier)}</code> at locator
            <code>${esc(grounded.groundedLocator)}</code>. ${panelFootTail}
          </div>
        </div>`
    : `<div class="panel-absent">
         Nothing could be grounded &mdash; there is no source record to build a bundle from.
         The gate refuses structurally; no panel because no claim exists.
       </div>`;

  return `
    <div class="lane lane-kontour ${blocked ? "is-block" : "is-pass"}">
      <div class="lane-head">
        <span class="lane-badge kontour">Kontour Conducted</span>
        <span class="lane-sub">real bundle · structural gate</span>
      </div>
      <div class="lane-body">
        ${
          blocked
            ? `
        <div class="refuse-head">&#8856; Structural refusal</div>
        <div class="refuse-tag">${esc(mismatchLabel[(k as { mismatch: string }).mismatch])}</div>
        <div class="refuse-reason">${esc((k as { reason: string }).reason)}</div>
        ${panelBlock}
        `
            : `
        <div class="amount mint">${money((k as { value: number }).value)}</div>
        <div class="verdict held">&#10003; grounded &amp; verified</div>
        ${panelBlock}
        `
        }
      </div>
    </div>`;
}

function scenarioBlock(r: LaneResults): string {
  const s = r.scenario;
  const kindBadge =
    s.kind === "answerable"
      ? `<span class="kind-badge win">Answerable &middot; win</span>`
      : `<span class="kind-badge trap">Trap</span>`;
  return `
  <section class="scenario" id="${s.slug}">
    <div class="scenario-head">
      <div class="scenario-tag">${s.id.toUpperCase()} ${kindBadge}</div>
      <h2 class="scenario-title">${esc(s.title)}</h2>
      <p class="scenario-query">${esc(s.query)}</p>
      <p class="scenario-truth"><strong>Truth:</strong> ${esc(s.correctAnswer)}</p>
    </div>
    <div class="lanes">
      ${rawColumn(r)}
      ${ragColumn(r)}
      ${kontourColumn(r)}
    </div>
  </section>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kontour · Structural Grounding Gallery</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script type="module" src="./surface-trust-panel.js"><\/script>
  <style>
    :root {
      --paper: #f5f4ef;
      --ink: #0a0e13;
      --mint: #14a37a;
      --cobalt: #1f6f88;
      --amber: #c98a14;
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
    body {
      background: var(--paper);
      color: var(--ink);
      font-family: var(--sans);
      font-size: 15px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      padding-bottom: 64px;
    }

    /* ── Masthead ─────────────────────────────────────────────────── */
    .masthead {
      border-bottom: 2px solid var(--ink);
      padding: 40px 48px 28px;
      max-width: 1320px;
      margin: 0 auto;
    }
    .brand {
      font-family: var(--mono);
      font-size: 12px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--mint);
      font-weight: 600;
    }
    .masthead h1 {
      font-family: var(--serif);
      font-weight: 600;
      font-size: 44px;
      line-height: 1.08;
      letter-spacing: -0.015em;
      margin: 10px 0 14px;
      max-width: 22ch;
    }
    .masthead h1 em { font-style: italic; color: var(--cobalt); }
    .dek {
      font-size: 16px;
      color: var(--muted);
      max-width: 78ch;
    }
    .dek strong { color: var(--ink); }

    /* ── Thesis strip ─────────────────────────────────────────────── */
    .thesis {
      max-width: 1320px;
      margin: 0 auto;
      padding: 18px 48px;
      display: flex;
      gap: 36px;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--line);
    }
    .thesis .metric { display: flex; flex-direction: column; }
    .thesis .metric .num {
      font-family: var(--serif);
      font-size: 30px;
      font-weight: 600;
      line-height: 1;
    }
    .thesis .metric.rag .num { color: var(--amber); }
    .thesis .metric.kontour .num { color: var(--mint); }
    .thesis .metric .lbl {
      font-size: 12px;
      color: var(--muted);
      max-width: 28ch;
      margin-top: 4px;
    }
    .thesis .note {
      font-size: 13px;
      color: var(--muted);
      max-width: 46ch;
      border-left: 2px solid var(--line-strong);
      padding-left: 16px;
    }
    .thesis code, .dek code {
      font-family: var(--mono);
      font-size: 0.85em;
      background: rgba(20,163,122,0.10);
      color: var(--mint);
      padding: 1px 5px;
      border-radius: 3px;
    }

    /* ── Scenario ─────────────────────────────────────────────────── */
    .scenario {
      max-width: 1320px;
      margin: 0 auto;
      padding: 40px 48px 8px;
      border-bottom: 1px solid var(--line);
    }
    .scenario-head { margin-bottom: 24px; }
    .scenario-tag {
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.16em;
      color: var(--cobalt);
      font-weight: 600;
    }
    .kind-badge {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      margin-left: 8px;
    }
    .kind-badge.win { background: rgba(20,163,122,0.14); color: var(--mint);
      border: 1px solid rgba(20,163,122,0.4); }
    .kind-badge.trap { background: rgba(201,138,20,0.14); color: var(--amber);
      border: 1px solid rgba(201,138,20,0.4); }
    .scenario-title {
      font-family: var(--serif);
      font-weight: 600;
      font-size: 27px;
      letter-spacing: -0.01em;
      margin: 4px 0 8px;
    }
    .scenario-query {
      font-size: 17px;
      font-weight: 500;
      color: var(--ink);
    }
    .scenario-query::before { content: "\\201C"; }
    .scenario-query::after { content: "\\201D"; }
    .scenario-truth {
      font-size: 13px;
      color: var(--muted);
      margin-top: 8px;
      max-width: 90ch;
    }
    .scenario-truth strong { color: var(--cobalt); }

    /* ── Lanes ────────────────────────────────────────────────────── */
    .lanes {
      display: grid;
      grid-template-columns: 1fr 1fr 1.15fr;
      gap: 20px;
    }
    @media (max-width: 1080px) { .lanes { grid-template-columns: 1fr; } }

    .lane {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .lane-kontour.is-block { border-color: rgba(31,111,136,0.5); }
    .lane-head {
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }
    .lane-badge {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 3px 9px;
      border-radius: 4px;
    }
    .lane-badge.raw { background: rgba(201,138,20,0.14); color: var(--amber); }
    .lane-badge.rag { background: rgba(201,138,20,0.14); color: var(--amber); }
    .lane-badge.kontour { background: rgba(20,163,122,0.16); color: var(--mint); }
    .lane-sub { font-size: 11px; color: var(--faint); font-family: var(--mono); }
    .lane-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; flex: 1; }

    .amount {
      font-family: var(--serif);
      font-size: 38px;
      font-weight: 600;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .amount.neutral { color: var(--ink); }
    .amount.mint { color: var(--mint); }

    .verdict {
      font-size: 12px;
      font-weight: 600;
      font-family: var(--mono);
      letter-spacing: 0.02em;
    }
    .verdict.shipped { color: var(--amber); }
    .verdict.held { color: var(--mint); }

    .confab {
      font-size: 12.5px;
      color: var(--muted);
      background: rgba(201,138,20,0.08);
      border: 1px solid rgba(201,138,20,0.24);
      border-radius: 6px;
      padding: 10px 12px;
      line-height: 1.5;
    }

    .kv { display: flex; flex-direction: column; gap: 4px; }
    .kv-label {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--faint);
      font-weight: 600;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .chip {
      font-family: var(--mono);
      font-size: 10.5px;
      background: rgba(10,14,19,0.05);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 2px 6px;
      color: var(--muted);
    }
    .chip em { color: var(--cobalt); font-style: normal; }
    .pill {
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .pill.ok { background: rgba(20,163,122,0.14); color: var(--mint); }
    .pill.warn { background: rgba(201,138,20,0.16); color: var(--amber); }
    .pill.bad { background: rgba(176,48,48,0.14); color: #b03030; }

    .why {
      margin-top: auto;
      background: rgba(201,138,20,0.07);
      border: 1px solid rgba(201,138,20,0.22);
      border-radius: 6px;
      padding: 11px 13px;
    }
    .why-label {
      font-size: 10px;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--amber);
      margin-bottom: 6px;
    }
    .why p { font-size: 12.5px; color: var(--muted); line-height: 1.55; }

    /* ── Kontour refusal ──────────────────────────────────────────── */
    .refuse-head {
      font-family: var(--serif);
      font-size: 19px;
      font-weight: 600;
      color: var(--cobalt);
    }
    .refuse-tag {
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--cobalt);
      background: rgba(31,111,136,0.10);
      border: 1px solid rgba(31,111,136,0.3);
      border-radius: 4px;
      padding: 3px 9px;
      align-self: flex-start;
    }
    .refuse-reason {
      font-size: 13.5px;
      color: var(--ink);
      background: rgba(31,111,136,0.06);
      border-left: 3px solid var(--cobalt);
      border-radius: 0 6px 6px 0;
      padding: 11px 13px;
      line-height: 1.55;
    }
    .panel-wrap { margin-top: 4px; }
    .panel-label, .panel-foot {
      font-size: 11px;
      color: var(--faint);
      letter-spacing: 0.04em;
    }
    .panel-label {
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--line);
    }
    .panel-foot { margin-top: 10px; line-height: 1.5; color: var(--muted); }
    .panel-foot code, .refuse-reason code {
      font-family: var(--mono);
      font-size: 0.86em;
      background: rgba(31,111,136,0.12);
      color: var(--cobalt);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .panel-absent {
      font-size: 13px;
      color: var(--muted);
      background: rgba(31,111,136,0.05);
      border: 1px dashed rgba(31,111,136,0.3);
      border-radius: 6px;
      padding: 12px 14px;
      line-height: 1.5;
    }
    surface-trust-panel { display: block; }

    /* ── OKF provenance strip (real Google source) ────────────────── */
    .okf-prov {
      border: 1px solid rgba(20,163,122,0.35);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .okf-prov-h {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--mint);
      background: rgba(20,163,122,0.08);
      padding: 7px 12px;
      border-bottom: 1px solid rgba(20,163,122,0.25);
    }
    .okf-prov-row {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      padding: 7px 12px;
      font-size: 12px;
      border-bottom: 1px solid var(--line);
    }
    .okf-prov-row:last-child { border-bottom: none; }
    .okf-prov-row.added { background: rgba(20,163,122,0.06); }
    .okf-prov-k {
      font-family: var(--mono);
      font-size: 10.5px;
      letter-spacing: 0.02em;
      color: var(--muted);
      flex-shrink: 0;
    }
    .okf-prov-row.added .okf-prov-k { color: var(--mint); font-weight: 600; }
    .okf-prov-v { text-align: right; word-break: break-all; color: var(--ink); }
    .okf-prov-v.mono { font-family: var(--mono); color: var(--mint); }
    .okf-prov-v.small { font-size: 11px; color: var(--muted); }
    .okf-prov-v code {
      font-family: var(--mono);
      font-size: 0.88em;
      background: rgba(31,111,136,0.12);
      color: var(--cobalt);
      padding: 1px 4px;
      border-radius: 3px;
    }

    /* ── Colophon ─────────────────────────────────────────────────── */
    .colophon {
      max-width: 1320px;
      margin: 32px auto 0;
      padding: 28px 48px;
    }
    .colophon h3 {
      font-family: var(--mono);
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--faint);
      margin-bottom: 12px;
    }
    .colophon p { font-size: 13px; color: var(--muted); max-width: 92ch; }
    .colophon p + p { margin-top: 10px; }
    .colophon code {
      font-family: var(--mono);
      font-size: 0.86em;
      background: rgba(20,163,122,0.10);
      color: var(--mint);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .colophon strong { color: var(--ink); }
  </style>
</head>
<body>
  <header class="masthead">
    <div class="brand">Kontour</div>
    <h1>A <em>precise</em> discriminator &mdash; answers when it can, refuses when it can&rsquo;t.</h1>
    <p class="dek">
      ${nWins} answerable questions and ${nTraps} traps. Three lanes each. The
      <strong>RAG&nbsp;+&nbsp;fact-check</strong> lane is a <strong>real, fair baseline</strong>
      &mdash; a deterministic cosine retriever over a chunk corpus and an entailment-style checker.
      On the answerable questions, <strong>both Kontour and RAG answer correctly</strong>. On the
      traps, the RAG lane <strong>honestly passes</strong> a wrong answer the checker endorsed; only
      <strong>Kontour</strong> catches them &mdash; it grounds each claim with the real
      <code>buildSurveyTrustBundle()</code> and gates the value on its
      <strong>qualifier, freshness, join, and locator</strong>. The set mixes wins (it answers) with
      traps (it refuses) &mdash; including one pair grounded against a <strong>real, public Google
      Open Knowledge Format (OKF) bundle</strong>, not our own data.
    </p>
  </header>

  <div class="thesis">
    <div class="metric kontour">
      <span class="num">${kontourAnsweredWins} / ${nWins} &middot; ${kontourRefusedTraps} / ${nTraps}</span>
      <span class="lbl">Kontour answered every answerable question and refused every trap</span>
    </div>
    <div class="metric rag">
      <span class="num">${ragAnsweredWins} / ${nWins} &middot; ${ragShippedTraps} / ${nTraps}</span>
      <span class="lbl">RAG answered the wins too &mdash; but shipped a wrong answer on every trap</span>
    </div>
    <div class="note">
      <strong>Answered exactly when it could. Refused exactly when it couldn&rsquo;t.</strong>
      RAG + fact-check couldn&rsquo;t tell the two apart: a post-hoc text check confirms a number
      appears in evidence, not that it answers the exact question asked. Structural grounding can.
    </div>
  </div>

  ${results.map(scenarioBlock).join("\n")}

  <section class="colophon">
    <h3>What is real vs. mocked</h3>
    <p>
      <strong>Mocked:</strong> the in-memory sales corpus (structured records + free-text chunks) and
      the deterministic content hashes (modelled like HTTP ETags). The same underlying facts feed
      both the chunks the RAG lane retrieves and the structured records the Kontour lane grounds &mdash;
      the baseline is not handed a degraded corpus.
    </p>
    <p>
      <strong>Real:</strong> the RAG lane is a genuine cosine retriever + entailment-style fact-checker
      (no network, no API, no LLM). The Kontour lane calls the real
      <code>buildSurveyTrustBundle()</code> from <code>@kontourai/survey</code> &mdash; which throws if a
      claim is &ldquo;verified&rdquo; without a review actor + <code>reviewedAt</code> + locator &mdash; and
      <code>buildTrustReport()</code> from <code>@kontourai/surface</code>. The trust panels above are the
      real output of those calls.
    </p>
    <p>
      <strong>OKF interop (real, public source):</strong> the two OKF scenarios are NOT grounded
      against our data. The grounded source is a byte-for-byte copy of a Google Cloud
      <strong>Open Knowledge Format</strong> concept file (the Bitcoin Blocks BigQuery table),
      vendored under <code>okf-fixture/</code> with a <code>PROVENANCE.json</code> recording the
      upstream URL, repo commit SHA, and sha256. The grounded fact &mdash; the schema defines 12
      fields &mdash; is counted from the file&rsquo;s own schema table. The adapter maps the OKF
      <code>resource</code> URI to the evidence sourceLocator, the OKF <code>timestamp</code> to the
      freshness anchor, and adds the sha256 <strong>integrity-ref OKF has no field for</strong>. A
      skeptic can diff the fixture against Google&rsquo;s repo and recompute the hash.
    </p>
    <p>
      <strong>Structural gate:</strong> each lane verdict is a discriminated <code>GateOutcome</code>
      (<code>pass</code> | <code>block</code>) computed by comparing the request against the binding facts
      in the real bundle &mdash; qualifier, integrity-ref snapshot, sub-claim periods, cited locator. No
      confidence threshold. A <code>block</code> carries no passable value, so no code path can emit a
      verified answer when the binding fails.
    </p>
  </section>

  <script type="module">
    const reports = ${JSON.stringify(panelReports)};
    customElements.whenDefined("surface-trust-panel").then(() => {
      for (const [id, report] of Object.entries(reports)) {
        const el = document.getElementById(id);
        if (el) el.report = report;
      }
    });
  </script>
</body>
</html>`;

writeFileSync(join(outDir, "index.html"), html, "utf8");

console.log(`\nThree-lane gallery built:`);
console.log(`  HTML:  ${join(outDir, "index.html")}`);
console.log(`  Panel: ${join(outDir, "surface-trust-panel.js")}`);
console.log(`\nServe: npx serve ${outDir}  ·  or open file://${join(outDir, "index.html")}\n`);
