// <surface-trust-panel> — a dependency-free, read-only Trust Panel custom element.
//
// Renders a derived Kontour Surface TrustReport (the output of `surface report`
// or `buildTrustReport`) so a viewer can inspect claims, evidence, freshness,
// and transparency gaps before relying on them. The element never mutates or
// re-derives trust state; it only displays what the kernel derived.
//
// Information hierarchy (the result first, the proof on demand):
//   Always shown — the RESULT:
//     1. Verdict (status), the claim in plain language, and the value.
//     2. Trust signals — confidence basis (each chip explains its scale on hover).
//     3. Impact — consequence-if-wrong (a separate axis from credibility).
//     4. Transparency gaps (loud when present).
//   Expand "Show the evidence" — the WHY:
//     5. Grounded in (source, locator, integrity hash, verbatim excerpt).
//     6. Chain of custody (who verified it, when).
//     7. Technical details (IDs, surface, exact timestamps) — deeper still.
// Long values (hashes, URIs) truncate with the full value on hover. Set the
// `expanded` attribute to open the evidence section by default.
//
// The compiled dist/src/trust-panel/surface-trust-panel.js is a self-contained
// ES module with no imports — load it with <script type="module">. It reads
// untrusted pasted JSON, so the local shapes below stay loose and every
// rendered value is escaped.
//
// Usage:
//   <script type="module" src="surface-trust-panel.js"><\/script>
//   <surface-trust-panel></surface-trust-panel>
//   document.querySelector("surface-trust-panel").report = reportJson;
// or
//   <surface-trust-panel src="./report.json"></surface-trust-panel>
(() => {
    if (typeof customElements === "undefined" || customElements.get("surface-trust-panel"))
        return;
    const HACHURE_URL = "https://hachure.org";
    const STATUS_LABELS = {
        unknown: "No evidence",
        proposed: "Pending review",
        assumed: "Assumed",
        verified: "Verified",
        stale: "Needs refresh",
        disputed: "Disputed",
        superseded: "Superseded",
        rejected: "Rejected",
    };
    const STATUS_KIND = {
        verified: "positive",
        stale: "caution",
        disputed: "negative",
        rejected: "negative",
        superseded: "neutral",
        unknown: "neutral",
        proposed: "neutral",
        assumed: "caution",
    };
    // Ordered scales + per-level meaning for the qualitative confidence signals,
    // surfaced as hover tooltips so a rating like "moderate" is interpretable
    // (you can see the whole scale and what this level means). DRAFT definitions —
    // ratify in Surface docs; the panel reflects whatever the data declares.
    const SCALE_DEFS = {
        sourceQuality: {
            label: "Source quality",
            levels: ["unknown", "weak", "moderate", "strong"],
            defs: {
                unknown: "source not assessed",
                weak: "informal or secondary source with no authority",
                moderate: "a credible source with limited corroboration or authority",
                strong: "an authoritative system of record or primary source",
            },
        },
        evidenceStrength: {
            label: "Evidence strength",
            levels: ["none", "weak", "moderate", "strong"],
            defs: {
                none: "no supporting evidence",
                weak: "a single uncorroborated mention",
                moderate: "direct evidence from one reliable source",
                strong: "corroborated across independent sources, or cryptographically anchored",
            },
        },
        reviewerAuthority: {
            label: "Reviewer authority",
            levels: ["none", "operator", "domain_expert", "system"],
            defs: {
                none: "not reviewed by a person or authority",
                operator: "reviewed by an operator",
                domain_expert: "reviewed by a subject-matter expert",
                system: "automatically verified by a system rule",
            },
        },
    };
    const PANEL_CSS = `
    :host {
      display: block;
      font-family: var(--k-font-ui, system-ui, sans-serif);
      color: var(--k-text, #17201b);
      line-height: 1.5;
    }
    .panel {
      border: 1px solid var(--k-line, rgba(36, 68, 52, 0.16));
      border-radius: 16px;
      background: var(--k-panel, #fffcf1);
      padding: 1rem 1.1rem;
    }
    .panel-header { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; align-items: baseline; }
    .panel-title { margin: 0; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--k-text-muted, #657267); }
    .panel-meta { margin: 0; color: var(--k-text-muted, #657267); font-size: 0.74rem; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.45rem 0 0; }
    .chip {
      border: 1px solid var(--k-line, rgba(36, 68, 52, 0.16));
      border-radius: 999px;
      padding: 0.12rem 0.55rem;
      font-size: 0.74rem;
      font-weight: 600;
      background: var(--k-panel-raised, #fbf6e7);
      color: var(--k-text-muted, #657267);
    }
    .chip[data-kind="positive"] { color: var(--k-positive, #0f8f66); }
    .chip[data-kind="caution"] { color: var(--k-caution, #a86612); }
    .chip[data-kind="negative"] { color: var(--k-negative, #c24141); }
    .chip.tip { cursor: help; border-bottom-style: dashed; }

    .claim {
      border: 1px solid var(--k-line, rgba(36, 68, 52, 0.16));
      border-radius: 12px;
      margin-top: 0.7rem;
      background: var(--k-panel-raised, #fbf6e7);
      padding: 0.7rem 0.85rem;
    }
    /* 1 — verdict + the claim in plain language */
    .claim-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.6rem; }
    .badge {
      display: inline-flex; align-items: center; gap: 0.25rem;
      border-radius: 999px; padding: 0.18rem 0.6rem;
      font-size: 0.8rem; font-weight: 700; white-space: nowrap;
      border: 1px solid currentColor;
    }
    .badge[data-kind="positive"] { color: var(--k-positive, #0f8f66); background: var(--k-positive-soft, rgba(15,143,102,0.1)); }
    .badge[data-kind="caution"] { color: var(--k-caution, #a86612); background: var(--k-caution-soft, rgba(168,102,18,0.1)); }
    .badge[data-kind="negative"] { color: var(--k-negative, #c24141); background: var(--k-negative-soft, rgba(194,65,65,0.1)); }
    .badge[data-kind="neutral"] { color: var(--k-text-muted, #657267); background: var(--k-panel, #fffcf1); }
    .claim-subject { font-weight: 700; font-size: 0.95rem; overflow-wrap: anywhere; }
    .claim-period { margin-left: auto; color: var(--k-text-muted, #657267); font-size: 0.78rem; font-family: var(--k-font-mono, ui-monospace, monospace); }
    .claim-desc { margin: 0.45rem 0 0; font-size: 0.92rem; }
    .result { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.4rem; margin: 0.5rem 0 0.1rem; }
    .result-field { font-family: var(--k-font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace); font-size: 0.84rem; color: var(--k-text-muted, #657267); overflow-wrap: anywhere; }
    .result-eq { color: var(--k-text-muted, #657267); }
    .result-value { font-size: 1.4rem; font-weight: 700; overflow-wrap: anywhere; }

    /* 2/3 — confidence signals + impact */
    .signals { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.15rem; }
    .impact-row { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.55rem; }
    .impact-k { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--k-text-muted, #657267); font-weight: 700; border-bottom: 1px dotted var(--k-line, rgba(36, 68, 52, 0.4)); cursor: help; }

    /* 4 — transparency gaps (always visible) */
    .gap-label { color: var(--k-negative, #c24141); }
    .gaps { list-style: none; margin: 0.25rem 0 0; padding: 0; }
    .gap { font-size: 0.84rem; margin: 0.25rem 0; color: var(--k-negative, #c24141); overflow-wrap: anywhere; }
    .gap[data-severity="low"], .gap[data-severity="medium"] { color: var(--k-caution, #a86612); }

    .section-label { margin: 0.7rem 0 0.3rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--k-text-muted, #657267); font-weight: 700; }

    /* 5/6 — the evidence, collapsed by default */
    .evidence { margin-top: 0.7rem; border-top: 1px solid var(--k-line, rgba(36, 68, 52, 0.16)); }
    .evidence > summary { padding: 0.5rem 0 0; font-size: 0.83rem; font-weight: 700; color: var(--k-link, #1f6f88); cursor: pointer; list-style: none; }
    .evidence > summary::-webkit-details-marker { display: none; }
    .evidence > summary::before { content: "▸ "; }
    .evidence[open] > summary::before { content: "▾ "; }

    .evi { border: 1px solid var(--k-line, rgba(36, 68, 52, 0.16)); border-radius: 10px; padding: 0.5rem 0.65rem; margin: 0.35rem 0; background: var(--k-panel, #fffcf1); }
    .evi-type { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--k-text-muted, #657267); margin-bottom: 0.25rem; }
    .kv { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0.1rem 0.6rem; font-size: 0.84rem; margin: 0.12rem 0; }
    .kv .k { color: var(--k-text-muted, #657267); }
    .kv .v { overflow-wrap: anywhere; }
    .mono { font-family: var(--k-font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace); font-size: 0.8rem; }
    .tip { border-bottom: 1px dotted var(--k-line, rgba(36, 68, 52, 0.4)); cursor: help; }
    .excerpt-label { margin: 0.45rem 0 0.15rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--k-text-muted, #657267); }
    .excerpt { border-left: 2px solid var(--k-positive, #0f8f66); padding: 0.15rem 0 0.15rem 0.6rem; margin: 0; font-size: 0.84rem; color: var(--k-text, #17201b); white-space: pre-wrap; font-family: var(--k-font-mono, ui-monospace, monospace); }

    .custody { font-size: 0.84rem; margin: 0.25rem 0; }
    .custody strong { color: var(--k-positive, #0f8f66); }
    .custody[data-kind="caution"] strong { color: var(--k-caution, #a86612); }
    .custody[data-kind="negative"] strong { color: var(--k-negative, #c24141); }
    .custody .when { color: var(--k-text-muted, #657267); }

    /* 7 — technical details, deeper still */
    .tech { margin-top: 0.6rem; }
    .tech > summary { font-size: 0.76rem; color: var(--k-text-muted, #657267); cursor: pointer; list-style: none; }
    .tech > summary::-webkit-details-marker { display: none; }
    .tech > summary::before { content: "▸ "; }
    .tech[open] > summary::before { content: "▾ "; }
    .tech dl { display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 0.7rem; margin: 0.4rem 0 0; font-size: 0.76rem; }
    .tech dt { color: var(--k-text-muted, #657267); }
    .tech dd { margin: 0; overflow-wrap: anywhere; }

    .empty, .error { padding: 0.5rem 0; color: var(--k-text-muted, #657267); font-size: 0.9rem; }
    .error { color: var(--k-negative, #c24141); }
    .footnote { margin: 0.85rem 0 0; color: var(--k-text-muted, #657267); font-size: 0.74rem; }
    .ot-link { color: var(--k-link, #1f6f88); text-decoration: none; font-weight: 600; }
    .ot-link:hover { text-decoration: underline; }
    .link { color: var(--k-link, #1f6f88); text-decoration: none; overflow-wrap: anywhere; }
    .link:hover { text-decoration: underline; }
    .verify-btn { font: inherit; font-size: 0.72rem; font-weight: 600; color: var(--k-link, #1f6f88); background: var(--k-panel-raised, #fbf6e7); border: 1px solid var(--k-line, rgba(36, 68, 52, 0.3)); border-radius: 6px; padding: 0.02rem 0.4rem; margin-left: 0.4rem; cursor: pointer; white-space: nowrap; }
    .verify-btn:hover:not(:disabled) { background: var(--k-panel, #fffcf1); }
    .verify-btn:disabled { opacity: 0.6; cursor: default; }
    .verify-out { font-size: 0.76rem; margin-left: 0.4rem; }
    .verify-out.ok { color: var(--k-positive, #0f8f66); font-weight: 600; }
    .verify-out.bad { color: var(--k-negative, #c24141); font-weight: 600; }
    .verify-out.pending { color: var(--k-text-muted, #657267); }
  `;
    class SurfaceTrustPanel extends HTMLElement {
        static get observedAttributes() {
            return ["src", "heading", "expanded"];
        }
        #report = null;
        #shadow;
        constructor() {
            super();
            this.#shadow = this.attachShadow({ mode: "open" });
            // Delegated handler for the in-panel "Verify" buttons (re-fetch + re-hash the source).
            this.#shadow.addEventListener("click", (event) => {
                const target = event.target;
                const btn = target && target.closest ? target.closest(".verify-btn") : null;
                if (btn)
                    void this.#verify(btn);
            });
        }
        async #verify(btn) {
            const url = btn.dataset.url ?? "";
            const expect = (btn.dataset.expect ?? "").toLowerCase();
            const out = btn.nextElementSibling;
            const setOut = (cls, text) => {
                if (out) {
                    out.className = "verify-out " + cls;
                    out.textContent = text;
                }
            };
            if (typeof crypto === "undefined" || !crypto.subtle) {
                setOut("bad", "SHA-256 unavailable here — verify from a secure context");
                return;
            }
            btn.disabled = true;
            setOut("pending", "recomputing…");
            try {
                const res = await fetch(url);
                if (!res.ok)
                    throw new Error("HTTP " + res.status);
                const buf = await res.arrayBuffer();
                const digest = await crypto.subtle.digest("SHA-256", buf);
                const hex = Array.from(new Uint8Array(digest))
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("");
                if (hex === expect)
                    setOut("ok", "✓ re-hash matches the live source");
                else
                    setOut("bad", "✗ mismatch — the source has changed (" + hex.slice(0, 12) + "…)");
            }
            catch (err) {
                setOut("bad", "couldn’t fetch source: " + (err instanceof Error ? err.message : String(err)));
            }
            finally {
                btn.disabled = false;
            }
        }
        connectedCallback() {
            // Re-apply a `report` set before the element was upgraded, so the
            // property assignment reaches the class accessor instead of being
            // shadowed by an own property.
            if (Object.prototype.hasOwnProperty.call(this, "report")) {
                const pending = this.report;
                delete this.report;
                this.report = pending;
                return;
            }
            const src = this.getAttribute("src");
            if (!this.#report && src)
                void this.#load(src);
            else
                this.#render();
        }
        attributeChangedCallback(name, oldValue, newValue) {
            if (name === "src" && newValue && newValue !== oldValue)
                void this.#load(newValue);
            if ((name === "heading" || name === "expanded") && newValue !== oldValue)
                this.#render();
        }
        get report() {
            return this.#report;
        }
        set report(value) {
            this.#report = value ?? null;
            this.#render();
        }
        async #load(src) {
            try {
                const response = await fetch(src);
                if (!response.ok)
                    throw new Error(`Failed to load report: HTTP ${response.status}`);
                this.report = await response.json();
            }
            catch (error) {
                this.#renderError(error instanceof Error ? error.message : String(error));
            }
        }
        #render() {
            const report = this.#report;
            if (!report) {
                this.#renderShell('<p class="empty">No trust report loaded yet.</p>');
                return;
            }
            if (!Array.isArray(report.claims)) {
                this.#renderError("This JSON does not look like a trust report: no claims array.");
                return;
            }
            const claims = report.claims;
            if (claims.length > 0 && claims.every((claim) => !claim.status)) {
                this.#renderError("This looks like a TrustBundle rather than a derived report. Run `surface report --input <file>` first, then load the report output.");
                return;
            }
            const counts = new Map();
            for (const claim of claims) {
                const status = typeof claim.status === "string" ? claim.status : "unknown";
                counts.set(status, (counts.get(status) ?? 0) + 1);
            }
            const chips = [...counts.entries()]
                .map(([status, count]) => `<span class="chip" data-kind="${STATUS_KIND[status] ?? "neutral"}">${escapeHtml(STATUS_LABELS[status] ?? status)}: ${count}</span>`)
                .join("");
            const expanded = this.hasAttribute("expanded");
            const claimRows = claims.map((claim) => this.#renderClaim(claim, report, expanded)).join("");
            this.#renderShell(`
        <div class="panel-header">
          <p class="panel-title">${escapeHtml(this.getAttribute("heading") ?? "Surface Trust Panel")}</p>
          <p class="panel-meta">${escapeHtml(asText(report.source))}${report.generatedAt ? ` · ${escapeHtml(shortWhen(report.generatedAt))}` : ""}</p>
        </div>
        <div class="chips">${chips}</div>
        ${claimRows || '<p class="empty">The report contains no claims.</p>'}
        <p class="footnote">Derived by Kontour Surface · <a class="ot-link" href="${HACHURE_URL}" target="_blank" rel="noopener">Open Trust Format · Hachure ↗</a></p>
      `);
        }
        #renderClaim(claim, report, expanded) {
            const status = typeof claim.status === "string" ? claim.status : "unknown";
            const kind = STATUS_KIND[status] ?? "neutral";
            const evidence = asArray(report.evidence).filter((item) => item.claimId === claim.id);
            const events = asArray(report.events).filter((item) => item.claimId === claim.id);
            const gaps = asArray(report.transparencyGaps).filter((item) => item.claimId === claim.id);
            const meta = isObject(claim.metadata) ? claim.metadata : {};
            // 1 — verdict + the claim, in plain language
            const subjectName = asText(meta.subjectName ?? meta.accountName ?? meta.label ?? claim.subjectId, asText(claim.subjectId));
            const period = asText(meta.period ?? qualifierText(claim.qualifiers));
            const description = asText(claim.description ?? claim.label ?? meta.description ?? meta.statement);
            const icon = kind === "positive" ? "&#10003; " : kind === "negative" ? "&#8856; " : "";
            // 2/3 — confidence signals + impact (separate axes)
            const signals = confidenceChips(claim.confidenceBasis);
            const impact = claim.impactLevel && asText(claim.impactLevel) !== "unspecified" ? asText(claim.impactLevel) : "";
            const impactKind = impact === "high" || impact === "critical" ? "caution" : "neutral";
            // 5 — grounding
            const evidenceCards = evidence
                .map((item) => {
                const sourceName = asText((isObject(item.metadata) ? item.metadata.accountName : undefined) ?? item.sourceRef);
                const locator = asText(item.sourceLocator);
                const integ = asText(item.integrityRef);
                const verifyUrl = asText(item.verifyUrl ?? (isObject(item.metadata) ? item.metadata.verifyUrl : ""));
                const locatorCell = item.sourceLocator
                    ? isUrl(locator)
                        ? `<a class="v mono link" href="${escapeHtml(locator)}" target="_blank" rel="noopener" title="${escapeHtml(locator)}">${escapeHtml(truncMid(locator, 30, 12))} ↗</a>`
                        : `<span class="v mono tip" title="${escapeHtml(locator)}">${escapeHtml(truncMid(locator, 30, 12))}</span>`
                    : "";
                const integrityCell = item.integrityRef
                    ? `<span class="v"><span class="mono tip" title="sha256: ${escapeHtml(integ)}">sha256 ${escapeHtml(truncMid(integ, 10, 8))}</span>${verifyUrl ? ` <button class="verify-btn" type="button" data-url="${escapeHtml(verifyUrl)}" data-expect="${escapeHtml(integ)}">Verify ↻</button><span class="verify-out" aria-live="polite"></span>` : ""}</span>`
                    : "";
                const rows = [
                    `<div class="kv"><span class="k">Source</span><span class="v">${escapeHtml(sourceName)}</span></div>`,
                    locatorCell ? `<div class="kv"><span class="k">Located at</span>${locatorCell}</div>` : "",
                    integrityCell ? `<div class="kv"><span class="k">Integrity</span>${integrityCell}</div>` : "",
                    verifyUrl ? `<div class="kv"><span class="k">Full source</span><a class="v link" href="${escapeHtml(verifyUrl)}" target="_blank" rel="noopener">open the record this value was read from ↗</a></div>` : "",
                ].join("");
                const excerpt = item.excerptOrSummary
                    ? `<div class="excerpt-label">Verbatim from the source</div><blockquote class="excerpt">${escapeHtml(asText(item.excerptOrSummary))}</blockquote>`
                    : "";
                return `<div class="evi">
            <div class="evi-type">${escapeHtml(asText(item.evidenceType, "evidence"))} &middot; ${escapeHtml(asText(item.method, "unknown method"))}</div>
            ${rows}
            ${excerpt}
          </div>`;
            })
                .join("");
            // 6 — chain of custody
            const custody = events
                .map((item) => {
                const ekind = typeof item.status === "string" ? STATUS_KIND[item.status] ?? "neutral" : "positive";
                const when = item.verifiedAt ?? item.createdAt;
                return `<p class="custody" data-kind="${ekind}">&#10003; <strong>Verified by ${escapeHtml(asText(item.actor, "unknown actor"))}</strong> via ${escapeHtml(asText(item.method, "review"))}${when ? ` <span class="when">&middot; ${escapeHtml(shortWhen(when))}</span>` : ""}</p>`;
            })
                .join("");
            // 4 — transparency gaps. Surfaced HIGH (right under the value) and flagged in the header
            // so a refusal/limitation on a verified claim never reads as a clean pass.
            const gapList = gaps
                .map((item) => `<li class="gap" data-severity="${escapeHtml(asText(item.severity))}">&#9888; ${escapeHtml(asText(item.type, "gap"))} — ${escapeHtml(asText(item.message))}</li>`)
                .join("");
            const hiSevGap = gaps.find((item) => {
                const sev = asText(item.severity);
                return sev === "high" || sev === "critical";
            });
            const gapMarker = hiSevGap
                ? `<span class="badge" data-kind="negative" title="${escapeHtml(asText(hiSevGap.message))}">&#9888; ${escapeHtml(asText(hiSevGap.type, "gap"))}</span>`
                : "";
            const gapsBlock = gapList ? `<div class="section-label gap-label">Transparency gaps</div><ul class="gaps">${gapList}</ul>` : "";
            // 7 — technical details, deeper still
            const techRows = [
                claim.id ? `<dt>Claim ID</dt><dd class="mono">${escapeHtml(asText(claim.id))}</dd>` : "",
                claim.surface ? `<dt>Surface</dt><dd>${escapeHtml(asText(claim.surface))}</dd>` : "",
                claim.verificationPolicyId ? `<dt>Policy</dt><dd>${escapeHtml(asText(claim.verificationPolicyId))}</dd>` : "",
                claim.currentIntegrityRef ? `<dt>Claim integrity</dt><dd class="mono">${escapeHtml(asText(claim.currentIntegrityRef))}</dd>` : "",
                claim.createdAt ? `<dt>Created</dt><dd>${escapeHtml(asText(claim.createdAt))}</dd>` : "",
                claim.updatedAt && claim.updatedAt !== claim.createdAt ? `<dt>Updated</dt><dd>${escapeHtml(asText(claim.updatedAt))}</dd>` : "",
                ...evidence.map((item) => (item.id ? `<dt>Evidence ID</dt><dd class="mono">${escapeHtml(asText(item.id))}</dd>` : "")),
            ].join("");
            const evidenceInner = `
        <div class="section-label">Grounded in</div>
        ${evidenceCards || '<p class="empty">No evidence recorded — nothing grounds this claim.</p>'}
        ${custody ? `<div class="section-label">Chain of custody</div>${custody}` : ""}
        ${techRows ? `<details class="tech"><summary>Technical details</summary><dl>${techRows}</dl></details>` : ""}
      `;
            return `<div class="claim" data-kind="${kind}">
        <div class="claim-head">
          <span class="badge" data-kind="${kind}">${icon}${escapeHtml(STATUS_LABELS[status] ?? status)}</span>
          ${gapMarker}
          <span class="claim-subject">${escapeHtml(subjectName)}</span>
          ${period ? `<span class="claim-period">${escapeHtml(shortWhen(period))}</span>` : ""}
        </div>
        ${description ? `<p class="claim-desc">${escapeHtml(description)}</p>` : ""}
        <div class="result">
          <span class="result-field">${escapeHtml(asText(claim.fieldOrBehavior))}</span>
          <span class="result-eq">=</span>
          <span class="result-value">${escapeHtml(formatValue(claim.value))}</span>
        </div>
        ${gapsBlock}
        ${signals ? `<div class="section-label" title="How confident the producer was when recording this claim. Hover each chip for its scale. A self-reported basis, not a guarantee of correctness.">Confidence</div><div class="signals">${signals}</div>` : ""}
        ${impact ? `<div class="section-label" title="How consequential this claim is if it turns out to be wrong — it drives how much scrutiny the claim deserves. This is NOT a measure of how trustworthy the claim is.">Impact</div><div class="signals"><span class="chip" data-kind="${impactKind}">${escapeHtml(impact)}</span></div>` : ""}
        <details class="evidence"${expanded ? " open" : ""}>
          <summary>Show the evidence — source, integrity &amp; who verified</summary>
          ${evidenceInner}
        </details>
      </div>`;
        }
        #renderShell(body) {
            this.#shadow.innerHTML = `<style>${PANEL_CSS}</style><div class="panel">${body}</div>`;
        }
        #renderError(message) {
            this.#renderShell(`<p class="error">${escapeHtml(message)}</p>`);
        }
    }
    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }
    function isObject(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    function asText(value, fallback = "") {
        if (value === undefined || value === null)
            return fallback;
        return String(value);
    }
    function formatValue(value) {
        if (value === undefined || value === null)
            return "—";
        return typeof value === "string" ? value : JSON.stringify(value);
    }
    // Truncate the middle of a long opaque string (hash, URI) keeping head + tail.
    function truncMid(text, head, tail) {
        if (text.length <= head + tail + 1)
            return text;
        return `${text.slice(0, head)}…${text.slice(-tail)}`;
    }
    function isUrl(text) {
        return /^https?:\/\//i.test(text);
    }
    // Show just the date portion of an ISO timestamp; pass other strings through.
    function shortWhen(value) {
        const text = asText(value);
        const match = /^(\d{4}-\d{2}-\d{2})T/.exec(text);
        return match ? match[1] : text;
    }
    function qualifierText(qualifiers) {
        if (!isObject(qualifiers))
            return "";
        return Object.entries(qualifiers)
            .map(([k, v]) => `${k}=${asText(v)}`)
            .join(", ");
    }
    // Build the hover tooltip for a qualitative rating: the full ordered scale
    // with the current level marked, plus what this level means.
    function scaleTip(dimension, value) {
        const def = SCALE_DEFS[dimension];
        if (!def)
            return "";
        const scale = def.levels.map((level) => (level === value ? `[${level}]` : level)).join(" · ");
        const meaning = def.defs[value] ? ` — "${value}": ${def.defs[value]}` : "";
        return `${def.label}. Scale: ${scale}${meaning}`;
    }
    // The confidence signals (ConfidenceBasis), as compact chips. Non-signals
    // ("unknown" / "none") are omitted rather than shown as hollow values, and
    // impactLevel is deliberately NOT here — impact is consequence-if-wrong, a
    // different axis from credibility, rendered separately under its own label.
    function confidenceChips(confidenceBasis) {
        if (!isObject(confidenceBasis))
            return "";
        const c = confidenceBasis;
        const chips = [];
        if (typeof c.extractionConfidence === "number") {
            chips.push({
                text: `${Math.round(c.extractionConfidence * 100)}% extraction confidence`,
                tip: "How confident the extraction step was that it read this value correctly (0–100%).",
            });
        }
        if (c.reviewerAuthority && asText(c.reviewerAuthority) !== "none") {
            chips.push({ text: `${asText(c.reviewerAuthority)}-reviewed`, tip: scaleTip("reviewerAuthority", asText(c.reviewerAuthority)) });
        }
        if (c.sourceQuality && asText(c.sourceQuality) !== "unknown") {
            chips.push({ text: `source quality: ${asText(c.sourceQuality)}`, tip: scaleTip("sourceQuality", asText(c.sourceQuality)) });
        }
        if (c.evidenceStrength && asText(c.evidenceStrength) !== "none") {
            chips.push({ text: `evidence: ${asText(c.evidenceStrength)}`, tip: scaleTip("evidenceStrength", asText(c.evidenceStrength)) });
        }
        if (typeof c.corroborationCount === "number" && c.corroborationCount > 0) {
            chips.push({ text: `${c.corroborationCount}× corroborated`, tip: "Number of independent sources that corroborate this claim." });
        }
        return chips
            .map((chip) => `<span class="chip tip" title="${escapeHtml(chip.tip)}">${escapeHtml(chip.text)}</span>`)
            .join("");
    }
    function escapeHtml(text) {
        return text
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }
    customElements.define("surface-trust-panel", SurfaceTrustPanel);
})();
export {};
