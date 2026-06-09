import { expect, test, type Page } from "@playwright/test";

const hubState = {
  generatedAt: "2026-06-08T15:00:00.000Z",
  currentStage: "Survey review ready",
  source: {
    mode: "test",
    streamIds: ["survey.review"],
    acceptedEventCount: 7,
    duplicateEventCount: 1,
    lastAcceptedEventId: "evt-007",
  },
  processes: [
    {
      id: "process-survey-review",
      label: "Survey claim review",
      status: "running",
      currentStep: { id: "review", label: "Review submitted claims" },
      percentComplete: 62,
      updatedAt: "2026-06-08T15:00:00.000Z",
      claimRefs: [{ product: "surface", kind: "claim", id: "claim-release-readiness", label: "Release readiness claim" }],
    },
  ],
  gates: [
    {
      id: "gate-authority",
      label: "Authority evidence present",
      status: "blocked",
      missingEvidence: ["authority trace"],
    },
  ],
  claims: [
    {
      id: "claim-release-readiness",
      label: "Release evidence supports merge readiness",
      status: "proposed",
      freshness: { status: "fresh" },
      materiality: "high",
      lastVerifiedAt: "2026-06-08T14:58:00.000Z",
      sourceRef: { product: "surface", kind: "claim", id: "claim-release-readiness" },
    },
  ],
  actions: [
    {
      id: "action-open-surface",
      label: "Open Surface claim",
      readOnly: true,
      authority: { product: "surface", command: "inspect claim" },
    },
  ],
  learnings: [
    {
      id: "learning-selection-rejected",
      family: "prompt-eval",
      summary: "Rejected candidates should preserve the current value.",
      confidence: 0.82,
      updatedAt: "2026-06-08T14:59:00.000Z",
      subjectRef: { product: "surface", kind: "claim", id: "claim-release-readiness" },
    },
  ],
  timeline: [
    {
      id: "timeline-1",
      type: "record.accepted",
      occurredAt: "2026-06-08T15:00:00.000Z",
      summary: "Survey review accepted into the console stream.",
      producer: { product: "survey" },
    },
  ],
};

