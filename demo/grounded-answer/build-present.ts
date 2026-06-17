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
import { SCENARIOS, WIN_SCENARIOS, TRAP_SCENARIOS, OKF_WIN, OKF_TRAP } from "./scenarios.js";
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

// The HERO precision pair: the same Alpha data asked two ways — Q2 (answers) then Q3 (refuses).
const heroWin = byId("w1"); // Alpha Q2 — answerable
const heroTrap = byId("s1"); // Alpha Q3 — the trap twin
// The opening win establishes "the product is a trustworthy answer" before any trap.
const openWin = byId("w0");
// Remaining traps after the hero pair: strong SUPPORTED (s2, s4) then the abstains (s3, s0).
const REMAINING_TRAP_ORDER = ["s2", "s4", "s3", "s0"];
const remainingTraps = REMAINING_TRAP_ORDER.map(byId);

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
// Scenario-aware value formatter: counts (e.g. OKF schema fields) render as "N noun", money otherwise.
const fmtVal = (n: number, sc?: { unit?: { noun: string } }) =>
  sc?.unit ? `${n.toLocaleString("en-US")} ${sc.unit.noun}` : money(n);
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Compute the live PRECISION scoreboard from the harness (NOT hardcoded) ─────
// The story is discrimination, not a refusal count: across answerable AND trap
// questions, Kontour answered exactly when it could and refused exactly when it
// couldn't; RAG matched it on the answerable ones and shipped wrong on every trap.
const wins = runAll(WIN_SCENARIOS);
const traps = runAll(TRAP_SCENARIOS);
const nWins = wins.length;
const nTraps = traps.length;
const kontourAnsweredWins = wins.filter((r) => r.kontour.outcome === "pass").length;
const ragAnsweredWins = wins.filter((r) => r.rag.passed).length;
const kontourRefusedTraps = traps.filter((r) => r.kontour.outcome === "block").length;
const ragShippedTraps = traps.filter((r) => r.rag.passed).length;
// MCP counts, only over scenarios that carry an MCP lane (harness-derived). On a trap, the
// MCP agent "shipped wrong" when it shipped without catching the error; on a win, it answered.
const winsWithMcp = wins.filter((r) => r.mcp);
const trapsWithMcp = traps.filter((r) => r.mcp);
const nWinsMcp = winsWithMcp.length;
const nTrapsMcp = trapsWithMcp.length;
const mcpAnsweredWins = winsWithMcp.filter((r) => r.mcp!.shipped).length;
const mcpShippedTraps = trapsWithMcp.filter((r) => r.mcp!.shipped && !r.mcp!.caught).length;

