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
  // Pipeline with a surface.claim expect that carries a trustReport
  pipeline: {
    runId: "run-dag-demo-1",
    runLabel: "checkout-retry-banner (dag-demo-1)",
    runStatus: "running",
    isDag: true,
    currentStageId: "implement",
    stages: [
      { id: "implement", label: "implement", order: 2, status: "current", gates: [
        {
          id: "implement-gate",
          label: "implement-gate",
          status: "waiting",
          expects: [
            {
              id: "impl-diff",
              label: "Implementation scoped diff",
              required: true,
              kind: "surface.claim",
              trustReport: {
                schemaVersion: 3,
                id: "surface-test-report",
                generatedAt: "2026-06-08T15:00:00.000Z",
                source: "ci/main",
                claims: [
                  {
                    id: "impl-diff",
                    subjectType: "artifact",
                    subjectId: "checkout-retry-banner",
                    surface: "ci/main",
                    claimType: "implementation.scoped-diff",
                    fieldOrBehavior: "implementation.scoped-diff",
                    value: true,
                    status: "verified",
                    createdAt: "2026-06-08T15:00:00.000Z",
                    updatedAt: "2026-06-08T15:00:00.000Z",
                    impactLevel: "high",
                  },
                ],
                evidence: [
                  {
                    id: "ev-impl-diff-1",
                    claimId: "impl-diff",
                    evidenceType: "test_output",
                    method: "validation",
                    sourceRef: "ci/main",
                    excerptOrSummary: "Scoped diff: 14 files changed, all within the checkout module.",
                    observedAt: "2026-06-08T15:00:00.000Z",
                    collectedBy: "ci/main",
                    passing: true,
                    supportStrength: "entails",
                  },
                ],
                policies: [],
                events: [],
                identityLinks: [],
                claimGroups: [],
                authorityTrace: [],
                evidenceRequirementsByClaimId: {},
                transparencyGaps: [],
                changeRecords: [],
                subjectGroups: [],
                claimGroupRollups: [],
                summary: {
                  totalClaims: 1,
                  byStatus: { unknown: 0, proposed: 0, assumed: 0, verified: 1, stale: 0, disputed: 0, superseded: 0, rejected: 0 },
                  bySurface: { "ci/main": 1 },
                  confidenceBasis: { sourceQuality: {}, reviewerAuthority: {}, evidenceStrength: {}, corroboratedClaims: 0, averageExtractionConfidence: null, freshnessAtRisk: [], conflictedClaims: [] },
                  transparencyGapsByType: { contradiction: 0, provenance_gap: 0, policy_violation: 0, freshness_breach: 0, corroboration_absent: 0, unsupported_inference: 0 },
                  highImpactUnsupported: [],
                  staleClaims: [],
                  disputedClaims: [],
                  recomputeNeededClaims: [],
                },
              },
            },
          ],
        },
      ], reason: "Awaiting evidence for implement-gate" },
    ],
    edges: [],
  },
  // Flow's already-derived console projection for the active run. Passed through
  // read-only; the console mounts <flow-run-panel> from it (no in-browser
  // derivation). The evidence carries a pre-derived bundle_report so the panel
  // nests a <surface-trust-panel>, and an external_link references a child run
  // so the drill-in can surface the child's own <flow-run-panel>.
  flowProjection: {
    schema_version: "1",
    run: {
      run_id: "run-parent-1",
      definition_id: "checkout-retry-banner",
      definition_version: "1",
      subject: "checkout-retry-banner (parent run)",
      status: "running",
      current_step: "implement",
      updated_at: "2026-06-08T15:00:00.000Z",
      params: {},
    },
    definition: { id: "checkout-retry-banner", version: "1", title: "Checkout retry banner", description: null, raw: {} },
    steps: [
      { id: "design", index: 0, label: "design", next: "implement", gates: ["design-gate"], raw: {} },
      { id: "implement", index: 1, label: "implement", next: null, gates: ["parent-implement-gate"], raw: {} },
    ],
    current_step: "implement",
    open_gates: ["parent-implement-gate"],
    gates: [
      {
        id: "design-gate", step_id: "design", status: "pass", summary: "Design approved", is_open: false,
        expectations: [], evidence_refs: [], evidence: [], missing: [], optional_missing: [],
        matched_expectations: [], raw: {},
      },
      {
        id: "parent-implement-gate", step_id: "implement", status: "waiting", summary: "Awaiting scoped diff evidence", is_open: true,
        expectations: [
          { id: "parent-impl-diff", gate_id: "parent-implement-gate", kind: "trust.bundle", required: true, description: "Implementation scoped diff", raw: {} },
        ],
        evidence_refs: ["ev-parent-impl-diff"],
        evidence: [
          {
            id: "ev-parent-impl-diff",
            gate_id: "parent-implement-gate",
            kind: "trust.bundle",
            requested_kind: "trust.bundle",
            status: "verified",
            expectation_ids: ["parent-impl-diff"],
            producer: "ci/main",
            authority_trace: null,
            authority_traces: [],
            stored_path: null,
            original_path: null,
            route_reason: null,
            claim: null,
            trust_artifact: null,
            diagnostics: null,
            // Pre-derived Surface TrustReport — the panel mounts <surface-trust-panel>.
            bundle_report: {
              schemaVersion: 3,
              id: "parent-surface-report",
              generatedAt: "2026-06-08T15:00:00.000Z",
              source: "ci/main",
              claims: [
                {
                  id: "parent-impl-diff", subjectType: "artifact", subjectId: "checkout-retry-banner", surface: "ci/main",
                  claimType: "implementation.scoped-diff", fieldOrBehavior: "implementation.scoped-diff", value: true,
                  status: "verified", createdAt: "2026-06-08T15:00:00.000Z", updatedAt: "2026-06-08T15:00:00.000Z", impactLevel: "high",
                },
              ],
              evidence: [
                {
                  id: "ev-parent-bundle-1", claimId: "parent-impl-diff", evidenceType: "test_output", method: "validation",
                  sourceRef: "ci/main", excerptOrSummary: "Scoped diff: 14 files changed, all within the checkout module.",
                  observedAt: "2026-06-08T15:00:00.000Z", collectedBy: "ci/main", passing: true, supportStrength: "entails",
                },
              ],
              policies: [], events: [], identityLinks: [], claimGroups: [], authorityTrace: [],
              evidenceRequirementsByClaimId: {}, transparencyGaps: [], changeRecords: [], subjectGroups: [], claimGroupRollups: [],
              summary: {
                totalClaims: 1,
                byStatus: { unknown: 0, proposed: 0, assumed: 0, verified: 1, stale: 0, disputed: 0, superseded: 0, rejected: 0 },
                bySurface: { "ci/main": 1 },
                confidenceBasis: { sourceQuality: {}, reviewerAuthority: {}, evidenceStrength: {}, corroboratedClaims: 0, averageExtractionConfidence: null, freshnessAtRisk: [], conflictedClaims: [] },
                transparencyGapsByType: { contradiction: 0, provenance_gap: 0, policy_violation: 0, freshness_breach: 0, corroboration_absent: 0, unsupported_inference: 0 },
                highImpactUnsupported: [], staleClaims: [], disputedClaims: [], recomputeNeededClaims: [],
              },
            },
            // External link referencing a CHILD run — drives the drill-down.
            external_links: [
              { id: "run-child-1", kind: "artifact", label: "Child run: dependency upgrade", source: "flow", target_id: "run-child-1" },
            ],
            raw: {},
          },
        ],
        missing: ["parent-impl-diff"], optional_missing: [], matched_expectations: [], raw: {},
      },
    ],
    expectations: [],
    evidence: [],
    exceptions: [],
    transitions: [],
    route_backs: [],
    external_links: [],
    next_action: "Attach the scoped-diff evidence bundle to parent-implement-gate.",
    continuation: "",
    report: null,
  },
  // Pre-fetched child-run projection (read-through), keyed by child run_id. Its
  // status is "stale" so the drill-in surfaces a child going stale on the parent.
  flowChildProjections: {
    "run-child-1": {
      schema_version: "1",
      run: {
        run_id: "run-child-1",
        definition_id: "dependency-upgrade",
        definition_version: "1",
        subject: "dependency upgrade (child run)",
        status: "stale",
        current_step: "verify",
        updated_at: "2026-06-08T14:30:00.000Z",
        params: {},
      },
      definition: { id: "dependency-upgrade", version: "1", title: "Dependency upgrade", description: null, raw: {} },
      steps: [
        { id: "verify", index: 0, label: "verify", next: null, gates: ["child-verify-gate"], raw: {} },
      ],
      current_step: "verify",
      open_gates: [],
      gates: [
        {
          id: "child-verify-gate", step_id: "verify", status: "stale", summary: "Child evidence went stale", is_open: false,
          expectations: [], evidence_refs: [], evidence: [], missing: [], optional_missing: [],
          matched_expectations: [], raw: {},
        },
      ],
      expectations: [], evidence: [], exceptions: [], transitions: [], route_backs: [],
      external_links: [], next_action: null, continuation: "", report: null,
    },
  },
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
            details: [
              { label: "Artifact", value: "provider-settings.md" },
              { label: "Project", value: "kontour-console" },
            ],
          },
          {
            slug: "shape-surface-telemetry",
            title: "Shape Surface telemetry",
            status: "done",
            updatedAt: "2026-06-08T14:59:00.000Z",
            attributes: { toolName: "read_file", project: "surface" },
            details: [{ label: "Artifact", value: "surface-telemetry.md" }],
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
      project: "kontour-console",
      attributes: {
        flow: "builder.shape",
        project: "kontour-console",
        status: "execution",
      },
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
  await expect(page.getByRole("main")).toContainText("Operating plane");
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

  await page.getByRole("button", { name: "Connection" }).click();
  await page.getByLabel("Hub URL").fill("http://127.0.0.1:4747");
  await page.getByRole("button", { name: "Reconnect" }).click();

  await page.getByRole("button", { name: "Connection" }).click();
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
  await expect(page.getByRole("main")).toContainText("provider-settings.md");
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
  await page.getByRole("button", { name: "execute_bash 18" }).click();
  await expect(page.getByLabel("Telemetry filters")).toContainText("Tools: execute_bash");
  await expect(page.locator(".telemetry-recent")).not.toContainText("read_file");
  await expect(page.getByRole("main")).toContainText("1 visible / 1 matched");
  await page.getByRole("button", { name: "read_file 3" }).click();
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
  await page.getByRole("button", { name: /<img src=x onerror=.* 1/ }).click();
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

test("syncs telemetry query state with URL and browser history", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/telemetry?preset=24h&q=read_file&filter=tools:read_file&limit=24&sort=desc");

  await expect(page.getByRole("button", { name: "Telemetry", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("textbox", { name: "Search" })).toHaveValue("read_file");
  await expect(page.getByLabel("Telemetry filters")).toContainText("Tools: read_file");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["tools:read_file"]);
  await page.getByRole("button", { name: "Last 15m" }).click();
  await expect(page).toHaveURL(/preset=15m/);
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Search" })).toHaveValue("read_file");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.preset)).toBe("24h");
  expect(consoleErrors).toEqual([]);
});

test("saves applies reloads and deletes telemetry query presets safely", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/telemetry");
  await page.evaluate(() => window.localStorage.setItem("kontour.console.telemetry.presets.v1", "{broken"));
  await page.reload();
  await expect(page.getByLabel("Saved telemetry presets")).toBeVisible();
  await page.evaluate(() => window.localStorage.setItem("kontour.console.telemetry.presets.v1", JSON.stringify([{
    version: 1,
    name: "Broken shape",
    query: { filters: { facetId: "tools", value: "read_file" } },
    createdAt: "2026-06-08T15:00:00.000Z",
    updatedAt: "2026-06-08T15:00:00.000Z",
  }])));
  await page.reload();
  await expect(page.getByRole("button", { name: "Broken shape", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search" }).fill("read_file");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: /Open Tools drilldown read_file/ }).click();
  await page.getByRole("textbox", { name: "Preset" }).fill("Read tools");
  await page.getByRole("button", { name: "Save" }).click();
  const stored = await page.evaluate(() => window.localStorage.getItem("kontour.console.telemetry.presets.v1"));
  expect(stored).toContain("\"name\":\"Read tools\"");
  expect(stored).toContain("\"query\"");
  expect(stored).not.toContain("evt-telemetry-1");

  await page.reload();
  await expect(page.getByRole("button", { name: "Read tools", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Read tools", exact: true }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.q)).toBe("read_file");
  await page.getByRole("button", { name: "Delete preset Read tools" }).click();
  await expect(page.getByRole("button", { name: "Read tools", exact: true })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("opens and refreshes telemetry dimension drilldown routes", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/telemetry/tools/read_file?preset=24h&q=read");
  await expect(page.getByLabel("Telemetry drilldown")).toContainText("read_file");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["tools:read_file"]);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page).toHaveURL(/\/telemetry\/tools\/read_file/);
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["tools:read_file"]);
  await page.evaluate(() => window.localStorage.setItem("kontour.console.telemetry.presets.v1", JSON.stringify([{
    version: 1,
    name: "Search execute",
    query: { preset: "24h", q: "execute", limit: 24, sort: "desc" },
    createdAt: "2026-06-08T15:00:00.000Z",
    updatedAt: "2026-06-08T15:00:00.000Z",
  }])));
  await page.reload();
  await page.getByRole("button", { name: "Search execute", exact: true }).click();
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["tools:read_file"]);
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.q)).toBe("execute");
  await page.getByRole("button", { name: "Remove Tools filter read_file" }).click();
  await expect(page).toHaveURL(/\/telemetry($|\?)/);
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual([]);
  await page.reload();
  await expect(page.getByLabel("Telemetry drilldown")).toHaveCount(0);
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual([]);

  await page.goto("/telemetry/projects/kontour-console?preset=24h");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["projects:kontour-console"]);
  await page.goto("/telemetry/flows/builder.shape?preset=24h");
  await expect(page.getByLabel("Telemetry drilldown")).toContainText("builder.shape");
  await expect.poll(() => lastTelemetryRequest(page).then((request) => request?.filters)).toEqual(["flows:builder.shape"]);
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
  await page.getByRole("button", { name: /<img src=x onerror=.* 1/ }).click();
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

test("renders embedded surface-trust-panel in the gate drill-in for a surface.claim expect with trustReport", async ({ page }) => {
  const consoleErrors = await loadConsole(page);

  // The default view is "operate" which shows the pipeline.
  // The implement stage card is in the visual pipeline DAG (aria-hidden for screen readers,
  // since the accessible <ol> list duplicates the info). Use CSS selectors to click it.
  await expect(page.getByRole("main")).toContainText("implement");

  // Click the implement stage card via its CSS class (the visual card is aria-hidden)
  const implementCard = page.locator(".pipeline-stage--current").first();
  await expect(implementCard).toBeVisible();
  await implementCard.click();
  await expect(page.locator(".node-detail-drawer")).toBeVisible();

  // The expect item for impl-diff should be present (data-claim-id attribute).
  // It appears in both the "needs" section and the gate detail section; .first() is fine.
  await expect(page.locator("[data-claim-id='impl-diff']").first()).toBeVisible();

  // The "view trust panel" toggle button should be present for surface.claim expects with trustReport
  const trustToggle = page.locator(".trust-panel-toggle").first();
  await expect(trustToggle).toBeVisible();

  // Expand the trust panel
  await trustToggle.click();

  // The <surface-trust-panel> custom element should be present and have the report set
  const panelEl = page.locator("surface-trust-panel").first();
  await expect(panelEl).toBeVisible();

  // Verify the element is the right custom element
  const tagName = await panelEl.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName).toBe("surface-trust-panel");

  // Verify the .report property was set (the TrustPanelRow sets it via useEffect)
  const hasReport = await panelEl.evaluate((el) => {
    return (el as HTMLElement & { report?: unknown }).report !== undefined;
  });
  expect(hasReport).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test("embeds flow-run-panel rendering the run graph, gates, evidence, and drilling into a referenced child", async ({ page }) => {
  const consoleErrors = await loadConsole(page);

  // The <flow-run-panel> custom element mounts in the operate view from the
  // pre-derived projection (no click needed — it sits below the stepper).
  const panel = page.locator("flow-run-panel").first();
  await expect(panel).toBeVisible();

  const tagName = await panel.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName).toBe("flow-run-panel");

  // The .projection property was set imperatively via the ref.
  const hasProjection = await panel.evaluate(
    (el) => (el as HTMLElement & { projection?: unknown }).projection !== undefined &&
      (el as HTMLElement & { projection?: unknown }).projection !== null,
  );
  expect(hasProjection).toBe(true);

  // The element renders into a shadow root. Reach in to assert graph + gates +
  // the nested <surface-trust-panel> from the pre-derived bundle_report.
  const shadow = await panel.evaluate((el) => {
    const root = (el as HTMLElement).shadowRoot;
    if (!root) return null;
    return {
      status: root.querySelector('[data-testid="flow-run-panel-status"]')?.textContent ?? "",
      nodeCount: root.querySelectorAll('[data-testid="flow-console-node"]').length,
      gateCount: root.querySelectorAll('[data-testid="flow-run-panel-gate"]').length,
      hasSurfacePanel: Boolean(root.querySelector("surface-trust-panel")),
      text: root.textContent ?? "",
    };
  });
  expect(shadow).not.toBeNull();
  expect(shadow!.status).toContain("running");
  expect(shadow!.nodeCount).toBe(2); // design + implement steps (process graph)
  expect(shadow!.gateCount).toBe(2); // design-gate + parent-implement-gate
  expect(shadow!.hasSurfacePanel).toBe(true); // nested surface trust panel per bundle
  expect(shadow!.text).toContain("implement");
  expect(shadow!.text).toContain("Attach the scoped-diff evidence bundle"); // next action

  // Drill-down parent → child: the referenced child run is listed and drillable.
  const childToggle = page.locator("[data-child-run-id='run-child-1']").first();
  await expect(childToggle).toBeVisible();
  await childToggle.click();

  // A SECOND <flow-run-panel> mounts for the child, fed the child projection
  // (read-through, not re-derivation). The child's stale status surfaces here.
  const childDetail = page.locator("[data-child-detail-for='run-child-1']");
  await expect(childDetail).toBeVisible();
  const childPanel = childDetail.locator("flow-run-panel").first();
  await expect(childPanel).toBeVisible();
  const childShadowText = await childPanel.evaluate((el) => {
    const root = (el as HTMLElement).shadowRoot;
    return {
      status: root?.querySelector('[data-testid="flow-run-panel-status"]')?.textContent ?? "",
      text: root?.textContent ?? "",
    };
  });
  expect(childShadowText.status).toContain("stale"); // child going stale surfaces on the parent
  expect(childShadowText.text).toContain("verify");

  expect(consoleErrors).toEqual([]);
});

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