const telemetryState = {
  generatedAt: "2026-06-08T15:01:00.000Z",
  totals: {
    recordCount: 42,
    sessionCount: 4,
    eventTypeCounts: {
      "tool.invoke": 18,
      "tool.result": 16,
      "agent.delegate": 6,
      "session.start": 2,
      "workflow.state": 9,
    },
    productRecordCount: 9,
  },
  sources: [
    {
      id: "flow-agents-full",
      kind: "jsonl",
      path: "../.telemetry/full.jsonl",
      status: "observed",
      recordCount: 42,
      warningCount: 0,
      warnings: [],
      lastObservedAt: "2026-06-08T15:01:00.000Z",
    },
  ],
  analytics: {
    facets: [
      { id: "projects", label: "Projects", counts: [{ name: "kontour-console", count: 24 }] },
      {
        id: "tools",
        label: "Tools",
        counts: [
          { name: "execute_bash", count: 18 },
          { name: "read_file", count: 3 },
          { name: "<img src=x onerror=\"window.__kontourConsoleXss=true\">", count: 1 },
        ],
      },
      { id: "runtimes", label: "Runtimes", counts: [{ name: "codex", count: 30 }] },
      { id: "agents", label: "Agents", counts: [{ name: "dev", count: 28 }] },
      { id: "models", label: "Models", counts: [{ name: "gpt-5.5", count: 30 }] },
      { id: "skills", label: "Skills", counts: [{ name: "deliver", count: 6 }] },
      { id: "events", label: "Events", counts: [{ name: "tool.invoke", count: 18 }] },
      { id: "hooks", label: "Hook events", counts: [{ name: "PreToolUse", count: 12 }] },
    ],
    flows: [
      {
        id: "builder.shape",
        label: "Builder shape",
        total: 2,
        items: [
          {
            slug: "shape-provider-settings",
            title: "Shape provider settings",
            status: "done",
            updatedAt: "2026-06-08T15:00:00.000Z",
            attributes: { toolName: "execute_bash", project: "kontour-console" },
          },
          {
            slug: "shape-surface-telemetry",
            title: "Shape Surface telemetry",
            status: "done",
            updatedAt: "2026-06-08T14:59:00.000Z",
            attributes: { toolName: "read_file", project: "surface" },
          },
        ],
      },
    ],
  },
  query: { preset: "live", limit: 24, sort: "desc", filters: [] },
  pagination: {
    returnedCount: 4,
    matchedCount: 4,
    totalMatchedCount: 4,
    limit: 24,
    offset: 0,
    nextOffset: null,
    hasMore: false,
  },
  records: [
    {
      eventId: "evt-telemetry-1",
      sourceId: "flow-agents-full",
      sourceKind: "runtime",
      eventType: "tool.invoke",
      observedAt: "2026-06-08T15:01:00.000Z",
      sessionId: "session-1",
      agentName: "dev",
      runtime: "codex",
      runtimeVersion: "codex-cli 0.138.0",
      model: "gpt-5.5",
      hookEventName: "PreToolUse",
      runtimeSessionId: "runtime-session-1",
      turnId: "turn-1",
      project: "kontour-console",
      cwd: "/Users/brian/dev/github/kontourai/kontour-console",
      toolName: "execute_bash",
      outcome: "accepted",
      attributes: {
        project: "kontour-console",
        cwd: "/Users/brian/dev/github/kontourai/kontour-console",
        runtimeVersion: "codex-cli 0.138.0",
        model: "gpt-5.5",
        feature: "query-controls",
      },
    },
    {
      eventId: "telemetry-task:state.json",
      sourceId: "flow-agents-sidecars",
      sourceKind: "workflow-sidecar",
      eventType: "workflow.state",
      observedAt: "2026-06-08T15:00:00.000Z",
      sessionId: "telemetry-task",
      status: "execution",
    },
    {
      eventId: "evt-telemetry-2",
      sourceId: "flow-agents-full",
      sourceKind: "runtime",
      eventType: "tool.invoke",
      observedAt: "2026-06-08T14:59:00.000Z",
      sessionId: "session-2",
      agentName: "dev",
      runtime: "codex",
      model: "gpt-5.5",
      hookEventName: "PreToolUse",
      runtimeSessionId: "runtime-session-2",
      turnId: "turn-2",
      project: "surface",
      cwd: "/Users/brian/dev/github/kontourai/surface",
      toolName: "read_file",
      outcome: "accepted",
      attributes: {
        project: "surface",
        cwd: "/Users/brian/dev/github/kontourai/surface",
        feature: "surface-review",
      },
    },
    {
      eventId: "evt-telemetry-3",
      sourceId: "flow-agents-full",
      sourceKind: "runtime",
      eventType: "tool.invoke",
      observedAt: "2026-06-08T14:58:00.000Z",
      sessionId: "session-3",
      agentName: "dev",
      runtime: "codex",
      model: "gpt-5.5",
      project: "kontour-console",
      cwd: "/Users/brian/dev/github/kontourai/kontour-console",
      toolName: "<img src=x onerror=\"window.__kontourConsoleXss=true\">",
      outcome: "accepted",
      attributes: {
        secretToken: "super-secret-token",
        note: "</pre><script>window.__kontourConsoleXss=true</script>",
      },
    },
  ],
  warnings: [],
};

test.beforeEach(async ({ page }) => {
  await installHubMock(page);
});

test("renders the console operating plane from hub events", async ({ page }) => {
  const consoleErrors = await loadConsole(page);

  await expect(page).toHaveTitle("Console");
  await expect(page.getByRole("main")).toContainText("Local operating plane");
  await expect(page.getByRole("main")).toContainText("connected");
  await expect(page.getByLabel("Current stage")).toContainText("Survey review ready");
  await expect(page.getByRole("main")).toContainText("Survey claim review");
  await expect(page.getByRole("main")).toContainText("Authority evidence present");
  await expect(page.getByRole("main")).toContainText("Release evidence supports merge readiness");
  await expect(page.getByRole("main")).toContainText("Open Surface claim");
  await expect(page.getByRole("main")).toContainText("Rejected candidates should preserve the current value.");
  await expect(page.getByRole("main")).toContainText("Survey review accepted into the console stream.");
  await assertTokenStylesResolved(page);
  expect(consoleErrors).toEqual([]);
});

