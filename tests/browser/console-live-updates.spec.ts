import { expect, test, type Page } from "@playwright/test";

// console#252: live SSE-driven updates. `console-ui.spec.ts`'s MockEventSource
// fires exactly one "state" event and never again, so it can't exercise either
// behavior this file covers:
//   1. a burst of SSE events is throttled/coalesced into at most one telemetry
//      refetch per ~1.5s window (App.tsx's useThrottledRefresh), not one HTTP
//      request per event;
//   2. the UI recovers from a dropped/reopened SSE connection without any user
//      action (EventSource's native browser reconnect, which this repo already
//      relies on for the no-auth/cookie stream path).

const baseState = {
  generatedAt: "2026-07-20T12:00:00.000Z",
  currentStage: "Live updates check",
  source: { mode: "test", streamIds: ["live"], acceptedEventCount: 1, duplicateEventCount: 0 },
  processes: [{ id: "proc-1", label: "Live worker", status: "running", updatedAt: "2026-07-20T12:00:00.000Z" }],
  gates: [],
  claims: [],
  actions: [],
  learnings: [],
  timeline: [],
};

const telemetryBase = {
  generatedAt: "2026-07-20T12:00:00.000Z",
  totals: { recordCount: 1, sessionCount: 1, eventTypeCounts: { "tool.invoke": 1 }, productRecordCount: 0 },
  analytics: { facets: [], flows: [] },
  sources: [],
  records: [],
  warnings: [],
  query: { preset: "live", limit: 24, sort: "desc", filters: [] },
  pagination: { returnedCount: 0, matchedCount: 0, totalMatchedCount: 0, limit: 24, offset: 0, nextOffset: null, hasMore: false },
};

async function installControllableMock(page: Page): Promise<void> {
  await page.addInitScript((fixtures) => {
    window.__kontourTelemetryFetchCount = 0;
    window.__kontourEventSourceInstances = [];

    class ControllableEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = ControllableEventSource.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        window.__kontourEventSourceInstances?.push(this);
        window.setTimeout(() => {
          this.readyState = ControllableEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(fixtures.state) }));
        }, 0);
      }

      close(): void {
        this.readyState = ControllableEventSource.CLOSED;
      }

      emitAccepted(recordId: string): void {
        this.dispatchEvent(
          new MessageEvent("record.accepted", { data: JSON.stringify({ delivery: { recordId }, state: fixtures.state }) })
        );
      }

      // Simulates an idle/network drop followed by the browser's native
      // EventSource auto-reconnect (readyState goes CONNECTING, not CLOSED,
      // while the reconnect is in flight) — exactly what a real dropped
      // connection looks like to `wireEventSource` in hubClient.ts.
      emitDropThenReopen(nextState: unknown, delayMs: number): void {
        this.readyState = ControllableEventSource.CONNECTING;
        this.dispatchEvent(new Event("error"));
        window.setTimeout(() => {
          this.readyState = ControllableEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(nextState) }));
        }, delayMs);
      }
    }

    window.EventSource = ControllableEventSource as unknown as typeof EventSource;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href);
      if (url.pathname === "/api/telemetry") {
        window.__kontourTelemetryFetchCount = (window.__kontourTelemetryFetchCount || 0) + 1;
        return Promise.resolve(
          new Response(JSON.stringify(fixtures.telemetry), { status: 200, headers: { "content-type": "application/json" } })
        );
      }
      return nativeFetch(input, init);
    };
  }, { state: baseState, telemetry: telemetryBase });
}

test("a burst of SSE record.accepted events is throttled into at most one trailing telemetry refetch, not one per event", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installControllableMock(page);

  await page.goto("/");
  await expect(page.getByRole("main")).toContainText("Live updates check");
  await page.waitForFunction(() => (window.__kontourTelemetryFetchCount ?? 0) >= 1);
  const before = await page.evaluate(() => window.__kontourTelemetryFetchCount ?? 0);

  // Five accepted-record events in immediate succession — a real burst.
  await page.evaluate(() => {
    const source = window.__kontourEventSourceInstances?.at(-1);
    for (let i = 0; i < 5; i += 1) source?.emitAccepted(`evt-${i}`);
  });

  // Well inside the throttle window: the burst has produced at most the one
  // leading-edge fetch, never five (one per event would be a bug).
  await page.waitForTimeout(300);
  const duringBurst = await page.evaluate(() => window.__kontourTelemetryFetchCount ?? 0);
  expect(duringBurst - before).toBeLessThanOrEqual(1);

  // Past the throttle window: the trailing fire for the LATEST event has
  // landed — never zero (the last event must not be silently dropped), and
  // never one-per-event (5 events -> at most 2 fetches total: leading + trailing).
  await page.waitForTimeout(1700);
  const afterWindow = await page.evaluate(() => window.__kontourTelemetryFetchCount ?? 0);
  expect(afterWindow - before).toBeGreaterThanOrEqual(1);
  expect(afterWindow - before).toBeLessThanOrEqual(2);

  expect(consoleErrors).toEqual([]);
});

test("recovers from a dropped SSE connection without any user action once it reopens", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await installControllableMock(page);

  await page.goto("/");
  await expect(page.locator(".conn-dot")).toHaveAttribute("data-status", "connected");
  await expect(page.getByRole("main")).toContainText("Live worker");

  await page.evaluate((nextState) => {
    const source = window.__kontourEventSourceInstances?.at(-1);
    source?.emitDropThenReopen(nextState, 50);
  }, { ...baseState, currentStage: "Reconnected and fresh" });

  // The drop is observable (never silently ignored)...
  await expect(page.locator(".conn-dot")).not.toHaveAttribute("data-status", "connected");
  // ...and recovery happens on its own, no reload/click required.
  await expect(page.locator(".conn-dot")).toHaveAttribute("data-status", "connected", { timeout: 5000 });
  await expect(page.getByRole("main")).toContainText("Reconnected and fresh");

  expect(consoleErrors).toEqual([]);
});

declare global {
  interface Window {
    __kontourTelemetryFetchCount?: number;
    __kontourEventSourceInstances?: Array<{
      emitAccepted(recordId: string): void;
      emitDropThenReopen(nextState: unknown, delayMs: number): void;
    }>;
  }
}
