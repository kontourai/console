const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCurrentOperatingState,
  inspectFixtures
} = require("../src/console-foundation");

const rootDir = process.env.KONTOUR_REPO_ROOT || process.cwd();

test("replays Surface and Flow handoff events into current operating state", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item: any) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const state = buildCurrentOperatingState([stream], { generatedAt: "2026-06-03T10:01:45Z" });

  assert.equal(state.generatedAt, "2026-06-03T10:01:45Z");
  assert.equal(state.source.mode, "event_replay");
  assert.equal(state.source.acceptedEventCount, 6);
  assert.equal(state.source.duplicateEventCount, 0);
  assert.equal(state.source.lastAcceptedEventId, "evt-surface-flow-handoff-006");
  assert.equal(state.currentStage, "Provider directory freshness passed; Provider directory refresh can continue.");

  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].id, "run-provider-directory-refresh");
  assert.equal(state.processes[0].status, "running");
  assert.equal(state.processes[0].currentStep.id, "publish-refreshed-operating-state");
  assert.equal(state.processes[0].percentComplete, 74);
  assert.equal(state.processes[0].updatedAt, "2026-06-03T10:01:41Z");
  assert.equal(state.processes[0].sourceRef.uid, "flow-run-provider-directory-refresh");
  assert.equal(state.processes[0].claimRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(state.processes[0].nextActionRefs[0].uid, "flow-action-resume-provider-directory-refresh");

  assert.equal(state.gates.length, 1);
  assert.equal(state.gates[0].id, "gate-provider-directory-freshness");
  assert.equal(state.gates[0].status, "passed");
  assert.equal(state.gates[0].processRef.uid, "flow-run-provider-directory-refresh");
  assert.equal(state.gates[0].expectationRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(state.gates[0].evidenceRefs[0].uid, "surface-evidence-provider-directory-crawl-2026-06-03");

  assert.equal(state.claims.length, 1);
  assert.equal(state.claims[0].id, "claim-provider-directory-current");
  assert.equal(state.claims[0].status, "verified");
  assert.equal(state.claims[0].freshness.status, "fresh");
  assert.equal(state.claims[0].lastVerifiedAt, "2026-06-03T10:01:39Z");
  assert.equal(state.claims[0].sourceRef.apiVersion, "surface.kontour.ai/v1alpha1");

  assert.equal(state.evidence.length, 1);
  assert.equal(state.evidence[0].id, "evidence-provider-directory-crawl-2026-06-03");
  assert.equal(state.evidence[0].status, "available");
  assert.equal(state.evidence[0].claimRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(state.evidence[0].gateRefs[0].uid, "flow-gate-provider-directory-freshness");

  assert.equal(state.actions.length, 1);
  assert.equal(state.actions[0].id, "action-resume-provider-directory-refresh");
  assert.equal(state.actions[0].readOnly, true);
  assert.equal(state.actions[0].authority.command, "flow.run.resume");
  assert.equal(state.actions[0].subjectRefs[0].uid, "flow-run-provider-directory-refresh");

  const relations = new Set(state.links.map((link: any) => link.relation));
  assert.equal(relations.has("controls"), true);
  assert.equal(relations.has("blocks"), true);
  assert.equal(relations.has("evidenced_by"), true);
  assert.equal(state.timeline.length, 6);
  assert.equal(state.timeline[5].id, "evt-surface-flow-handoff-006");
});

test("replay accepts inspection reports and ignores duplicate event ids", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item: any) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const duplicated = {
    ...stream,
    events: [stream.events[0], ...stream.events]
  };

  const state = buildCurrentOperatingState({
    eventStreams: [duplicated]
  }, { generatedAt: "2026-06-03T10:01:45Z" });

  assert.equal(state.source.acceptedEventCount, 6);
  assert.equal(state.source.duplicateEventCount, 1);
  assert.equal(state.timeline[0].id, "evt-surface-flow-handoff-001");
  assert.equal(state.timeline[5].id, "evt-surface-flow-handoff-006");
});

test("replay orders accepted events by sequence before file order", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item: any) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const shuffled = {
    ...stream,
    events: [...stream.events].reverse()
  };

  const state = buildCurrentOperatingState([shuffled], { generatedAt: "2026-06-03T10:01:45Z" });

  assert.equal(state.timeline[0].id, "evt-surface-flow-handoff-001");
  assert.equal(state.timeline[5].id, "evt-surface-flow-handoff-006");
  assert.equal(state.gates[0].status, "passed");
});