test("reconnects to a submitted hub URL without leaving the console shell", async ({ page }) => {
  const consoleErrors = await loadConsole(page);

  await page.getByLabel("Hub URL").fill("http://127.0.0.1:4747");
  await page.getByRole("button", { name: "Reconnect" }).click();

  await expect(page.getByLabel("Hub URL")).toHaveValue("http://127.0.0.1:4747");
  await expect(page.getByRole("main")).toContainText("Survey review ready");
  const urls = await page.evaluate(() => window.__kontourConsoleEventSourceUrls ?? []);
  expect(urls).toContain("http://127.0.0.1:4747/stream");
  expect(consoleErrors).toEqual([]);
});

test("renders telemetry usage from the console API", async ({ page }) => {
  const consoleErrors = await loadConsole(page);

  await page.getByRole("button", { name: "Telemetry" }).click();

  await expect(page.getByRole("main")).toContainText("Runtime and workflow usage");
  await expect(page.getByLabel("Telemetry totals")).toContainText("42");
  await expect(page.getByRole("main")).toContainText("flow-agents-full");
  await expect(page.getByRole("main")).toContainText("Projects");
  await expect(page.getByRole("main")).toContainText("kontour-console");
  await expect(page.getByRole("main")).toContainText("gpt-5.5");
  await expect(page.getByRole("main")).toContainText("Builder shape");
  await expect(page.getByRole("main")).toContainText("deliver");
  await expect(page.getByRole("main")).toContainText("execute_bash");
  await expect(page.getByRole("main")).toContainText("read_file");
  await expect(page.getByLabel("Telemetry query controls")).toContainText("Last 15m");
  await page.getByRole("button", { name: "Last 15m" }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.preset)).toBe("15m");
  await page.getByLabel("From", { exact: true }).fill("2026-06-08T14:00");
  await page.getByLabel("To", { exact: true }).fill("2026-06-08T15:00");
  await page.getByRole("button", { name: "Custom" }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.preset)).toBe("custom");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.from)).toBe(localDateTimeToIso("2026-06-08T14:00"));
  await page.getByLabel("Search").fill("read_file");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.q)).toBe("read_file");
  await expect(page.locator(".telemetry-recent")).toContainText("read_file");
  await expect(page.locator(".telemetry-recent")).not.toContainText("execute_bash");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.preset)).toBe("live");
  await page.getByRole("button", { name: /tool.invoke/ }).click();
  await expect(page.getByLabel("Telemetry filters")).toContainText("Events: tool.invoke");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["events:tool.invoke"]);
  await expect(page.getByRole("main")).toContainText("3 visible / 3 matched");
  await page.locator(".dimension-row", { hasText: "Outcomes" }).getByRole("button", { name: /^accepted/ }).click();
  await expect(page.getByLabel("Telemetry filters")).toContainText("Outcomes: accepted");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["events:tool.invoke", "outcomes:accepted"]);
  await expect(page.getByRole("main")).toContainText("3 visible / 3 matched");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: /kontourai\/surface/ }).click();
  await expect(page.getByLabel("Telemetry filters")).toContainText("Project directories: /Users/brian/dev/github/kontourai/surface");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["cwd:/Users/brian/dev/github/kontourai/surface"]);
  await expect(page.locator(".telemetry-recent")).toContainText("read_file");
  await expect(page.locator(".telemetry-recent")).not.toContainText("execute_bash");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: /execute_bash/ }).click();
  await expect(page.getByLabel("Telemetry filters")).toContainText("Tools: execute_bash");
  await expect(page.locator(".telemetry-recent")).not.toContainText("read_file");
  await expect(page.getByRole("main")).toContainText("1 visible / 1 matched");
  await page.getByRole("button", { name: /read_file/ }).click();
  await expect(page.locator(".telemetry-recent")).toContainText("read_file");
  await expect(page.getByRole("main")).toContainText("2 visible / 2 matched");
  await expect(page.locator(".bar-row", { hasText: "execute_bash" }).first()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^kontour-console/ }).click();
  await expect(page.getByLabel("Telemetry filters")).toContainText("Projects: kontour-console");
  await expect(page.getByRole("main")).toContainText("1 visible / 1 matched");
  await expect(page.locator(".telemetry-recent")).not.toContainText("read_file");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator(".telemetry-recent")).toContainText("read_file");
  await page.getByLabel("Search").fill("execute");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.offset)).toBe("24");
  await expect(page.locator(".telemetry-recent")).toContainText("execute_bash_page_2");
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.offset ?? "0")).toBe("0");
  await openFirstTelemetryDetails(page);
  await expect(page.getByRole("main")).toContainText("/Users/brian/dev/github/kontourai/kontour-console");
  await expect(page.getByRole("main")).toContainText("codex-cli 0.138.0");
  await expect(page.getByRole("main")).toContainText('"eventId": "evt-telemetry-1"');
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: /window.__kontourConsoleXss=true/ }).click();
  await openFirstTelemetryDetails(page);
  await expect(page.getByRole("main")).toContainText('"secretToken": "[redacted]"');
  await expect(page.getByRole("main")).not.toContainText("super-secret-token");
  await expect.poll(() => page.evaluate(() => window.__kontourConsoleXss)).toBe(false);
  expect(consoleErrors).toEqual([]);
});

