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

test.beforeEach(async ({ page }) => {
  await installHubMock(page);
});

test("renders the console operating plane from hub events", async ({ page }) => {
  const consoleErrors = await loadConsole(page);

  await expect(page).toHaveTitle("Kontour Console");
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

  expect(consoleErrors).toEqual([]);
});

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
          this.dispatchEvent(new MessageEvent("state", { data: JSON.stringify(state) }));
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
  }, hubState);
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
  }
}
