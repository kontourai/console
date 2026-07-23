import { expect, test, type Page } from "@playwright/test";

// console#255: the finale of the trust arc — clicking a gate (or loading
// /gate/:id directly, console#252's existing deep-link mechanism) shows the
// Surface trust panel for it, updating live as evidence accumulates.
// Self-contained fixture/mock (mirrors run-drilldown.spec.ts's pattern)
// rather than the shared `hubState` in console-ui.spec.ts, so this file owns
// gate ids exercising every report-selection outcome: the gate's own report,
// an honest "no data" empty state, a refs-only fallback, and a live SSE
// update that attaches a report after the page has already loaded.

const gateVerifiedReport = {
  schemaVersion: 5,
  source: "surface-test",
  generatedAt: "2026-07-20T11:58:00.000Z",
  claims: [
    {
      id: "claim-tests",
      subjectType: "workflow",
      subjectId: "checkout-banner/gate/tests-evidence",
      facet: "flow-agents.workflow",
      claimType: "builder.verify.tests",
      fieldOrBehavior: "required tests pass",
      value: "pass",
      status: "verified",
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:05:00.000Z",
    },
  ],
  evidence: [
    {
      id: "ev-tests",
      claimId: "claim-tests",
      evidenceType: "test_output",
      method: "validation",
      sourceRef: "checkout-banner/evidence.json",
      excerptOrSummary: "node --test passes",
      observedAt: "2026-07-20T10:04:00.000Z",
    },
  ],
  transparencyGaps: [],
};

// A DIFFERENT report (distinct source/claim) — used to prove a live update
// REASSIGNS `.report` rather than getting stuck on the first value it saw.
const gateVerifiedReportV2 = {
  schemaVersion: 5,
  source: "surface-test-v2",
  generatedAt: "2026-07-20T12:30:00.000Z",
  claims: [
    {
      id: "claim-lint",
      subjectType: "workflow",
      subjectId: "checkout-banner/gate/lint-evidence",
      facet: "flow-agents.workflow",
      claimType: "builder.verify.lint",
      fieldOrBehavior: "lint is clean",
      value: "pass",
      status: "verified",
      createdAt: "2026-07-20T12:25:00.000Z",
      updatedAt: "2026-07-20T12:29:00.000Z",
    },
  ],
  evidence: [
    {
      id: "ev-lint",
      claimId: "claim-lint",
      evidenceType: "lint_output",
      method: "validation",
      sourceRef: "checkout-banner/lint.json",
      excerptOrSummary: "eslint passes",
      observedAt: "2026-07-20T12:29:00.000Z",
    },
  ],
  transparencyGaps: [],
};

const baseState = {
  generatedAt: "2026-07-20T12:00:00.000Z",
  currentStage: "Gate trust panel check",
  source: { mode: "test", streamIds: ["gate-trust-panel"], acceptedEventCount: 1, duplicateEventCount: 0 },
  processes: [],
  claims: [],
  actions: [],
  learnings: [],
  timeline: [],
  gates: [
    // The gate's OWN trustReport — the primary, highest-precedence case.
    {
      id: "gate-verified",
      label: "Tests evidence",
      status: "waiting",
      trustReport: gateVerifiedReport,
      updatedAt: "2026-07-20T11:58:00.000Z",
    },
    // No trustReport anywhere, and no evidence/expectation refs either —
    // the honest empty state with no fallback list.
    {
      id: "gate-empty",
      label: "No evidence yet",
      status: "waiting",
      updatedAt: "2026-07-20T11:00:00.000Z",
    },
    // No trustReport, but evidence/expectation refs ARE present — the
    // "no data yet" state falls back to listing them.
    {
      id: "gate-refs-only",
      label: "Refs only, no report",
      status: "waiting",
      evidenceRefs: [{ product: "surface", kind: "evidence", id: "ev-pending", label: "pending evidence bundle" }],
      expectationRefs: [{ product: "surface", kind: "claim", id: "claim-pending", label: "pending required claim" }],
      updatedAt: "2026-07-20T11:00:00.000Z",
    },
    // No trustReport of its own yet — the live-update test attaches one via
    // a follow-up SSE `state` push, without any reselection.
    {
      id: "gate-live",
      label: "Live-updating gate",
      status: "waiting",
      updatedAt: "2026-07-20T11:00:00.000Z",
    },
  ],
};

async function installMock(page: Page): Promise<void> {
  await page.addInitScript((fixtures) => {
    window.__kontourGateTrustEventSourceInstances = [];

    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = MockEventSource.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        window.__kontourGateTrustEventSourceInstances?.push(this);
        window.setTimeout(() => {
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(fixtures.state) }));
        }, 0);
      }

      close(): void {
        this.readyState = MockEventSource.CLOSED;
      }

      emitState(nextState: unknown): void {
        this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(nextState) }));
      }
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === "/api/telemetry") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              generatedAt: "2026-07-20T12:00:00.000Z",
              totals: { recordCount: 0, sessionCount: 0, eventTypeCounts: {}, productRecordCount: 0 },
              analytics: { facets: [], flows: [] },
              sources: [],
              records: [],
              warnings: [],
              query: { preset: "live", limit: 24, sort: "desc", filters: [] },
              pagination: { returnedCount: 0, matchedCount: 0, totalMatchedCount: 0, limit: 24, offset: 0, nextOffset: null, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      if (url.pathname.startsWith("/ingest/flow/")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }));
      }
      return nativeFetch(input, init);
    };
  }, { state: baseState });
}

