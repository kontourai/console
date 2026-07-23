import { expect, test, type Page } from "@playwright/test";

// console#253: the run drill-in genuinely answers "where is this run in its
// flow?" — a stage strip with the current position highlighted, and a
// clickable gate history that is the real click-path #255's trust panel will
// land on. Self-contained fixture/mock (mirrors console-live-updates.spec.ts's
// pattern) rather than the shared `hubState` in console-ui.spec.ts, which has
// no process-scoped gate to click through.

const runState = {
  generatedAt: "2026-07-20T12:00:00.000Z",
  currentStage: "Checkout retry banner in flight",
  source: { mode: "test", streamIds: ["run-drilldown"], acceptedEventCount: 3, duplicateEventCount: 0 },
  processes: [
    {
      id: "run-checkout-banner",
      label: "Checkout retry banner",
      status: "running",
      currentStep: { id: "execute", label: "Implement banner retry" },
      percentComplete: 55,
      updatedAt: "2026-07-20T11:55:00.000Z",
      // console#256: source-of-truth link-outs -- a real work-item URL, an
      // assignment-branch ref with NO url (text-only chip, never a fake
      // anchor), and an unsafe javascript: URL that must never render as a
      // live link anywhere this ref set is shown (fleet card + run detail).
      sourceOfTruthRefs: [
        { kind: "assignment-branch", id: "branch-checkout-banner", label: "feature/checkout-banner" },
        { kind: "work-item", id: "github:kontourai/flow-agents#891", label: "#891", url: "https://github.com/kontourai/flow-agents/issues/891" },
        { kind: "assignment-actor", id: "evil-actor-id", label: "evil-actor", url: "javascript:alert(1)" },
      ],
    },
  ],
  gates: [
    {
      id: "gate-build-verify",
      label: "Build verify",
      status: "waiting",
      processRef: { id: "run-checkout-banner" },
      updatedAt: "2026-07-20T11:50:00.000Z",
    },
    {
      id: "gate-unrelated",
      label: "Unrelated gate",
      status: "passed",
      processRef: { id: "run-other-process" },
      updatedAt: "2026-07-20T11:00:00.000Z",
    },
  ],
  claims: [],
  actions: [],
  learnings: [],
  timeline: [
    {
      id: "t1",
      type: "process.started",
      occurredAt: "2026-07-20T11:40:00.000Z",
      summary: "Checkout retry banner run started.",
      subjectRef: { id: "run-checkout-banner" },
    },
  ],
};

const telemetryBase = {
  generatedAt: "2026-07-20T12:00:00.000Z",
  totals: { recordCount: 0, sessionCount: 0, eventTypeCounts: {}, productRecordCount: 0 },
  analytics: { facets: [], flows: [] },
  sources: [],
  records: [],
  warnings: [],
  query: { preset: "live", limit: 24, sort: "desc", filters: [] },
  pagination: { returnedCount: 0, matchedCount: 0, totalMatchedCount: 0, limit: 24, offset: 0, nextOffset: null, hasMore: false },
};

async function installMock(page: Page): Promise<void> {
  await page.addInitScript((fixtures) => {
    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = MockEventSource.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        window.setTimeout(() => {
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(fixtures.state) }));
        }, 0);
      }

      close(): void {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === "/api/telemetry") {
        return Promise.resolve(
          new Response(JSON.stringify(fixtures.telemetry), { status: 200, headers: { "content-type": "application/json" } })
        );
      }
      if (url.pathname.startsWith("/ingest/flow/")) {
        // No flow projection recorded for this run in this fixture — the
        // ingest endpoint honestly 404s, exercising the drill-down's existing
        // "empty" state alongside the new stage strip / gate history.
        return Promise.resolve(new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } }));
      }
      return nativeFetch(input, init);
    };
  }, { state: runState, telemetry: telemetryBase });
}