test("replay does not promote non-run gate scope into a process ref", () => {
  const state = buildCurrentOperatingState([{
    relativePath: "gate-non-run-scope.jsonl",
    events: [
      {
        schema: "kontour.console.event",
        version: "0.1",
        id: "evt-gate-non-run-scope",
        type: "gate.opened",
        occurredAt: "2026-06-04T12:00:00Z",
        producer: { product: "flow", id: "flow-local" },
        subject: {
          product: "flow",
          kind: "gate",
          id: "gate-non-run-scope",
          label: "Gate with claim scope",
          scope: { product: "surface", kind: "claim", id: "claim-not-a-run" }
        },
        payload: {
          summary: "Gate opened without an explicit process ref.",
          refs: [],
          after: { status: "waiting" }
        }
      }
    ]
  }]);

  assert.equal(state.gates.length, 1);
  assert.equal(state.gates[0].processRef, undefined);
  assert.equal(state.processes.length, 0);
});

test("replay defaults generatedAt from the last accepted event", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item: any) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const state = buildCurrentOperatingState([stream]);

  assert.equal(state.generatedAt, "2026-06-03T10:01:42Z");
});

test("replay folds learning events as deduped non-authoritative context", () => {
  const learningEvent = {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-learning-route-back-001",
    type: "learning.recorded",
    occurredAt: "2026-06-04T12:00:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    subject: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-route-back" },
    payload: {
      summary: "Route-back outcomes need a short operator-facing reason.",
      refs: [{ product: "flow", kind: "run", id: "run-route-back" }],
      links: [
        {
          from: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-route-back" },
          relation: "derived_from",
          to: { product: "flow", kind: "run", id: "run-route-back" }
        }
      ],
      data: {
        id: "learning-route-back-reason",
        family: "workflow",
        nonAuthority: true,
        confidence: 0.82
      }
    }
  };
  const state = buildCurrentOperatingState({
    eventStreams: [
      {
        relativePath: "inline-learning.jsonl",
        events: [learningEvent, learningEvent]
      }
    ]
  }, { generatedAt: "2026-06-04T12:00:01Z" });

  assert.equal(state.source.acceptedEventCount, 1);
  assert.equal(state.source.duplicateEventCount, 1);
  assert.equal(state.timeline.length, 1);
  assert.equal(state.timeline[0].id, "evt-learning-route-back-001");
  assert.equal(state.learnings.length, 1);
  assert.equal(state.learnings[0].id, "learning-route-back-reason");
  assert.equal(state.learnings[0].sourceEventId, "evt-learning-route-back-001");
  assert.equal(state.learnings[0].subjectRef.id, "workflow-learning-route-back");
  assert.equal(state.learnings[0].family, "workflow");
  assert.equal(state.learnings[0].nonAuthority, true);
  assert.equal(state.learnings[0].summary, "Route-back outcomes need a short operator-facing reason.");
  assert.equal(state.learnings[0].confidence, 0.82);
  assert.equal(state.learnings[0].refs[0].id, "run-route-back");
  assert.equal(state.learnings[0].links[0].relation, "derived_from");
});