test("direct-loading /gate/:id for a gate carrying its own trustReport renders <surface-trust-panel> with the report set (console#255)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installMock(page);

  await page.goto("/gate/gate-verified");

  await expect(page.getByRole("link", { name: "Operate", exact: true })).toHaveClass(/active/);
  const gateRow = page.locator("#gate\\:gate-verified");
  await expect(gateRow).toHaveClass(/selected/);

  const trustPanel = page.getByLabel("Trust panel for gate gate-verified");
  await expect(trustPanel).toBeVisible();
  await expect(trustPanel).not.toContainText("No trust data yet for this gate.");

  const panelEl = trustPanel.locator("surface-trust-panel");
  await expect(panelEl).toHaveCount(1);

  const tagName = await panelEl.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName).toBe("surface-trust-panel");

  // The `.report` property was set (imperative ref assignment, not an
  // attribute) and carries the exact fixture report, verbatim.
  const report = await panelEl.evaluate((el) => (el as HTMLElement & { report?: unknown }).report);
  expect(report).toEqual(gateVerifiedReport);

  // Rendered INSIDE the element's shadow root — confirms it actually has data
  // to show, not just an upgraded-but-empty custom element.
  const shadowText = await panelEl.evaluate((el) => el.shadowRoot?.textContent ?? "");
  expect(shadowText).toContain("required tests pass");
  expect(shadowText).toContain("Verified");

  expect(consoleErrors).toEqual([]);
});

test("direct-loading /gate/:id for a gate with no trust data anywhere shows the honest empty state, never a fabricated panel (console#255)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installMock(page);

  await page.goto("/gate/gate-empty");

  const gateRow = page.locator("#gate\\:gate-empty");
  await expect(gateRow).toHaveClass(/selected/);

  const trustPanel = page.getByLabel("Trust panel for gate gate-empty");
  await expect(trustPanel).toBeVisible();
  await expect(trustPanel).toContainText("No trust data yet for this gate.");
  await expect(trustPanel.locator("surface-trust-panel")).toHaveCount(0);
  // No refs of any kind on this gate, so no fallback reference list either.
  await expect(trustPanel).not.toContainText("Evidence references");
  await expect(trustPanel).not.toContainText("Expectation references");

  expect(consoleErrors).toEqual([]);
});

test("a gate with no trustReport but real evidence/expectation refs falls back to listing them honestly (console#255)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installMock(page);

  await page.goto("/gate/gate-refs-only");

  const trustPanel = page.getByLabel("Trust panel for gate gate-refs-only");
  await expect(trustPanel).toContainText("No trust data yet for this gate.");
  await expect(trustPanel.locator("surface-trust-panel")).toHaveCount(0);
  await expect(trustPanel).toContainText("Evidence references");
  await expect(trustPanel).toContainText("pending evidence bundle");
  await expect(trustPanel).toContainText("Expectation references");
  await expect(trustPanel).toContainText("pending required claim");

  expect(consoleErrors).toEqual([]);
});

test("the trust panel updates live as a new SSE state attaches a report to the selected gate, with no reselection (console#255)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installMock(page);

  await page.goto("/gate/gate-live");

  const trustPanel = page.getByLabel("Trust panel for gate gate-live");
  await expect(trustPanel).toContainText("No trust data yet for this gate.");
  await expect(trustPanel.locator("surface-trust-panel")).toHaveCount(0);

  const updatedState = {
    ...baseState,
    gates: baseState.gates.map((gate) =>
      gate.id === "gate-live" ? { ...gate, trustReport: gateVerifiedReport, status: "passed" } : gate
    ),
  };
  await page.evaluate((nextState) => {
    const source = window.__kontourGateTrustEventSourceInstances?.at(-1);
    source?.emitState(nextState);
  }, updatedState);

  await expect(trustPanel).not.toContainText("No trust data yet for this gate.", { timeout: 5000 });
  const panelEl = trustPanel.locator("surface-trust-panel");
  await expect(panelEl).toHaveCount(1);
  const report = await panelEl.evaluate((el) => (el as HTMLElement & { report?: unknown }).report);
  expect(report).toEqual(gateVerifiedReport);

  expect(consoleErrors).toEqual([]);
});


// ── Cheap coverage gaps (independent review) ────────────────────────────────