test("direct-loading /run/:id shows the stage strip with the current stage highlighted and a clickable gate history linking to /gate/:id (console#253)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await installMock(page);
  await page.goto("/run/run-checkout-banner");

  await expect(page.getByRole("link", { name: "Board", exact: true })).toHaveClass(/active/);
  await expect(page.locator(".board-drilldown")).toContainText("Checkout retry banner");
  await expect(page.locator(".board-drilldown")).toContainText("run checkout-banner");

  // Stage strip: five board stages, "In flight" (matching the process's
  // execute step) is the highlighted current one. backlog/planning are the
  // neutral "earlier" (this run is still active — classifyBoardStage has no
  // gate evidence that they actually completed, console#253 review finding
  // 2), verify/done are still pending.
  const stages = page.locator(".run-stage-strip .run-stage");
  await expect(stages).toHaveCount(5);
  const current = page.locator(".run-stage-current");
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("In flight");
  await expect(current).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".run-stage-earlier")).toHaveCount(2);
  await expect(page.locator(".run-stage-pending")).toHaveCount(2);
  await expect(page.locator(".run-stage-completed")).toHaveCount(0);

  // Gate history: only the gate scoped to THIS run appears (the unrelated
  // gate targeting a different process is excluded), with a real /gate/:id
  // link — the click-path #255's trust panel will land on.
  const gateEntries = page.locator(".run-gate-history .run-gate-entry");
  await expect(gateEntries).toHaveCount(1);
  const gateLink = page.locator("a.run-gate-link");
  await expect(gateLink).toContainText("Build verify");
  await expect(gateLink).toHaveAttribute("href", "/gate/gate-build-verify");
  await expect(page.getByText("Unrelated gate")).toHaveCount(0);

  // The run's own recent timeline slice is present too.
  await expect(page.locator(".run-timeline-slice")).toContainText("Checkout retry banner run started.");

  // Clicking the gate link navigates to /gate/:id and focuses it in the
  // Operate WorkGrid (console#252's existing deep-link mechanism).
  await gateLink.click();
  await expect(page).toHaveURL(/\/gate\/gate-build-verify$/);
  await expect(page.getByRole("link", { name: "Operate", exact: true })).toHaveClass(/active/);
  const gateRow = page.locator("#gate\\:gate-build-verify");
  await expect(gateRow).toHaveClass(/selected/);

  expect(consoleErrors).toEqual([]);
});

test("loading /run/:id for an id absent from the operating state shows an honest 'not found' panel, never a crash (console#253)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await installMock(page);
  await page.goto("/run/run-does-not-exist");

  await expect(page.getByRole("link", { name: "Board", exact: true })).toHaveClass(/active/);
  await expect(page.locator(".board-drilldown")).toContainText(/not found in current operating state/i);
  await expect(page.locator(".run-stage-strip")).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

// console#256: source-of-truth link-outs surface on BOTH the fleet card
// (Overview, compact work-item-only chip) and the run detail (full ref set,
// deterministic work-item-first order), reusing the SAME shared component --
// and an unsafe javascript: URL never becomes a live link on either surface.
test("a process with a work-item sourceOfTruthRefs entry shows a linked chip on its fleet card AND in the run detail (console#256)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await installMock(page);
  await page.goto("/");

  // Fleet card (Overview): the compact work-item-only chip, linking out.
  const fleetCard = page.locator(".wf-card", { hasText: "Checkout retry banner" });
  await expect(fleetCard).toBeVisible();
  const fleetWorkItemLink = fleetCard.locator("a.source-ref-link");
  await expect(fleetWorkItemLink).toHaveCount(1);
  await expect(fleetWorkItemLink).toHaveText("#891");
  await expect(fleetWorkItemLink).toHaveAttribute("href", "https://github.com/kontourai/flow-agents/issues/891");
  await expect(fleetWorkItemLink).toHaveAttribute("target", "_blank");
  await expect(fleetWorkItemLink).toHaveAttribute("rel", "noopener noreferrer");
  // Only the work-item kind renders on the fleet card -- the
  // assignment-branch/actor refs are present in state but filtered out here.
  await expect(fleetCard.locator("code.source-ref-text")).toHaveCount(0);

  // Run detail: the FULL ref set, work-item chip first, then the
  // assignment-branch text chip (no url -- an honest <code>, never a link).
  await page.goto("/run/run-checkout-banner");
  const sourceRefs = page.locator(".run-detail-source-refs .source-ref-chip");
  await expect(sourceRefs).toHaveCount(3);
  const runDetailWorkItemLink = page.locator(".run-detail-source-refs a.source-ref-link");
  await expect(runDetailWorkItemLink).toHaveCount(1);
  await expect(runDetailWorkItemLink).toHaveText("#891");
  await expect(runDetailWorkItemLink).toHaveAttribute("href", "https://github.com/kontourai/flow-agents/issues/891");
  await expect(page.locator(".run-detail-source-refs code.source-ref-text", { hasText: "feature/checkout-banner" })).toBeVisible();
  // The unsafe javascript: ref renders as text too -- never a link, anywhere.
  await expect(page.locator(".run-detail-source-refs code.source-ref-text", { hasText: "evil-actor" })).toBeVisible();
  await expect(page.locator(".run-detail-source-refs a", { hasText: "evil-actor" })).toHaveCount(0);
  // Deterministic order: work-item chip appears before the assignment chips,
  // regardless of the fixture's own (deliberately out-of-order) input order.
  await expect(sourceRefs.nth(0)).toContainText("#891");

  // Never a live javascript: href anywhere on the page.
  const jsHrefs = await page.locator('a[href^="javascript:"]').count();
  expect(jsHrefs).toBe(0);

  expect(consoleErrors).toEqual([]);
});