test("replay associates advisory learning with claim and run refs without mutating authoritative state", () => {
  const baseEvents = [
    {
      schema: "kontour.console.event",
      version: "0.1",
      id: "evt-run-started",
      type: "process.started",
      sequence: 1,
      occurredAt: "2026-06-04T12:00:00Z",
      producer: { product: "flow", id: "flow-local" },
      subject: { product: "flow", kind: "run", id: "run-learning-check", label: "Learning check" },
      payload: {
        summary: "Learning check started.",
        refs: [{ product: "surface", kind: "claim", id: "claim-learning-check", label: "Learning claim" }],
        after: { status: "running", currentStep: { id: "verify", label: "Verify" }, percentComplete: 25 }
      }
    },
    {
      schema: "kontour.console.event",
      version: "0.1",
      id: "evt-gate-opened",
      type: "gate.opened",
      sequence: 2,
      occurredAt: "2026-06-04T12:01:00Z",
      producer: { product: "flow", id: "flow-local" },
      subject: {
        product: "flow",
        kind: "gate",
        id: "gate-learning-check",
        label: "Learning gate",
        scope: { product: "flow", kind: "run", id: "run-learning-check", label: "Learning check" }
      },
      payload: {
        summary: "Learning gate opened.",
        refs: [{ product: "surface", kind: "claim", id: "claim-learning-check", label: "Learning claim" }],
        after: {
          processRef: { product: "flow", kind: "run", id: "run-learning-check", label: "Learning check" },
          missingEvidence: ["provider evidence"]
        }
      }
    },
    {
      schema: "kontour.console.event",
      version: "0.1",
      id: "evt-claim-status",
      type: "claim.status.changed",
      sequence: 3,
      occurredAt: "2026-06-04T12:02:00Z",
      producer: { product: "surface", id: "surface-local" },
      subject: { product: "surface", kind: "claim", id: "claim-learning-check", label: "Learning claim" },
      payload: {
        summary: "Learning claim pending.",
        refs: [{ product: "flow", kind: "run", id: "run-learning-check", label: "Learning check" }],
        after: { status: "pending" }
      }
    }
  ];
  const learningEvent = {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-learning-advisory",
    type: "learning.recorded",
    sequence: 4,
    occurredAt: "2026-06-04T12:03:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    subject: { product: "flow-agents", kind: "workflow-learning", id: "learning-gate-context" },
    payload: {
      summary: "Operators prefer the gate reason before retry guidance.",
      refs: [
        { product: "surface", kind: "claim", id: "claim-learning-check", label: "Learning claim" },
        { product: "flow", kind: "run", id: "run-learning-check", label: "Learning check" }
      ],
      actions: [
        {
          id: "action-learning-should-not-project",
          label: "Learning action should stay inert",
          status: "available",
          authority: { product: "flow-agents", command: "learning.apply" }
        }
      ],
      after: {
        nextActionRefs: [{ product: "flow", kind: "action", id: "action-learning-next-should-not-project" }]
      },
      data: {
        id: "learning-gate-reason",
        family: "workflow",
        nonAuthority: true,
        confidence: 0.77,
        sourceRef: { product: "flow", kind: "run", id: "run-learning-check", label: "Learning check" }
      }
    }
  };

  const before = buildCurrentOperatingState([{ relativePath: "base.jsonl", events: baseEvents }]);
  const after = buildCurrentOperatingState([{ relativePath: "learning.jsonl", events: [...baseEvents, learningEvent] }]);

  assert.deepEqual(after.claims, before.claims);
  assert.deepEqual(after.gates, before.gates);
  assert.deepEqual(after.actions, before.actions);
  assert.equal(after.currentStage, before.currentStage);
  assert.equal(after.timeline.length, before.timeline.length + 1);
  assert.equal(after.learnings.length, 1);
  assert.equal(after.learnings[0].nonAuthority, true);
  assert.equal(after.learnings[0].sourceRef.id, "run-learning-check");
  assert.deepEqual(after.learnings[0].refs.map((ref: any) => `${ref.product}:${ref.kind}:${ref.id}`), [
    "flow:run:run-learning-check",
    "surface:claim:claim-learning-check"
  ]);
});

test("learning-only replay does not promote advisory summary to current stage or actions", () => {
  const state = buildCurrentOperatingState([{
    relativePath: "learning-only.jsonl",
    events: [
      {
        schema: "kontour.console.event",
        version: "0.1",
        id: "evt-learning-only",
        type: "learning.recorded",
        sequence: 1,
        occurredAt: "2026-06-04T12:00:00Z",
        producer: { product: "flow-agents", id: "flow-agents-local" },
        subject: { product: "flow-agents", kind: "workflow-learning", id: "learning-only" },
        payload: {
          summary: "This advisory summary must not become the operating stage.",
          actions: [
            {
              id: "action-learning-only-should-not-project",
              status: "available",
              authority: { product: "flow-agents", command: "learning.apply" }
            }
          ],
          data: {
            id: "learning-only",
            family: "workflow",
            nonAuthority: true
          }
        }
      }
    ]
  }]);

  assert.equal(state.currentStage, "No authoritative events replayed.");
  assert.equal(state.timeline.length, 1);
  assert.equal(state.learnings.length, 1);
  assert.equal(state.claims.length, 0);
  assert.equal(state.gates.length, 0);
  assert.equal(state.actions.length, 0);
});

test("replay ignores unsafe learning id and sourceRef payload fields", () => {
  const learningEvent = {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-learning-safe-fallback",
    type: "learning.recorded",
    occurredAt: "2026-06-04T12:00:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    subject: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-safe-fallback" },
    payload: {
      summary: "Invalid optional payload fields should not affect replay.",
      data: {
        id: "",
        family: "workflow",
        nonAuthority: true,
        sourceRef: { product: "flow-agents", kind: "workflow-learning" }
      }
    }
  };

  const state = buildCurrentOperatingState({
    eventStreams: [
      {
        relativePath: "inline-learning-invalid-optional.jsonl",
        events: [learningEvent]
      }
    ]
  });

  assert.equal(state.learnings.length, 1);
  assert.equal(state.learnings[0].id, "workflow-learning-safe-fallback");
  assert.equal(state.learnings[0].sourceRef, undefined);
});