test("opens telemetry directly from the browser route", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/telemetry");

  await expect(page.getByRole("button", { name: "Telemetry", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("main")).toContainText("Runtime and workflow usage");
  expect(consoleErrors).toEqual([]);
});

test("keeps the primary console sections within the mobile viewport", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium-mobile", "mobile-only layout check");
  const consoleErrors = await loadConsole(page);

  const viewport = page.viewportSize();
  const shellBox = await page.locator(".shell").boundingBox();
  const stageBox = await page.locator(".stage-band").boundingBox();
  expect(viewport).not.toBeNull();
  expect(shellBox).not.toBeNull();
  expect(stageBox).not.toBeNull();

  if (viewport && shellBox && stageBox) {
    expect(shellBox.x).toBeGreaterThanOrEqual(0);
    expect(stageBox.x).toBeGreaterThanOrEqual(0);
    expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  await page.getByRole("button", { name: "Telemetry", exact: true }).click();
  await page.getByRole("button", { name: /window.__kontourConsoleXss=true/ }).click();
  await openFirstTelemetryDetails(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(viewport).not.toBeNull();
  if (viewport) {
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  }

  expect(consoleErrors).toEqual([]);
});

async function openFirstTelemetryDetails(page: Page): Promise<void> {
  await page.locator("details.telemetry-details").first().evaluate((details) => {
    details.setAttribute("open", "");
  });
}

async function loadConsole(page: Page): Promise<string[]> {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Survey review ready");
  return consoleErrors;
}

async function installHubMock(page: Page): Promise<void> {
  await page.addInitScript((state) => {
    window.__kontourConsoleEventSourceUrls = [];
    window.__kontourConsoleXss = false;
    window.__kontourTelemetryRequests = [];

    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = MockEventSource.CONNECTING;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        window.__kontourConsoleEventSourceUrls?.push(this.url);
        window.setTimeout(() => {
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(state.hubState) }));
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
    const telemetryResponse = state.telemetry;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const parsedUrl = new URL(url, window.location.href);
      if (parsedUrl.pathname.endsWith("/api/telemetry")) {
        const filters = parsedUrl.searchParams.getAll("filter");
        window.__kontourTelemetryRequests?.push({
          preset: parsedUrl.searchParams.get("preset") ?? undefined,
          q: parsedUrl.searchParams.get("q") ?? undefined,
          filters,
          from: parsedUrl.searchParams.get("from") ?? undefined,
          to: parsedUrl.searchParams.get("to") ?? undefined,
          offset: parsedUrl.searchParams.get("offset") ?? undefined,
        });
        return Promise.resolve(new Response(JSON.stringify(queryTelemetry(telemetryResponse, parsedUrl.searchParams)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return nativeFetch(input, init);
    };

    function queryTelemetry(base: typeof telemetryResponse, params: URLSearchParams): typeof telemetryResponse {
      const filters = params.getAll("filter").map((filter) => {
        const separator = filter.indexOf(":");
        return { facetId: filter.slice(0, separator), value: filter.slice(separator + 1) };
      });
      const q = (params.get("q") || "").toLowerCase();
      const limit = Number(params.get("limit") || 24);
      const offset = Number(params.get("offset") || 0);
      let records = [...base.records];
      if (q) {
        records = records.filter((record) => JSON.stringify(record).toLowerCase().includes(q));
        if (q === "execute") {
          records = [
            ...records,
            ...Array.from({ length: 23 }, (_, index) => ({
              ...base.records[0],
              eventId: `evt-telemetry-extra-${index}`,
              observedAt: "2026-06-08T14:57:00.000Z",
              toolName: "execute_bash",
            })),
            {
              ...base.records[0],
              eventId: "evt-telemetry-page-2",
              observedAt: "2026-06-08T14:57:00.000Z",
              toolName: "execute_bash_page_2",
              attributes: { ...base.records[0].attributes, feature: "pagination" },
            },
          ];
        }
      }
      const groupedFilters = filters.reduce((groups: Record<string, string[]>, filter) => {
        groups[filter.facetId] = [...(groups[filter.facetId] || []), filter.value];
        return groups;
      }, {});
      for (const [facetId, values] of Object.entries(groupedFilters)) {
        records = records.filter((record) => values.some((value) => recordFacetValues(record, facetId).includes(value)));
      }
      const page = records.slice(offset, offset + limit);
      return {
        ...base,
        query: {
          preset: (params.get("preset") || "live") as typeof base.query.preset,
          q: params.get("q") || undefined,
          filters,
          limit,
          offset,
          sort: "desc",
        },
        pagination: {
          returnedCount: page.length,
          matchedCount: records.length,
          totalMatchedCount: records.length,
          limit,
          offset,
          nextOffset: offset + limit < records.length ? offset + limit : null,
          hasMore: offset + limit < records.length,
        },
        records: page,
      };
    }

    function recordFacetValues(record: typeof telemetryResponse.records[number], facetId: string): string[] {
      const attributes = record.attributes || {};
      const valuesByFacet: Record<string, Array<string | undefined>> = {
        projects: [record.project],
        cwd: [record.cwd],
        tools: [record.toolName],
        runtimes: [record.runtime],
        agents: [record.agentName],
        models: [record.model],
        events: [record.eventType],
        outcomes: [record.outcome || record.status || "unknown"],
        hooks: [record.hookEventName],
        sessions: [record.sessionId, record.runtimeSessionId],
      };
      const singular = facetId.endsWith("s") ? facetId.slice(0, -1) : facetId;
      return [...(valuesByFacet[facetId] || []), attributes[facetId], attributes[singular]].filter((value): value is string => typeof value === "string");
    }
  }, { hubState, telemetry: telemetryState });
}

async function lastTelemetryRequest(page: Page): Promise<Window["__kontourTelemetryRequests"][number] | undefined> {
  const requests = await page.evaluate(() => window.__kontourTelemetryRequests ?? []);
  return requests.at(-1);
}

function localDateTimeToIso(value: string): string {
  return new Date(value).toISOString();
}

async function assertTokenStylesResolved(page: Page): Promise<void> {
  const styles = await page.locator("body").evaluate((body) => {
    const computed = getComputedStyle(body);
    return {
      background: computed.backgroundColor,
      color: computed.color,
      fontFamily: computed.fontFamily,
    };
  });

  expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.fontFamily).not.toBe("");
}

declare global {
  interface Window {
    __kontourConsoleEventSourceUrls?: string[];
    __kontourConsoleXss?: boolean;
    __kontourTelemetryRequests?: Array<{
      preset?: string;
      q?: string;
      filters: string[];
      from?: string;
      to?: string;
      offset?: string;
    }>;
  }
}
