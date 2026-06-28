import { expect, test, type Page } from "@playwright/test";

// Regression coverage for the connection/auth flow — the gap that let "the console
// looks empty/dead until you find the hidden Connection popover and enter a token"
// ship unnoticed. The existing console-ui.spec.ts mocks an EventSource that always
// opens, so it can never observe the unauthenticated state. This spec uses an
// AUTH-AWARE hub mock: the stream/telemetry 401 without an Authorization header, so
// the UI must actually authenticate (token entered via the Connection popover) before
// the operating plane renders.

const operatingState = {
  generatedAt: "2026-06-28T19:35:00.000Z",
  currentStage: "Still waiting on Pull-work Gate.",
  source: { mode: "test", streamIds: ["suite-audit"], acceptedEventCount: 3, duplicateEventCount: 0 },
  processes: [
    { id: "proc-audit", label: "Suite audit remediation", status: "blocked", percentComplete: 35, currentStep: { id: "backlog", label: "42 issues shaped; awaiting pull-work" }, updatedAt: "2026-06-28T19:35:00.000Z" },
  ],
  gates: [{ id: "gate-backlog", label: "Backlog Gate", status: "passed", updatedAt: "2026-06-28T19:35:00.000Z" }],
  claims: [{ id: "claim-bugs", label: "9/9 correctness findings reproduced by running code", status: "verified", materiality: "high", lastVerifiedAt: "2026-06-28T19:30:00.000Z" }],
  evidence: [], learnings: [], inquiries: [], actions: [], links: [],
  timeline: [{ id: "t1", type: "gate.passed", occurredAt: "2026-06-28T19:35:00.000Z", summary: "Backlog Gate passed" }],
};

const telemetry = {
  generatedAt: "2026-06-28T19:35:00.000Z",
  totals: { recordCount: 3, sessionCount: 2, eventTypeCounts: { "builder-kit.shape.gate": 1 }, productRecordCount: 0 },
  sources: [{ id: "postgres-telemetry-events", kind: "runtime", path: "postgres", recordCount: 3, warningCount: 0, warnings: [] }],
  analytics: { facets: [{ id: "events", label: "Events", counts: [{ name: "builder-kit.shape.gate", count: 1 }] }], flows: [] },
  query: { preset: "live", limit: 24, sort: "desc", filters: [] },
  pagination: { returnedCount: 1, matchedCount: 1, totalMatchedCount: 1, limit: 24, offset: 0, nextOffset: null, hasMore: false },
  records: [{ eventId: "evt-1", sourceId: "postgres-telemetry-events", sourceKind: "runtime", eventType: "builder-kit.shape.gate", observedAt: "2026-06-28T19:35:00.000Z", sessionId: "suite-audit-remediation", outcome: "accepted", attributes: {} }],
  warnings: [],
};

async function installAuthAwareHubMock(page: Page): Promise<void> {
  await page.addInitScript((state) => {
    // EventSource cannot send an Authorization header, so an unauthenticated stream
    // attempt fails — model that as an immediate error (→ status disconnected).
    class MockEventSource extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      readyState = 0; readonly url: string;
      constructor(url: string | URL) { super(); this.url = String(url); window.setTimeout(() => { this.readyState = 2; this.dispatchEvent(new Event("error")); }, 0); }
      close() { this.readyState = 2; }
    }
    window.EventSource = MockEventSource as unknown as typeof EventSource;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), window.location.href).pathname;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const authed = Boolean(headers.authorization || headers.Authorization);
      if (pathname.endsWith("/session")) return Promise.resolve(new Response("", { status: 401 }));
      if (pathname.endsWith("/stream")) {
        if (!authed) return Promise.resolve(new Response("unauthorized", { status: 401 }));
        return Promise.resolve(new Response(`event: state\ndata: ${JSON.stringify(state.operatingState)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }));
      }
      if (pathname.endsWith("/api/telemetry")) {
        if (!authed) return Promise.resolve(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
        return Promise.resolve(new Response(JSON.stringify(state.telemetry), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return nativeFetch(input, init);
    };
  }, { operatingState, telemetry });
}

test.beforeEach(async ({ page }) => {
  // A fresh Playwright context already starts with empty localStorage; don't clear it
  // via addInitScript — that runs on every navigation (incl. reload) and would defeat
  // the persistence test below.
  await installAuthAwareHubMock(page);
});

test("shows a disconnected, empty operating plane until a token is entered", async ({ page }) => {
  await page.goto("/");
  // The bug's signature: no auth → disconnected, and the plane is empty (no gates/claims).
  await expect(page.locator(".conn-dot")).not.toHaveAttribute("data-status", "connected");
  await expect(page.getByRole("main")).toContainText(/Waiting for hub state|No gates|Nothing running/i);
  await expect(page.getByRole("main")).not.toContainText("Suite audit remediation");
});

test("renders the operating plane after authenticating via the Connection popover", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connection" }).click();
  await page.getByLabel("Tenant", { exact: true }).fill("kontour");
  await page.getByLabel("Token", { exact: true }).fill("test-token-1234567890");
  await page.getByRole("button", { name: "Reconnect" }).click();

  await expect(page.locator(".conn-dot")).toHaveAttribute("data-status", "connected", { timeout: 10_000 });
  await expect(page.getByRole("main")).toContainText("Suite audit remediation");
  await expect(page.getByRole("main")).toContainText("Backlog Gate");
  await expect(page.getByRole("main")).toContainText("9/9 correctness findings reproduced by running code");
  await page.screenshot({ path: "test-results/connection-operate-connected.png", fullPage: true });
});

test("persists the connection across a reload (connect once)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connection" }).click();
  await page.getByLabel("Tenant", { exact: true }).fill("kontour");
  await page.getByLabel("Token", { exact: true }).fill("test-token-1234567890");
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.locator(".conn-dot")).toHaveAttribute("data-status", "connected", { timeout: 10_000 });

  // The regression fix: a reload must NOT drop back to disconnected / re-prompt.
  await page.reload();
  await expect(page.locator(".conn-dot")).toHaveAttribute("data-status", "connected", { timeout: 10_000 });
  await expect(page.getByRole("main")).toContainText("Suite audit remediation");
});