// Each scenario gives the panel its real grounded report (if any) — wins (PASS) and
// the non-absence blocks both carry a real bundle/report the panel renders.
const panelReports: Record<string, unknown> = {};
for (const r of results) {
  const g = r.kontour.grounded;
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
        <div class="amount neutral">${fmtVal(r.raw.answer, r.scenario)}</div>
        <div class="lane-verdict shipped">&#10003; answered confidently</div>
        <p class="lane-note">No source. No provenance. No refusal. A confident number whether or
          not it answers the question asked.</p>
      </div>
    </div>`;
}

function ragLane(r: LaneResults): string {
  const fc = r.rag.factCheck;
  const v = fc.verdict; // "supported" | "abstain" | "unsupported"
  const isWin = r.scenario.kind === "answerable";
  // SUPPORTED on a wrong answer is the irony — render it as an alarming green check.
  // On a WIN, SUPPORTED is genuinely correct — render it as an ordinary correct pass.
  const heroClass = v === "supported" ? "hero-supported" : "hero-abstain";
  const heroText = v === "supported" ? "&#10003; SUPPORTED" : "ABSTAIN";
  const heroSub = isWin
    ? "correctly confirms the right answer"
    : v === "supported"
      ? "the fact-checker endorsed this number"
      : "no contradicting evidence &mdash; pipeline ships anyway";
  const shipText = isWin
    ? "&rarr; the correct answer ships"
    : r.rag.passed
      ? "&rarr; the wrong answer SHIPS to the user"
      : "held";
  const whyLabel = isWin
    ? "Why RAG also gets the easy one right"
    : "Why a fair fact-checker passes this";
  return `
    <div class="lane lane-rag">
      <div class="lane-head"><span class="lane-badge rag">RAG + Fact-check</span>
        <span class="lane-sub">real retriever &middot; real entailment check</span></div>
      <div class="lane-body">
        <div class="amount neutral">${fmtVal(r.rag.answer, r.scenario)}</div>
        <div class="rag-hero ${heroClass}">
          <div class="rag-hero-badge">${heroText}</div>
          <div class="rag-hero-sub">${heroSub}</div>
        </div>
        <div class="ship-line ${isWin ? "held" : r.rag.passed ? "shipped" : "held"}">
          ${shipText}
        </div>
        <div class="why">
          <div class="why-label">${whyLabel}</div>
          <p>${esc(r.scenario.whyFactCheckPasses)}</p>
        </div>
      </div>
    </div>`;
}

const MCP_GAP_LABEL: Record<string, string> = {
  qualifier: "wrong qualifier",
  freshness: "stale tool/cache result",
  locator: "wrong locator",
  join: "mixed-period join",
  "no-artifact": "no recomputable artifact",
  none: "caught it",
};

function mcpLane(r: LaneResults): string {
  const m = r.mcp;
  if (!m) return "";
  const caught = m.caught;
  // Right answer with only a portability gap → amber-neutral. A shipped wrong answer → alarm.
  const shippedWrong = m.shipped && !caught;
  const verdictClass = shippedWrong ? "mcp-bad" : "mcp-soft";
  const verdictText = !m.shipped
    ? "&#8856; refused (tool returned nothing)"
    : caught
      ? "&#10003; answered &mdash; but unbound"
      : "&#10003; answered &mdash; from a real tool call";
  const amount = m.answer !== undefined ? fmtVal(m.answer, r.scenario) : "&mdash;";
  const shipLine = shippedWrong
    ? `&rarr; the wrong answer SHIPS &mdash; from a live tool call`
    : caught && m.shipped
      ? `right number, but no portable proof of which call backed it`
      : !m.shipped
        ? `a well-formed query catches it &mdash; honest`
        : ``;
  return `
    <div class="lane lane-mcp">
      <div class="lane-head"><span class="lane-badge mcp">Agent + Tools (MCP)</span>
        <span class="lane-sub">real tool &middot; live system query</span></div>
      <div class="lane-body">
        <div class="amount neutral">${amount}</div>
        <div class="mcp-call"><span class="mcp-call-k">tool call</span>
          <code>${esc(m.call.tool)}(${esc(m.call.args.account)}, ${esc(m.call.args.period)})</code></div>
        <div class="mcp-verdict ${verdictClass}">
          <span class="mcp-gap">${MCP_GAP_LABEL[m.gap]}</span>
          <span class="mcp-vtext">${verdictText}</span>
        </div>
        ${shipLine ? `<div class="mcp-ship ${shippedWrong ? "bad" : "soft"}">${shipLine}</div>` : ""}
        <div class="why mcp-why">
          <div class="why-label">${caught && m.gap === "none" ? "Where the tool is enough" : "Where tool access falls short"}</div>
          <p>${esc(m.note)}</p>
        </div>
      </div>
    </div>`;
}

function kontourLane(r: LaneResults): string {
  const k = r.kontour;
  const grounded = k.grounded;
  if (k.outcome !== "block") {
    // WIN: the gate PASSES. Emit the confident grounded value + the real green trust panel.
    return `
    <div class="lane lane-kontour is-pass">
      <div class="lane-head"><span class="lane-badge kontour">Kontour Conducted</span>
        <span class="lane-sub">real bundle &middot; structural gate</span></div>
      <div class="lane-body">
        <div class="amount mint">${fmtVal(k.value, r.scenario)}</div>
        <div class="answer-verified">&#10003; Grounded &amp; verified &mdash; the binding matches what was asked</div>
        <div class="panel-wrap">
          <div class="panel-label">Real Surface trust panel &mdash; what the bundle proves</div>
          <surface-trust-panel id="panel-${r.scenario.id}"></surface-trust-panel>
        </div>
      </div>
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

// 2b — THE LADDER: Raw → RAG → Agent+Tools (MCP) → Kontour. Each rung more grounded than
//      the last; only Kontour is bound-and-gated with a portable artifact. This frames the
//      MCP baseline as the relatable stepping stone to how Kontour delivers its answer.
addStep("ladder", "step-center", `
  <div class="ladder-wrap">
    <div class="kicker cobalt">The ladder of grounding</div>
    <h2 class="ladder-h">There&rsquo;s more than one way to ground an answer.</h2>
    <p class="ladder-lead">Each rung is <strong>more grounded</strong> than the last. The modern
      one isn&rsquo;t RAG &mdash; it&rsquo;s giving an agent a <strong>real tool</strong> to query the
      actual system. Watch how far that gets you, and where it still stops short.</p>
    <div class="ladder">
      <div class="ladder-rung r-raw">
        <div class="ladder-n">Raw LLM</div>
        <p>A confident number. <strong>No source</strong> at all.</p>
      </div>
      <div class="ladder-arrow">&rarr;</div>
      <div class="ladder-rung r-rag">
        <div class="ladder-n">RAG</div>
        <p>Retrieve documents, fact-check the text. <strong>Fuzzy</strong>, post-hoc.</p>
      </div>
      <div class="ladder-arrow">&rarr;</div>
      <div class="ladder-rung r-mcp">
        <div class="ladder-n">Agent + Tools (MCP)</div>
        <p>Query the <strong>live system</strong> with a real tool. Authoritative &mdash; but
          <strong>unbound</strong>, and the result lives in the transcript.</p>
      </div>
      <div class="ladder-arrow">&rarr;</div>
      <div class="ladder-rung r-kontour">
        <div class="ladder-n">Kontour</div>
        <p>Tool result <strong>bound</strong> to the claim, <strong>gated</strong>, emitted as a
          <strong>portable, recomputable</strong> trust bundle.</p>
      </div>
    </div>
    <p class="ladder-foot">MCP is the stepping stone. The last step &mdash; <strong>binding + gate +
      portable proof</strong> &mdash; is the one only Kontour takes. We&rsquo;ll show exactly where
      each rung breaks.</p>
  </div>`);

// 3 — THE PRODUCT: an opening win. Kontour confidently answers a well-grounded question.
//     Establish "the product is a trustworthy answer" BEFORE any trap appears.
{
  const r = openWin;
  const s = r.scenario;
  const k = r.kontour;
  const value = k.outcome === "pass" ? k.value : 0;
  addStep("win-open", "step-center", `
    <div class="winopen-wrap">
      <div class="kicker mint">The product</div>
      <h2 class="winopen-h">First, what Kontour is <em>for</em>.</h2>
      <p class="winopen-lead">A user asks a question that <strong>can</strong> be answered &mdash;
        and the answer is grounded in a real record for the period asked.</p>
      <div class="winopen-card">
        <div class="winopen-q">${esc(s.query)}</div>
        <div class="winopen-answer">
          <div class="winopen-amount">${money(value)}</div>
          <div class="winopen-verified">&#10003; Grounded &amp; verified</div>
        </div>
        <div class="winopen-panel">
          <div class="panel-label">Real Surface trust panel &mdash; recomputable, auditable</div>
          <surface-trust-panel id="panel-${s.id}" expanded></surface-trust-panel>
        </div>
      </div>
      <p class="winopen-foot">This is the product: <strong>a trustworthy answer.</strong> Every
        binding matched &mdash; period, locator, source &mdash; so the gate <strong>passes</strong>
        and emits a portable trust bundle. Now watch what happens when the binding <em>doesn&rsquo;t</em> match.</p>
    </div>`);
}

// 4 — THE HERO PRECISION PAIR: the same Alpha data, asked two ways.
//     w1 (Q2, answerable) → Kontour ANSWERS, verified. s1 (Q3, trap) → Kontour REFUSES.
//     "Same data — it knows the difference."

// (4a) Hero win — question
addStep("w1-question", "step-center", `
  <div class="q-wrap">
    <div class="kicker mint">The precision pair &middot; 1 of 2</div>
    <div class="q-label">A user asks</div>
    <p class="q-query">${esc(heroWin.scenario.query)}</p>
    <div class="q-frame">
      <span class="q-frame-on">This period exists.</span>
      Alpha&rsquo;s <strong>Q2-2025</strong> sales are on record. Does Kontour answer it?
    </div>
    <p class="q-predict">It should &mdash; if it&rsquo;s precise, not timid.</p>
  </div>`);

// (4b) Hero win — reveal (ANSWERS)
addStep("w1-reveal", "step-reveal", `
  <div class="reveal-head">
    <div class="kicker mint">${heroWin.scenario.id.toUpperCase()} &middot; ${esc(heroWin.scenario.title)}</div>
    <p class="reveal-query">${esc(heroWin.scenario.query)}</p>
    <p class="reveal-truth"><strong>Truth:</strong> ${esc(heroWin.scenario.correctAnswer)}</p>
  </div>
  <div class="lanes">
    ${rawLane(heroWin)}
    ${ragLane(heroWin)}
    ${kontourLane(heroWin)}
  </div>
  <p class="pair-bridge">Same account. Same <strong>$451,000</strong> on record. Now change just
    <em>one word</em> in the question &mdash; the period &mdash; from Q2 to Q3&hellip;</p>`);

// (4c) Hero trap — question (the s1 twin)
addStep("s1-question", "step-center", `
  <div class="q-wrap">
    <div class="kicker cobalt">The precision pair &middot; 2 of 2</div>
    <div class="q-label">Now the user asks</div>
    <p class="q-query">${esc(heroTrap.scenario.query)}</p>
    <div class="q-frame">
      <span class="q-frame-on">RAG + fact-check is on.</span>
      The retriever pulls the same Alpha sales doc. The fact-checker verifies $451,000 against it.
    </div>
    <p class="q-predict">Same data, one word changed. Does it catch the error?</p>
  </div>`);

// (4d) Hero trap — reveal (REFUSES)
addStep("s1-reveal", "step-reveal", `
  <div class="reveal-head">
    <div class="kicker cobalt">${heroTrap.scenario.id.toUpperCase()} &middot; ${esc(heroTrap.scenario.title)}</div>
    <p class="reveal-query">${esc(heroTrap.scenario.query)}</p>
    <p class="reveal-truth"><strong>Truth:</strong> ${esc(heroTrap.scenario.correctAnswer)}</p>
  </div>
  <div class="lanes lanes-4">
    ${rawLane(heroTrap)}
    ${ragLane(heroTrap)}
    ${mcpLane(heroTrap)}
    ${kontourLane(heroTrap)}
  </div>
  <p class="pair-bridge accent"><strong>Same data &mdash; it knows the difference.</strong> RAG
    said SUPPORTED and the MCP agent <em>queried the live system</em> &mdash; both handed back the
    wrong period off the same $451,000 record. Only Kontour bound the value to the period asked,
    gated it, and emitted a portable bundle. Kontour answered Q2 and refused Q3. That is precision,
    not timidity.</p>`);

// 5 — The remaining traps: "and it refuses rather than fake it."
remainingTraps.forEach((r, i) => {
  const s = r.scenario;
  const idx = i + 1;
  // (A) prediction beat — question only
  addStep(`${s.id}-question`, "step-center", `
    <div class="q-wrap">
      <div class="kicker cobalt">More traps &middot; ${idx} of ${remainingTraps.length} &middot; ${s.id.toUpperCase()}</div>
      <div class="q-label">A user asks</div>
      <p class="q-query">${esc(s.query)}</p>
      <div class="q-frame">
        <span class="q-frame-on">RAG + fact-check is on.</span>
        The retriever pulls the real source. The fact-checker verifies the number against it.
      </div>
      <p class="q-predict">Does it catch the error?</p>
    </div>`);
  // (B) reveal — three lanes, or four when the scenario carries an MCP lane.
  const hasMcp = Boolean(r.mcp);
  addStep(`${s.id}-reveal`, "step-reveal", `
    <div class="reveal-head">
      <div class="kicker cobalt">${s.id.toUpperCase()} &middot; ${esc(s.title)}</div>
      <p class="reveal-query">${esc(s.query)}</p>
      <p class="reveal-truth"><strong>Truth:</strong> ${esc(s.correctAnswer)}</p>
    </div>
    <div class="lanes ${hasMcp ? "lanes-4" : ""}">
      ${rawLane(r)}
      ${ragLane(r)}
      ${hasMcp ? mcpLane(r) : ""}
      ${kontourLane(r)}
    </div>`);
});

// 6 — OKF INTEROP: "and it's not just our data." Ground against a REAL Google OKF bundle.
//     Win (grounded against the real public source, provenance visible) + the freshness trap.
const okfWin = byId(OKF_WIN.id);
const okfTrap = byId(OKF_TRAP.id);
const okfMeta = OKF_WIN.okf!;
const shortHash = (h: string) => `${h.slice(0, 12)}…${h.slice(-8)}`;

// (6a) OKF framing + the win — grounded against Google's real public OKF file
{
  const k = okfWin.kontour;
  const value = k.outcome === "pass" ? k.value : 0;
  addStep("okf-win", "step-center", `
    <div class="okf-wrap">
      <div class="kicker mint">Not just our data &middot; real Google source</div>
      <h2 class="okf-h">&ldquo;You wrote the data.&rdquo; So here&rsquo;s <em>Google&rsquo;s.</em></h2>
      <p class="okf-lead">This is a real <strong>Open Knowledge Format</strong> concept file &mdash;
        Google Cloud&rsquo;s vendor-neutral spec &mdash; vendored <strong>byte-for-byte</strong> from
        their public repo. Kontour grounds an answer against it, and adds the
        <strong>content-hash + freshness</strong> OKF deliberately has no field for.</p>
      <div class="okf-card">
        <div class="okf-q">${esc(okfWin.scenario.query)}</div>
        <div class="okf-answer">
          <div class="okf-amount">${value}</div>
          <div class="okf-amount-unit">schema fields</div>
          <div class="okf-verified">&#10003; Grounded against the real OKF source</div>
        </div>
        <div class="okf-prov">
          <div class="okf-prov-row"><span class="okf-prov-k">OKF resource &rarr; sourceLocator</span>
            <span class="okf-prov-v">${esc(okfMeta.resourceUri)}</span></div>
          <div class="okf-prov-row"><span class="okf-prov-k">OKF timestamp &rarr; freshness anchor</span>
            <span class="okf-prov-v">${esc(okfMeta.okfTimestamp)}</span></div>
          <div class="okf-prov-row added"><span class="okf-prov-k">+ Hachure integrity-ref (sha256)</span>
            <span class="okf-prov-v mono">${esc(shortHash(okfMeta.integrityRef))}</span></div>
          <div class="okf-prov-row src"><span class="okf-prov-k">Provenance &mdash; diff it yourself</span>
            <span class="okf-prov-v small">github.com/GoogleCloudPlatform/knowledge-catalog @
              <code>${esc(okfMeta.repoCommitSha.slice(0, 10))}</code></span></div>
        </div>
        <div class="okf-panel">
          <div class="panel-label">Real Surface trust panel &mdash; grounded at the OKF resource</div>
          <surface-trust-panel id="panel-${okfWin.scenario.id}" expanded></surface-trust-panel>
        </div>
      </div>
      <p class="okf-foot">OKF tells the agent <em>what it knows</em>;
        Hachure proves <strong>what the answer stood on</strong> &mdash; recomputable against Google&rsquo;s
        own bytes by a skeptic who doesn&rsquo;t trust us.</p>
    </div>`);
}

// (6b) OKF freshness trap — the gap OKF itself cannot cover
addStep("okf-trap-reveal", "step-reveal", `
  <div class="reveal-head">
    <div class="kicker cobalt">${okfTrap.scenario.id.toUpperCase()} &middot; ${esc(okfTrap.scenario.title)}</div>
    <p class="reveal-query">${esc(okfTrap.scenario.query)}</p>
    <p class="reveal-truth"><strong>Truth:</strong> ${esc(okfTrap.scenario.correctAnswer)}</p>
  </div>
  <div class="lanes lanes-4">
    ${rawLane(okfTrap)}
    ${ragLane(okfTrap)}
    ${mcpLane(okfTrap)}
    ${kontourLane(okfTrap)}
  </div>
  <p class="pair-bridge accent">OKF&rsquo;s only temporal field is <code>timestamp</code> &mdash; last
    <em>changed</em>, not a content hash. When the source drifts past the grounding snapshot, an
    OKF-trusting consumer can&rsquo;t notice and ships the stale fact. <strong>Hachure&rsquo;s
    integrity-ref does notice &mdash; and refuses.</strong></p>`);

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

// Close (dark) — PRECISION scoreboard from the harness (discrimination, not refusal count)
addStep("close", "step-dark step-center", `
  <div class="close-wrap">
    <div class="kicker">The proof &mdash; precision</div>
    <div class="precision-board">
      <div class="pb-row pb-answerable">
        <div class="pb-row-head">
          <span class="pb-row-title">Answerable questions</span>
          <span class="pb-row-sub">both fine on the easy ones</span>
        </div>
        <div class="pb-cells">
          <div class="pb-cell kontour">
            <span class="pb-num">${kontourAnsweredWins} / ${nWins}</span>
            <span class="pb-lbl">Kontour <strong>answered correctly</strong></span>
          </div>
          <div class="pb-cell rag">
            <span class="pb-num">${ragAnsweredWins} / ${nWins}</span>
            <span class="pb-lbl">RAG + fact-check <strong>answered correctly</strong></span>
          </div>
        </div>
      </div>
      <div class="pb-row pb-trap">
        <div class="pb-row-head">
          <span class="pb-row-title">Trap questions</span>
          <span class="pb-row-sub">only Kontour caught them</span>
        </div>
        <div class="pb-cells">
          <div class="pb-cell kontour">
            <span class="pb-num">${kontourRefusedTraps} / ${nTraps}</span>
            <span class="pb-lbl">Kontour <strong>refused</strong> rather than fake it</span>
          </div>
          <div class="pb-cell rag bad">
            <span class="pb-num">${ragShippedTraps} / ${nTraps}</span>
            <span class="pb-lbl">RAG + fact-check <strong>shipped wrong</strong></span>
          </div>
        </div>
      </div>
    </div>
    <p class="close-mcp">Even <strong>Agent + Tools (MCP)</strong> &mdash; the strongest, most authoritative baseline &mdash; shipped wrong on every trap it faced (${mcpShippedTraps}/${nTrapsMcp}): a real, live tool call with <strong>no binding, no gate, no portable proof</strong>.</p>
    <p class="close-line"><strong>Answered exactly when it could. Refused exactly when it couldn&rsquo;t.
      RAG + fact-check couldn&rsquo;t tell the two apart.</strong></p>
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
    .lanes.lanes-4 { grid-template-columns: 0.74fr 1fr 1fr 1.08fr; gap: 14px; }
    @media (max-width: 1100px) { .lanes, .lanes.lanes-4 { grid-template-columns: 1fr; } }
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
    .lane-badge.mcp { background: rgba(31,111,136,0.16); color: var(--cobalt); }
    .lane-mcp { border-color: rgba(31,111,136,0.4); }
    .lane-sub { font-size: 11px; color: var(--faint); font-family: var(--mono); }
    .lane-body { padding: 18px 16px; display: flex; flex-direction: column; gap: 14px; flex: 1;
      text-align: left; }
    .amount { font-family: var(--serif); font-size: 34px; font-weight: 600; letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums; line-height: 1; }
    .amount.neutral { color: var(--ink); }
    .amount.mint { color: var(--mint); }
    .answer-verified { font-family: var(--mono); font-size: 12.5px; font-weight: 600;
      color: var(--mint); background: rgba(20,163,122,0.10); border: 1px solid rgba(20,163,122,0.4);
      border-radius: 6px; padding: 8px 11px; }
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

    /* ── Agent + Tools (MCP) lane ──────────────────────────────────── */
    .mcp-call { font-family: var(--mono); font-size: 11px; color: var(--muted);
      display: flex; flex-direction: column; gap: 3px; }
    .mcp-call-k { font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--faint); font-weight: 600; }
    .mcp-call code { background: rgba(31,111,136,0.10); color: var(--cobalt); padding: 4px 7px;
      border-radius: 4px; word-break: break-all; }
    .mcp-verdict { border-radius: 8px; padding: 11px 12px; display: flex; flex-direction: column;
      gap: 5px; }
    .mcp-verdict.mcp-bad { background: rgba(176,48,48,0.08); border: 1.5px solid rgba(176,48,48,0.45); }
    .mcp-verdict.mcp-soft { background: rgba(31,111,136,0.07); border: 1.5px solid rgba(31,111,136,0.35); }
    .mcp-gap { font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; }
    .mcp-bad .mcp-gap { color: var(--red); }
    .mcp-soft .mcp-gap { color: var(--cobalt); }
    .mcp-vtext { font-size: 12.5px; font-weight: 600; }
    .mcp-bad .mcp-vtext { color: var(--red); }
    .mcp-soft .mcp-vtext { color: var(--cobalt); }
    .mcp-ship { font-family: var(--mono); font-size: 11.5px; font-weight: 600; }
    .mcp-ship.bad { color: var(--red); }
    .mcp-ship.soft { color: var(--muted); }
    .why.mcp-why { background: rgba(31,111,136,0.06); border-color: rgba(31,111,136,0.22); }
    .why.mcp-why .why-label { color: var(--cobalt); }

    /* ── The ladder beat ──────────────────────────────────────────── */
    .ladder-wrap { max-width: 1100px; margin: 0 auto; }
    .ladder-h { font-family: var(--serif); font-weight: 600; font-size: clamp(30px, 4.2vw, 50px);
      letter-spacing: -0.015em; line-height: 1.06; }
    .ladder-lead { font-size: clamp(16px, 1.9vw, 21px); color: var(--muted); max-width: 64ch;
      margin: 16px auto 30px; }
    .ladder-lead strong { color: var(--ink); }
    .ladder { display: flex; align-items: stretch; justify-content: center; gap: 10px;
      margin: 0 auto 28px; flex-wrap: nowrap; }
    .ladder-rung { flex: 1; background: var(--card); border: 1px solid var(--line);
      border-radius: 12px; padding: 18px 16px; text-align: left; }
    .ladder-rung.r-raw { border-top: 3px solid var(--faint); }
    .ladder-rung.r-rag { border-top: 3px solid var(--amber); }
    .ladder-rung.r-mcp { border-top: 3px solid var(--cobalt); }
    .ladder-rung.r-kontour { border-top: 3px solid var(--mint); background: rgba(20,163,122,0.05); }
    .ladder-n { font-family: var(--serif); font-weight: 600; font-size: 19px; margin-bottom: 8px; }
    .r-mcp .ladder-n { color: var(--cobalt); } .r-kontour .ladder-n { color: var(--mint); }
    .ladder-rung p { font-size: 13px; color: var(--muted); line-height: 1.5; }
    .ladder-rung strong { color: var(--ink); }
    .ladder-arrow { align-self: center; font-size: 22px; color: var(--faint); flex-shrink: 0; }
    .ladder-foot { font-size: clamp(15px, 1.8vw, 19px); color: var(--muted); max-width: 70ch;
      margin: 0 auto; line-height: 1.5; }
    .ladder-foot strong { color: var(--ink); }
    @media (max-width: 1000px) { .ladder { flex-wrap: wrap; } .ladder-arrow { display: none; } }

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
    .close-mcp { font-size: clamp(13px, 1.5vw, 16px); color: rgba(245,244,239,0.6); max-width: 58ch;
      margin: 0 auto 18px; }
    .close-mcp strong { color: rgba(245,244,239,0.9); }
    .close-tag { font-family: var(--serif); font-weight: 600; font-style: italic;
      font-size: clamp(34px, 5vw, 62px); color: var(--mint); letter-spacing: -0.01em; }

    /* ── Opening win (the product) ────────────────────────────────── */
    .winopen-wrap { max-width: 920px; margin: 0 auto; }
    .winopen-h { font-family: var(--serif); font-weight: 600; font-size: clamp(32px, 4.4vw, 54px);
      letter-spacing: -0.015em; line-height: 1.06; }
    .winopen-h em { color: var(--mint); font-style: italic; }
    .winopen-lead { font-size: clamp(16px, 1.9vw, 21px); color: var(--muted); max-width: 56ch;
      margin: 16px auto 26px; }
    .winopen-lead strong { color: var(--ink); }
    .winopen-card { background: var(--card); border: 1px solid var(--line);
      border-top: 3px solid var(--mint); border-radius: 12px; padding: 26px 28px; text-align: left;
      max-width: 760px; margin: 0 auto; }
    .winopen-q { font-family: var(--serif); font-weight: 600; font-size: clamp(20px, 2.4vw, 28px);
      letter-spacing: -0.01em; }
    .winopen-q::before { content: "\\201C"; } .winopen-q::after { content: "\\201D"; }
    .winopen-answer { display: flex; align-items: baseline; gap: 18px; margin: 18px 0 20px;
      flex-wrap: wrap; }
    .winopen-amount { font-family: var(--serif); font-weight: 700; font-size: clamp(40px, 5vw, 60px);
      color: var(--mint); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1; }
    .winopen-verified { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--mint);
      background: rgba(20,163,122,0.10); border: 1px solid rgba(20,163,122,0.4); border-radius: 6px;
      padding: 7px 12px; }
    .winopen-panel .panel-label { font-size: 10.5px; color: var(--faint); letter-spacing: 0.04em;
      text-transform: uppercase; font-weight: 600; margin-bottom: 8px; padding-bottom: 6px;
      border-bottom: 1px solid var(--line); }
    .winopen-foot { font-size: clamp(15px, 1.8vw, 19px); color: var(--muted); max-width: 64ch;
      margin: 26px auto 0; line-height: 1.5; }
    .winopen-foot strong { color: var(--ink); } .winopen-foot em { color: var(--cobalt); font-style: italic; }

    /* ── OKF interop (real Google source) ─────────────────────────── */
    .okf-wrap { max-width: 940px; margin: 0 auto; }
    .okf-h { font-family: var(--serif); font-weight: 600; font-size: clamp(30px, 4.2vw, 52px);
      letter-spacing: -0.015em; line-height: 1.06; }
    .okf-h em { color: var(--mint); font-style: italic; }
    .okf-lead { font-size: clamp(16px, 1.9vw, 20px); color: var(--muted); max-width: 62ch;
      margin: 16px auto 24px; }
    .okf-lead strong { color: var(--ink); }
    .okf-card { background: var(--card); border: 1px solid var(--line);
      border-top: 3px solid var(--mint); border-radius: 12px; padding: 24px 26px; text-align: left;
      max-width: 800px; margin: 0 auto; }
    .okf-q { font-family: var(--serif); font-weight: 600; font-size: clamp(18px, 2.1vw, 24px);
      letter-spacing: -0.01em; line-height: 1.25; }
    .okf-q::before { content: "\\201C"; } .okf-q::after { content: "\\201D"; }
    .okf-answer { display: flex; align-items: baseline; gap: 14px; margin: 16px 0 18px;
      flex-wrap: wrap; }
    .okf-amount { font-family: var(--serif); font-weight: 700; font-size: clamp(40px, 5vw, 58px);
      color: var(--mint); letter-spacing: -0.02em; line-height: 1; }
    .okf-amount-unit { font-family: var(--mono); font-size: 13px; color: var(--faint);
      align-self: flex-end; }
    .okf-verified { font-family: var(--mono); font-size: 12.5px; font-weight: 600; color: var(--mint);
      background: rgba(20,163,122,0.10); border: 1px solid rgba(20,163,122,0.4); border-radius: 6px;
      padding: 7px 11px; margin-left: auto; }
    .okf-prov { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 18px; }
    .okf-prov-row { display: flex; justify-content: space-between; gap: 16px; padding: 9px 13px;
      font-size: 12.5px; border-bottom: 1px solid var(--line); }
    .okf-prov-row:last-child { border-bottom: none; }
    .okf-prov-row.added { background: rgba(20,163,122,0.07); }
    .okf-prov-row.src { background: rgba(31,111,136,0.05); }
    .okf-prov-k { font-family: var(--mono); font-size: 11px; letter-spacing: 0.02em; color: var(--muted);
      flex-shrink: 0; }
    .okf-prov-row.added .okf-prov-k { color: var(--mint); font-weight: 600; }
    .okf-prov-v { text-align: right; word-break: break-all; color: var(--ink); }
    .okf-prov-v.mono { font-family: var(--mono); color: var(--mint); }
    .okf-prov-v.small { font-size: 11.5px; color: var(--muted); }
    .okf-prov-v code { font-family: var(--mono); font-size: 0.9em; background: rgba(31,111,136,0.12);
      color: var(--cobalt); padding: 1px 4px; border-radius: 3px; }
    .okf-panel .panel-label { font-size: 10.5px; color: var(--faint); letter-spacing: 0.04em;
      text-transform: uppercase; font-weight: 600; margin-bottom: 8px; padding-bottom: 6px;
      border-bottom: 1px solid var(--line); }
    .okf-foot { font-size: clamp(15px, 1.8vw, 19px); color: var(--muted); max-width: 64ch;
      margin: 24px auto 0; line-height: 1.5; }
    .okf-foot strong { color: var(--ink); } .okf-foot em { color: var(--cobalt); font-style: italic; }

    /* ── Precision-pair bridge copy (under hero reveals) ───────────── */
    .pair-bridge { font-size: clamp(15px, 1.8vw, 20px); color: var(--muted); text-align: center;
      max-width: 76ch; margin: 22px auto 0; line-height: 1.5; }
    .pair-bridge strong { color: var(--ink); } .pair-bridge em { color: var(--cobalt); font-style: italic; }
    .pair-bridge.accent { color: var(--ink); }
    .pair-bridge.accent strong { color: var(--mint); }

    /* ── Precision scoreboard (close) ─────────────────────────────── */
    .precision-board { display: flex; flex-direction: column; gap: 18px; max-width: 760px;
      margin: 18px auto 30px; }
    .pb-row { background: rgba(245,244,239,0.05); border: 1px solid rgba(245,244,239,0.16);
      border-radius: 12px; padding: 18px 22px; text-align: left; }
    .pb-trap { border-color: rgba(245,244,239,0.22); }
    .pb-row-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px;
      flex-wrap: wrap; }
    .pb-row-title { font-family: var(--serif); font-weight: 600; font-size: clamp(19px, 2.2vw, 26px);
      color: var(--paper); }
    .pb-row-sub { font-family: var(--mono); font-size: 12px; letter-spacing: 0.04em;
      color: rgba(245,244,239,0.55); }
    .pb-cells { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .pb-cell { display: flex; align-items: baseline; gap: 12px; }
    .pb-num { font-family: var(--serif); font-weight: 700; font-size: clamp(30px, 4vw, 46px);
      line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .pb-cell.kontour .pb-num { color: var(--mint); }
    .pb-cell.rag .pb-num { color: rgba(245,244,239,0.78); }
    .pb-cell.rag.bad .pb-num { color: var(--amber); }
    .pb-lbl { font-size: 13px; color: rgba(245,244,239,0.72); line-height: 1.35; }
    .pb-lbl strong { color: var(--paper); font-weight: 600; }
    @media (max-width: 720px) { .pb-cells { grid-template-columns: 1fr; } }

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
console.log(
  `\n  Precision scoreboard (from harness):\n` +
    `    Answerable (${nWins}): Kontour answered ${kontourAnsweredWins}/${nWins} · RAG answered ${ragAnsweredWins}/${nWins}\n` +
    `    Traps (${nTraps}):      Kontour refused ${kontourRefusedTraps}/${nTraps} · RAG shipped wrong ${ragShippedTraps}/${nTraps}`
);
console.log(`\nOpen: file://${join(outDir, "present.html")}\n`);
