#!/usr/bin/env -S node --import tsx
/**
 * Builds the standalone demo HTML page.
 * Copies surface-trust-panel.js to dist/ and generates the HTML with
 * real grounding data baked in.
 *
 * Usage: node --import tsx demo/grounded-answer/build-page.ts
 *        or: npm run demo:grounded:build
 *
 * Output: demo/grounded-answer/dist/index.html (serve the dist/ directory)
 *         demo/grounded-answer/dist/surface-trust-panel.js (web component)
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { answer, rawAnswer } from "./conductor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const outDir = join(__dirname, "dist");

// Generate real grounding data using the real conductor + lab pipeline
const queryAlpha = { accountId: "account-alpha", period: "Q3-2025" };
const queryOmega = { accountId: "account-omega", period: "Q3-2025" };

const conductedAlpha = answer(queryAlpha);
const conductedOmega = answer(queryOmega);
const rawAlpha = rawAnswer(queryAlpha);
const rawOmega = rawAnswer(queryOmega);

// Copy the surface-trust-panel web component to dist/
mkdirSync(outDir, { recursive: true });
copyFileSync(
  join(root, "console-ui", "public", "surface-trust-panel.js"),
  join(outDir, "surface-trust-panel.js")
);

// Serialize the trust reports for embedding
const alphaReport = conductedAlpha.kind === "grounded"
  ? JSON.stringify(conductedAlpha.report)
  : null;

function formatAmount(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kontour · Structural Grounding Demo</title>
  <!-- surface-trust-panel web component — loaded as external ES module -->
  <script type="module" src="./surface-trust-panel.js"><\/script>
  <style>
    /* ── Kontour design tokens (inline) ────────────────────────────────────── */
    :root {
      color-scheme: dark;
      --k-bg: #0d1410;
      --k-panel: #141a17;
      --k-panel-raised: #1b2320;
      --k-line: rgba(36,68,52,0.22);
      --k-line-strong: rgba(36,68,52,0.44);
      --k-text: #d4e8dc;
      --k-text-muted: #8cad9c;
      --k-text-faint: #4a6456;
      --k-positive: #34c97e;
      --k-caution: #f5c542;
      --k-negative: #e05c5c;
      --k-brand: #2d9c5c;
      --k-active: #3dd68c;
      --k-shadow: 0 2px 12px rgba(0,0,0,0.4);
      --k-radius-sm: 6px;
      --k-font-ui: "Inter", system-ui, -apple-system, sans-serif;
    }
    [data-theme="light"] {
      color-scheme: light;
      --k-bg: #f4f8f6;
      --k-panel: #fff;
      --k-panel-raised: #f0f5f2;
      --k-line: rgba(36,68,52,0.12);
      --k-line-strong: rgba(36,68,52,0.24);
      --k-text: #1a2e22;
      --k-text-muted: #4a6456;
      --k-text-faint: #8cad9c;
      --k-positive: #1e8c52;
      --k-caution: #b58c00;
      --k-negative: #b03030;
      --k-brand: #1a7a42;
      --k-active: #1a9c52;
      --k-shadow: 0 2px 8px rgba(0,0,0,0.12);
    }

    /* ── Layout ─────────────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--k-bg);
      color: var(--k-text);
      font-family: var(--k-font-ui);
      font-size: 14px;
      line-height: 1.55;
      min-height: 100vh;
      padding: 0 0 48px;
    }

    /* ── Header ─────────────────────────────────────────────────────────────── */
    .demo-header {
      background: var(--k-panel);
      border-bottom: 1px solid var(--k-line-strong);
      padding: 20px 32px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .demo-header-logo {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: var(--k-brand);
      text-transform: uppercase;
    }
    .demo-header-title {
      font-size: 17px;
      font-weight: 600;
      color: var(--k-text);
    }
    .demo-header-subtitle {
      font-size: 12px;
      color: var(--k-text-muted);
      margin-left: auto;
      text-align: right;
    }

    /* ── Thesis strip ────────────────────────────────────────────────────────── */
    .thesis-strip {
      background: color-mix(in srgb, var(--k-brand) 10%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--k-brand) 25%, transparent);
      padding: 12px 32px;
      font-size: 13px;
      color: var(--k-text-muted);
    }
    .thesis-strip strong { color: var(--k-active); }
    .thesis-strip code {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 11px;
      color: var(--k-active);
      background: color-mix(in srgb, var(--k-active) 10%, transparent);
      padding: 1px 4px;
      border-radius: 3px;
    }

    /* ── Query section ───────────────────────────────────────────────────────── */
    .query-section {
      padding: 32px 32px 0;
    }
    .query-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--k-text-faint);
      margin-bottom: 6px;
    }
    .query-text {
      font-size: 20px;
      font-weight: 600;
      color: var(--k-text);
      margin-bottom: 24px;
    }

    /* ── Comparison grid ─────────────────────────────────────────────────────── */
    .comparison-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      padding: 0 32px 32px;
    }

    /* ── Path card ───────────────────────────────────────────────────────────── */
    .path-card {
      background: var(--k-panel);
      border: 1px solid var(--k-line);
      border-radius: var(--k-radius-sm);
      overflow: hidden;
    }
    .path-card-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--k-line);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .path-badge {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 3px;
    }
    .path-badge.raw {
      background: color-mix(in srgb, var(--k-caution) 15%, transparent);
      color: var(--k-caution);
      border: 1px solid color-mix(in srgb, var(--k-caution) 30%, transparent);
    }
    .path-badge.grounded {
      background: color-mix(in srgb, var(--k-positive) 15%, transparent);
      color: var(--k-positive);
      border: 1px solid color-mix(in srgb, var(--k-positive) 30%, transparent);
    }
    .path-badge.refused {
      background: color-mix(in srgb, var(--k-negative) 15%, transparent);
      color: var(--k-negative);
      border: 1px solid color-mix(in srgb, var(--k-negative) 30%, transparent);
    }
    .path-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--k-text);
    }
    .path-desc {
      font-size: 11px;
      color: var(--k-text-faint);
      margin-left: auto;
    }
    .path-card-body { padding: 16px; }

    /* ── Answer display ──────────────────────────────────────────────────────── */
    .answer-amount {
      font-size: 36px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      margin-bottom: 10px;
      letter-spacing: -0.5px;
    }
    .answer-amount.grounded { color: var(--k-positive); }
    .answer-amount.raw { color: var(--k-text); }

    .provenance-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 10px;
    }
    .provenance-row.none {
      background: color-mix(in srgb, var(--k-caution) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--k-caution) 20%, transparent);
      color: var(--k-caution);
    }
    .provenance-row.present {
      background: color-mix(in srgb, var(--k-positive) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--k-positive) 20%, transparent);
      color: var(--k-positive);
    }
    .confabulation-warn {
      margin-top: 10px;
      padding: 10px 12px;
      background: color-mix(in srgb, var(--k-caution) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--k-caution) 25%, transparent);
      border-radius: 4px;
      font-size: 12px;
      color: var(--k-caution);
      line-height: 1.5;
    }

    /* ── Refusal card ────────────────────────────────────────────────────────── */
    .refusal-card {
      background: color-mix(in srgb, var(--k-negative) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--k-negative) 25%, transparent);
      border-radius: 4px;
      padding: 16px;
    }
    .refusal-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--k-negative);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .refusal-message {
      font-size: 13px;
      color: var(--k-text-muted);
      font-style: italic;
      padding: 8px 10px;
      background: color-mix(in srgb, var(--k-negative) 6%, transparent);
      border-radius: 4px;
      border-left: 2px solid var(--k-negative);
      margin-bottom: 12px;
    }
    .refusal-structural {
      font-size: 12px;
      color: var(--k-text-faint);
      padding-top: 10px;
      border-top: 1px solid color-mix(in srgb, var(--k-negative) 20%, transparent);
      line-height: 1.65;
    }
    .refusal-structural strong { color: var(--k-text-muted); }
    .refusal-structural code {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 11px;
      color: var(--k-active);
      background: color-mix(in srgb, var(--k-active) 10%, transparent);
      padding: 1px 4px;
      border-radius: 3px;
    }

    /* ── Trust panel wrapper ─────────────────────────────────────────────────── */
    .trust-panel-wrapper {
      margin-top: 12px;
    }
    .trust-panel-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--k-text-faint);
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--k-line);
    }

    /* ── Divider between queries ─────────────────────────────────────────────── */
    .query-divider {
      border: none;
      border-top: 1px solid var(--k-line-strong);
      margin: 0 32px 32px;
    }

    /* ── Architecture note ───────────────────────────────────────────────────── */
    .arch-note {
      margin: 0 32px;
      padding: 16px 20px;
      background: var(--k-panel);
      border: 1px solid var(--k-line);
      border-radius: var(--k-radius-sm);
      font-size: 12px;
      color: var(--k-text-muted);
      line-height: 1.65;
    }
    .arch-note h3 {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--k-text-faint);
      margin-bottom: 10px;
    }
    .arch-note p + p { margin-top: 10px; }
    .arch-note code {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 11px;
      color: var(--k-active);
      background: color-mix(in srgb, var(--k-active) 10%, transparent);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .arch-note strong { color: var(--k-text); }

    /* ── Theme toggle ────────────────────────────────────────────────────────── */
    .theme-toggle {
      background: var(--k-panel-raised);
      border: 1px solid var(--k-line);
      border-radius: var(--k-radius-sm);
      color: var(--k-text-muted);
      cursor: pointer;
      font-size: 12px;
      padding: 4px 10px;
      margin-top: 4px;
    }
    .theme-toggle:hover { color: var(--k-text); border-color: var(--k-line-strong); }

    /* ── Source badge ────────────────────────────────────────────────────────── */
    .source-ref {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 10px;
      color: var(--k-active);
      background: color-mix(in srgb, var(--k-active) 10%, transparent);
      padding: 1px 5px;
      border-radius: 3px;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <header class="demo-header">
    <span class="demo-header-logo">Kontour</span>
    <span class="demo-header-title">Structural Grounding Demo</span>
    <div class="demo-header-subtitle">
      <div>Query-driven grounding refuses instead of confabulating</div>
      <button class="theme-toggle" onclick="toggleTheme()">Toggle theme</button>
    </div>
  </header>

  <div class="thesis-strip">
    <strong>Thesis:</strong> The conducted path uses a real grounding loop
    (conductor &rarr; lab &rarr; <code>buildSurveyTrustBundle()</code> &rarr; <code>buildTrustReport()</code>).
    When the source isn&rsquo;t there, it <strong>structurally refuses</strong> &mdash;
    the code path literally cannot emit a verified answer without a grounding record.
    The raw path returns a number regardless.
  </div>

  <!-- ── Query 1: Alpha Corp Q3-2025 (DATA EXISTS) ─────────────────────────── -->
  <div class="query-section">
    <div class="query-label">Query 1 of 2 &mdash; source exists</div>
    <div class="query-text">What are Alpha Corp&rsquo;s Q3-2025 sales?</div>
  </div>

  <div class="comparison-grid">
    <!-- LEFT: Raw / ungrounded -->
    <div class="path-card">
      <div class="path-card-header">
        <span class="path-badge raw">Raw</span>
        <span class="path-title">Ungrounded Path</span>
        <span class="path-desc">No grounding loop &bull; No provenance</span>
      </div>
      <div class="path-card-body">
        <div class="answer-amount raw">${formatAmount(rawAlpha.amount)}</div>
        <div class="provenance-row none">
          &#9888; No provenance &mdash; retrieve-then-hope
        </div>
        <div style="font-size:12px;color:var(--k-text-faint)">
          This query has a backing record, but the raw path has no grounding
          loop and no structural gate &mdash; it returns a number regardless of
          whether a source exists.
        </div>
      </div>
    </div>

    <!-- RIGHT: Conducted / grounded -->
    <div class="path-card">
      <div class="path-card-header">
        <span class="path-badge grounded">Grounded</span>
        <span class="path-title">Conducted Path</span>
        <span class="path-desc">Real @kontourai/survey bundle &bull; Chain of custody</span>
      </div>
      <div class="path-card-body">
        ${conductedAlpha.kind === "grounded" ? `
        <div class="answer-amount grounded">${formatAmount(conductedAlpha.amount)}</div>
        <div class="provenance-row present">
          &#10003; Claim status: <strong>verified</strong>
          &bull; <span class="source-ref">internal://sales-system/docs/sales-doc-2025-Q3-alpha</span>
        </div>
        <div class="trust-panel-wrapper">
          <div class="trust-panel-label">Surface Trust Panel &mdash; real chain of custody</div>
          <surface-trust-panel id="trust-panel-alpha"></surface-trust-panel>
        </div>
        ` : ""}
      </div>
    </div>
  </div>

  <hr class="query-divider">

  <!-- ── Query 2: Omega Ltd Q3-2025 (NO DATA — STRUCTURAL REFUSAL) ─────────── -->
  <div class="query-section">
    <div class="query-label">Query 2 of 2 &mdash; no source (the key proof)</div>
    <div class="query-text">What are Omega Ltd&rsquo;s Q3-2025 sales?</div>
  </div>

  <div class="comparison-grid">
    <!-- LEFT: Raw / ungrounded — RETURNS A NUMBER (the problem) -->
    <div class="path-card">
      <div class="path-card-header">
        <span class="path-badge raw">Raw</span>
        <span class="path-title">Ungrounded Path</span>
        <span class="path-desc">No grounding loop &bull; No provenance</span>
      </div>
      <div class="path-card-body">
        <div class="answer-amount raw">${formatAmount(rawOmega.amount)}</div>
        <div class="provenance-row none">
          &#9888; No provenance &mdash; no source exists
        </div>
        <div class="confabulation-warn">
          &#9889; This number has <strong>NO backing record</strong>. The raw path
          returned it anyway &mdash; no structural gate, no refusal mechanism.
          This is the confabulation risk: a confident number with no chain of custody.
        </div>
      </div>
    </div>

    <!-- RIGHT: Conducted — STRUCTURAL REFUSAL (the proof) -->
    <div class="path-card">
      <div class="path-card-header">
        <span class="path-badge refused">Refused</span>
        <span class="path-title">Conducted Path</span>
        <span class="path-desc">Structural refusal &mdash; no fabrication</span>
      </div>
      <div class="path-card-body">
        ${conductedOmega.kind === "refused" ? `
        <div class="refusal-card">
          <div class="refusal-title">&#8856; Structural Refusal</div>
          <div class="refusal-message">&ldquo;${conductedOmega.reason}&rdquo;</div>
          <div class="refusal-structural">
            <strong>Why structural?</strong>
            The conductor calls <code>groundClaim(claimRequest, record)</code>.
            When <code>record</code> is <code>undefined</code> (no source found),
            <code>groundClaim</code> returns <code>undefined</code>.
            The conductor gates on this: it returns a <code>Refusal</code> &mdash;
            the TypeScript discriminated union <code>GroundedAnswer | Refusal</code>
            makes it impossible to access <code>.bundle</code> or <code>.amount</code>
            without first checking <code>.kind === &ldquo;grounded&rdquo;</code>.
            <br><br>
            Not a heuristic. Not a confidence threshold. A deterministic gate:
            no grounding record &rarr; no <code>GroundedAnswer</code>.
          </div>
        </div>
        ` : ""}
      </div>
    </div>
  </div>

  <hr class="query-divider">

  <!-- Architecture note -->
  <div class="arch-note">
    <h3>Architecture &mdash; what is real vs mocked</h3>
    <p>
      <strong>Mocked (the sales system):</strong> an in-memory dataset of a few accounts with Q3 records.
      <code>retrieveSalesRecord(accountId, period)</code> does a simple array lookup.
      The absence of Omega Ltd Q3-2025 data is intentional &mdash; it drives the structural refusal.
    </p>
    <p>
      <strong>Real (the grounding):</strong> the lab calls the real <code>buildSurveyTrustBundle(surveyInput)</code>
      from <code>@kontourai/survey</code> &mdash; not a stub. That function asserts producer discipline:
      a claim cannot be &ldquo;verified&rdquo; without a review outcome with an <code>actor</code> and <code>reviewedAt</code>.
      Then <code>buildTrustReport(bundle)</code> from <code>@kontourai/surface</code> derives the TrustReport.
      The chain of custody in the trust panel above is the real output of those real calls.
    </p>
    <p>
      <strong>Structural gate:</strong> <code>answer(query)</code> returns
      <code>ConductedAnswer = GroundedAnswer | Refusal</code>.
      The <code>GroundedAnswer</code> branch is only reachable when <code>groundClaim()</code>
      returns a real <code>GroundingResult</code>. <code>groundClaim()</code> only returns a result
      when it receives a real <code>SalesRecord</code> and successfully calls
      <code>buildSurveyTrustBundle()</code>. TypeScript&rsquo;s exhaustive union check means
      no caller can access <code>.amount</code> or <code>.bundle</code> without first
      checking <code>.kind === &ldquo;grounded&rdquo;</code>.
    </p>
  </div>

  <!-- Feed the trust report to the panel after the component is defined -->
  <script type="module">
    const alphaReport = ${alphaReport ?? "null"};
    if (alphaReport) {
      // customElements.whenDefined ensures the element class is registered
      // before we set the property.
      customElements.whenDefined("surface-trust-panel").then(() => {
        const panel = document.getElementById("trust-panel-alpha");
        if (panel) panel.report = alphaReport;
      });
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute("data-theme");
      document.documentElement.setAttribute("data-theme", current === "light" ? "dark" : "light");
    }
    window.toggleTheme = toggleTheme;
  </script>
</body>
</html>`;

writeFileSync(join(outDir, "index.html"), html, "utf8");

console.log(`\nDemo page built:`);
console.log(`  HTML:  ${join(outDir, "index.html")}`);
console.log(`  Panel: ${join(outDir, "surface-trust-panel.js")}`);
console.log(`\nServe the dist/ directory to view (file:// also works):`);
console.log(`  npx serve ${outDir}`);
console.log(`  or: open file://${join(outDir, "index.html")}\n`);
