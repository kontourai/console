import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConsoleActor } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse } from "../src/serverApiTypes";
import { deriveFleetViewModel, FleetSection } from "../src/sections/FleetSection";

function telemetry(): ConsoleTelemetryResponse {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  return {
    generatedAt: "2026-07-10T12:00:00.000Z",
    sources: [],
    totals: {
      recordCount: 3,
      sessionCount: 3,
      eventTypeCounts: {},
      productRecordCount: 0,
      usage,
    },
    analytics: {
      facets: [{
        id: "agents",
        label: "Agents",
        counts: [{ name: "agent-alpha", count: 2 }, { name: "agent-beta", count: 1 }],
      }],
      flows: [],
      usageByModel: [],
      usageByProject: [],
      usageByRuntime: [],
      usageByAgent: [
        { ...usage, key: "agent-alpha", label: "agent-alpha" },
        { ...usage, key: "agent-beta", label: "agent-beta" },
      ],
    },
    records: [
      { eventId: "e-1", sourceId: "source", eventType: "turn", agentName: "agent-alpha", runtime: "claude-code", runtimeSessionId: "session-alpha-old" },
      { eventId: "e-2", sourceId: "source", eventType: "turn", agentName: "agent-alpha", runtime: "claude-code", runtimeSessionId: "session-alpha-live" },
      { eventId: "e-3", sourceId: "source", eventType: "turn", agentName: "agent-beta", runtime: "codex", runtimeSessionId: "session-beta" },
    ],
    warnings: [],
  };
}

function liveness(id: string, actor: string): ConsoleActor {
  return { id, actor, subjectId: `task-${id}`, status: "active" };
}

test("joins a fresh liveness actor to the right aggregated row by runtime session id", () => {
  const view = deriveFleetViewModel(
    telemetry(),
    [liveness("live", "claude-code:session-alpha-live:Host")],
  );
  const alpha = view.actors.find((actor) => actor.name === "agent-alpha");
  const beta = view.actors.find((actor) => actor.name === "agent-beta");

  assert.deepEqual(alpha?.runtimeSessionIds, ["session-alpha-live", "session-alpha-old"]);
  assert.equal(alpha?.coordinationState, "held-fresh");
  assert.equal(beta?.coordinationState, undefined);
  assert.deepEqual(view.unjoinedActors, []);
});

test("malformed and unmatched actor identities fall back without throwing", () => {
  const malformed = liveness("malformed", "not-a-canonical-identity");
  const ancestry = liveness("ancestry", "unknown:anc-abcd1234:Host");
  const unmatched = liveness("unmatched", "codex:no-telemetry-session:Host");
  const extraSegment = liveness("extra-segment", "claude-code:session-alpha-live:Host:extra");
  const reclaimableUnmatched = liveness("reclaimable-unmatched", "claude-code:no-reclaimable-telemetry:Host");
  const view = deriveFleetViewModel(telemetry(), [malformed, ancestry, unmatched, extraSegment], [reclaimableUnmatched]);

  assert.deepEqual(view.unjoinedActors.map(({ actor, state }) => [actor.id, state]), [
    ["malformed", "fresh"],
    ["ancestry", "fresh"],
    ["unmatched", "fresh"],
    ["extra-segment", "fresh"],
    ["reclaimable-unmatched", "reclaimable"],
  ]);
  assert.ok(view.actors.every((actor) => actor.coordinationState === undefined));

  const markup = renderToStaticMarkup(React.createElement(FleetSection, {
    telemetry: telemetry(),
    liveSessions: [malformed, extraSegment],
    reclaimableSessions: [reclaimableUnmatched],
    onOpen: () => undefined,
  }));
  assert.match(markup, /not-a-canonical-identity/);
  assert.match(markup, /claude-code:session-alpha-live:Host:extra/);
  assert.match(markup, /\(fresh\)/);
  assert.match(markup, /\(reclaimable\)/);
});

test("renders reclaimable coordination distinctly from fresh", () => {
  const data = telemetry();
  const fresh = liveness("fresh", "codex:session-beta:Host");
  const reclaimable = liveness("reclaimable", "claude-code:session-alpha-old:Host");
  const view = deriveFleetViewModel(data, [fresh], [reclaimable]);

  assert.equal(view.actors.find((actor) => actor.name === "agent-beta")?.coordinationState, "held-fresh");
  assert.equal(view.actors.find((actor) => actor.name === "agent-alpha")?.coordinationState, "reclaimable");

  const markup = renderToStaticMarkup(React.createElement(FleetSection, {
    telemetry: data,
    liveSessions: [fresh],
    reclaimableSessions: [reclaimable],
    onOpen: () => undefined,
  }));
  assert.match(markup, /held · fresh/);
  assert.match(markup, /reclaimable/);

  const precedence = deriveFleetViewModel(
    data,
    [liveness("fresh-alpha", "claude-code:session-alpha-live:Host")],
    [reclaimable],
  );
  assert.equal(precedence.actors.find((actor) => actor.name === "agent-alpha")?.coordinationState, "held-fresh");
});