test("a live update swaps ONE report for a DIFFERENT report on the same gate — .report is reassigned, not stuck on the first value (console#255 review gap)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installMock(page);

  await page.goto("/gate/gate-live");
  const trustPanel = page.getByLabel("Trust panel for gate gate-live");
  await expect(trustPanel).toContainText("No trust data yet for this gate.");

  const withFirstReport = {
    ...baseState,
    gates: baseState.gates.map((gate) => (gate.id === "gate-live" ? { ...gate, trustReport: gateVerifiedReport } : gate)),
  };
  await page.evaluate((nextState) => {
    window.__kontourGateTrustEventSourceInstances?.at(-1)?.emitState(nextState);
  }, withFirstReport);

  const panelEl = trustPanel.locator("surface-trust-panel");
  await expect(panelEl).toHaveCount(1, { timeout: 5000 });
  await expect
    .poll(async () => panelEl.evaluate((el) => (el as HTMLElement & { report?: unknown }).report))
    .toEqual(gateVerifiedReport);

  // A SECOND live update swaps in a genuinely different report for the same gate.
  const withSecondReport = {
    ...baseState,
    gates: baseState.gates.map((gate) => (gate.id === "gate-live" ? { ...gate, trustReport: gateVerifiedReportV2 } : gate)),
  };
  await page.evaluate((nextState) => {
    window.__kontourGateTrustEventSourceInstances?.at(-1)?.emitState(nextState);
  }, withSecondReport);

  await expect
    .poll(async () => panelEl.evaluate((el) => (el as HTMLElement & { report?: unknown }).report))
    .toEqual(gateVerifiedReportV2);
  const shadowText = await panelEl.evaluate((el) => el.shadowRoot?.textContent ?? "");
  expect(shadowText).toContain("lint is clean");
  expect(shadowText).not.toContain("required tests pass");

  expect(consoleErrors).toEqual([]);
});

test("deselecting a gate and selecting a DIFFERENT one renders a fresh panel with no stale content from the previous gate (console#255 review gap)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installMock(page);

  await page.goto("/gate/gate-verified");
  const verifiedPanel = page.getByLabel("Trust panel for gate gate-verified");
  const verifiedPanelEl = verifiedPanel.locator("surface-trust-panel");
  await expect(verifiedPanelEl).toHaveCount(1);
  const shadowTextBefore = await verifiedPanelEl.evaluate((el) => el.shadowRoot?.textContent ?? "");
  expect(shadowTextBefore).toContain("required tests pass");

  // Deselect gate-verified, then select the unrelated no-data gate.
  await page.locator("#gate\\:gate-verified").click();
  await expect(verifiedPanel).toHaveCount(0);
  await page.locator("#gate\\:gate-empty").click();

  const emptyPanel = page.getByLabel("Trust panel for gate gate-empty");
  await expect(emptyPanel).toContainText("No trust data yet for this gate.");
  await expect(emptyPanel.locator("surface-trust-panel")).toHaveCount(0);
  // The previous gate's report content must not leak into the new panel.
  await expect(emptyPanel).not.toContainText("required tests pass");
  await expect(page.getByLabel("Trust panel for gate gate-verified")).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

// ── console#255 review MED finding 2: failed chunk load -> honest fallback ──
//
// The loader's own RETRY contract (a rejected import resets internal state so
// a LATER call attempts the import again, rather than staying permanently
// disabled) is verified with dependency-injected importer mocks in
// console-ui/test/surfaceTrustPanelLoader.test.ts, per the review's own
// prescribed test method. It is deliberately NOT re-verified here by
// unblocking network and reselecting the SAME gate in the SAME page: browsers
// permanently cache a REJECTED dynamic import for a given URL for the
// lifetime of the page/module registry — a later `import()` of the identical
// specifier keeps rejecting even once the network recovers, with no further
// request ever sent (confirmed with a standalone Chromium repro: two
// `import()` calls of the same URL, the second AFTER unblocking the route,
// both reject with zero new network activity for the second). That is a
// platform limitation orthogonal to this fix, not something the loader (or
// any userland retry logic) can work around without changing the import
// specifier or reloading the page. This test therefore covers exactly what a
// real browser can observe: the failure renders the honest fallback, never a
// blank/unupgraded element.

test("a failed surface-trust-panel chunk load renders an honest 'trust panel unavailable' fallback, never a blank element", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installMock(page);

  // Simulate an offline/CDN-hiccup chunk load: abort every request for the
  // surface-trust-panel chunk.
  await page.route("**/*surface-trust-panel*.js", (route) => route.abort("failed"));

  await page.goto("/gate/gate-verified");
  const trustPanel = page.getByLabel("Trust panel for gate gate-verified");
  await expect(trustPanel).toContainText("The trust panel couldn't load", { timeout: 5000 });
  await expect(trustPanel.locator("surface-trust-panel")).toHaveCount(0);
  // The gate's own trustReport still exists — it just can't be RENDERED by
  // the (unavailable) element. Never silently drop that it exists.
  await expect(page.locator("#gate\\:gate-verified")).toHaveClass(/selected/);

  expect(consoleErrors).toEqual([]);
});

declare global {
  interface Window {
    __kontourGateTrustEventSourceInstances?: Array<{
      emitState(nextState: unknown): void;
    }>;
  }
}
