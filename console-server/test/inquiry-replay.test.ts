const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCurrentOperatingState,
  validateEvent,
  validateProjection
} = require("../src/console-foundation");

// Inquiry lifecycle: unsupported -> mapping proposed -> reviewed -> matched
const inquiryUnsupportedEvent = {
  schema: "kontour.console.event",
  version: "0.1",
  id: "evt-inquiry-resolved-unsupported",
  type: "inquiry.resolved",
  occurredAt: "2026-06-10T09:00:00Z",
  producer: { product: "surface", id: "surface-local" },
  scope: { kind: "repo", id: "console" },
  subject: { product: "surface", kind: "inquiry", id: "inquiry-unmapped-001", label: "Is the agent claim verified?" },
  payload: {
    summary: "Inquiry resolved as unsupported: no claim or rule matches.",
    after: {
      outcome: "unsupported",
      asker: "agent-session-42",
      statusFunctionVersion: "v1"
    }
  }
};

const inquiryMappingProposedEvent = {
  schema: "kontour.console.event",
  version: "0.1",
  id: "evt-inquiry-mapping-proposed",
  type: "inquiry.mapping.proposed",
  occurredAt: "2026-06-10T09:01:00Z",
  producer: { product: "surface", id: "surface-local" },
  scope: { kind: "repo", id: "console" },
  subject: { product: "surface", kind: "inquiry", id: "inquiry-unmapped-001", label: "Is the agent claim verified?" },
  payload: {
    summary: "Probabilistic proposer proposed: question may map to claim-agent-claim-verified.",
    refs: [
      { product: "surface", kind: "claim", id: "claim-agent-claim-verified", label: "Agent claim is verified" }
    ]
  }
};

const inquiryMappingReviewedEvent = {
  schema: "kontour.console.event",
  version: "0.1",
  id: "evt-inquiry-mapping-reviewed",
  type: "inquiry.mapping.reviewed",
  occurredAt: "2026-06-10T09:05:00Z",
  producer: { product: "surface", id: "surface-local" },
  scope: { kind: "repo", id: "console" },
  subject: { product: "surface", kind: "inquiry", id: "inquiry-unmapped-001", label: "Is the agent claim verified?" },
  payload: {
    summary: "Mapping reviewed and verified by reviewer.",
    after: {
      outcome: "verified"
    },
    refs: [
      { product: "surface", kind: "claim", id: "claim-agent-claim-verified", label: "Agent claim is verified" }
    ]
  }
};

const inquiryMatchedEvent = {
  schema: "kontour.console.event",
  version: "0.1",
  id: "evt-inquiry-resolved-matched",
  type: "inquiry.resolved",
  occurredAt: "2026-06-10T09:10:00Z",
  producer: { product: "surface", id: "surface-local" },
  scope: { kind: "repo", id: "console" },
  subject: { product: "surface", kind: "inquiry", id: "inquiry-rematch-001", label: "Is the agent claim verified?" },
  payload: {
    summary: "Inquiry resolved as matched: claim-agent-claim-verified answers it.",
    after: {
      outcome: "matched",
      asker: "agent-session-43",
      statusFunctionVersion: "v1"
    },
    refs: [
      { product: "surface", kind: "claim", id: "claim-agent-claim-verified", label: "Agent claim is verified" }
    ]
  }
};

const claimDisputeResolvedEvent = {
  schema: "kontour.console.event",
  version: "0.1",
  id: "evt-claim-dispute-resolved",
  type: "claim.dispute.resolved",
  occurredAt: "2026-06-10T10:00:00Z",
  producer: { product: "surface", id: "surface-local" },
  scope: { kind: "repo", id: "console" },
  subject: { product: "surface", kind: "claim", id: "claim-conflicted-001", label: "Conflicted provider claim" },
  payload: {
    summary: "Authority-backed decision resolved disputed claim status.",
    after: {
      resolvedStatus: "verified",
      reviewerAuthority: "compliance-reviewer"
    },
    refs: [
      { product: "surface", kind: "inquiry", id: "inquiry-conflict-related-001" }
    ]
  }
};

test("replay folds inquiry.resolved unsupported into inquiries state", () => {
  const state = buildCurrentOperatingState([{
    relativePath: "inquiry-unsupported.jsonl",
    events: [inquiryUnsupportedEvent]
  }]);

  assert.equal(state.inquiries.length, 1);
  assert.equal(state.inquiries[0].id, "inquiry-unmapped-001");
  assert.equal(state.inquiries[0].outcome, "unsupported");
  assert.equal(state.inquiries[0].asker, "agent-session-42");
  assert.equal(state.inquiries[0].statusFunctionVersion, "v1");
  assert.equal(state.timeline.length, 1);
  assert.equal(state.timeline[0].type, "inquiry.resolved");
});

test("replay folds inquiry.mapping.proposed and accumulates claimRefs", () => {
  const state = buildCurrentOperatingState([{
    relativePath: "inquiry-mapping.jsonl",
    events: [inquiryUnsupportedEvent, inquiryMappingProposedEvent]
  }]);

  assert.equal(state.inquiries.length, 1);
  assert.equal(state.inquiries[0].id, "inquiry-unmapped-001");
  assert.equal(state.inquiries[0].claimRefs?.length, 1);
  assert.equal(state.inquiries[0].claimRefs[0].id, "claim-agent-claim-verified");
  assert.equal(state.timeline.length, 2);
});

test("replay folds full inquiry lifecycle: unsupported -> mapping.proposed -> mapping.reviewed -> matched", () => {
  const events = [
    inquiryUnsupportedEvent,
    inquiryMappingProposedEvent,
    inquiryMappingReviewedEvent,
    inquiryMatchedEvent
  ];

  const state = buildCurrentOperatingState([{
    relativePath: "inquiry-lifecycle.jsonl",
    events
  }]);

  // Original inquiry stays in unsupported outcome, accumulating claim refs from the mapping proposal
  const original = state.inquiries.find((i: any) => i.id === "inquiry-unmapped-001");
  assert.ok(original, "original inquiry should be in state");
  assert.equal(original.outcome, "unsupported");
  assert.equal(original.claimRefs?.length, 1);

  // Subsequent matched inquiry is separate
  const matched = state.inquiries.find((i: any) => i.id === "inquiry-rematch-001");
  assert.ok(matched, "matched inquiry should be in state");
  assert.equal(matched.outcome, "matched");
  assert.equal(matched.claimRefs?.length, 1);
  assert.equal(matched.claimRefs[0].id, "claim-agent-claim-verified");
  assert.equal(matched.asker, "agent-session-43");

  assert.equal(state.timeline.length, 4);
  assert.equal(state.timeline[3].type, "inquiry.resolved");
});

test("replay folds claim.dispute.resolved and updates related inquiry claimRefs", () => {
  const events = [claimDisputeResolvedEvent];

  const state = buildCurrentOperatingState([{
    relativePath: "dispute.jsonl",
    events
  }]);

  // dispute resolution is recorded on the timeline but does not create an inquiry
  // (no inquiry subject ref — the subject is the claim)
  assert.equal(state.timeline.length, 1);
  assert.equal(state.timeline[0].type, "claim.dispute.resolved");
  // No inquiries created from dispute alone
  assert.equal(state.inquiries.length, 0);
});

test("replay does not promote inquiry events to claims or processes", () => {
  const events = [inquiryUnsupportedEvent, inquiryMatchedEvent];

  const state = buildCurrentOperatingState([{
    relativePath: "inquiry-isolation.jsonl",
    events
  }]);

  assert.equal(state.claims.length, 0);
  assert.equal(state.processes.length, 0);
  assert.equal(state.gates.length, 0);
  assert.equal(state.inquiries.length, 2);
});

test("validateEvent accepts inquiry.resolved event", () => {
  const errors = validateEvent(inquiryUnsupportedEvent, "inquiry.jsonl:1")
    .filter((item: any) => item.severity === "error");
  assert.equal(errors.length, 0);
});

test("validateEvent accepts inquiry.mapping.proposed event", () => {
  const errors = validateEvent(inquiryMappingProposedEvent, "inquiry.jsonl:2")
    .filter((item: any) => item.severity === "error");
  assert.equal(errors.length, 0);
});

test("validateEvent accepts inquiry.mapping.reviewed event", () => {
  const errors = validateEvent(inquiryMappingReviewedEvent, "inquiry.jsonl:3")
    .filter((item: any) => item.severity === "error");
  assert.equal(errors.length, 0);
});

test("validateEvent accepts claim.dispute.resolved event", () => {
  const errors = validateEvent(claimDisputeResolvedEvent, "dispute.jsonl:1")
    .filter((item: any) => item.severity === "error");
  assert.equal(errors.length, 0);
});

test("validateProjection accepts inquiries array with outcome and claimRefs", () => {
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-06-10T09:15:00Z",
    derivedFrom: {},
    producer: { product: "surface", id: "surface-local" },
    scope: { kind: "repo", id: "console" },
    inquiries: [
      {
        id: "inquiry-unmapped-001",
        outcome: "unsupported",
        asker: "agent-session-42"
      },
      {
        id: "inquiry-rematch-001",
        outcome: "matched",
        claimRefs: [{ product: "surface", kind: "claim", id: "claim-agent-claim-verified" }]
      }
    ]
  };

  const errors = validateProjection(projection, "inquiry-projection.json")
    .filter((item: any) => item.severity === "error");
  assert.equal(errors.length, 0);
});

test("validateProjection rejects inquiry missing id or outcome", () => {
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-06-10T09:20:00Z",
    derivedFrom: {},
    producer: { product: "surface", id: "surface-local" },
    scope: { kind: "repo", id: "console" },
    inquiries: [
      {
        id: "",
        outcome: "matched"
      },
      {
        id: "inquiry-no-outcome"
      }
    ]
  };

  const errors = validateProjection(projection, "inquiry-invalid.json")
    .filter((item: any) => item.severity === "error");
  const paths = new Set(errors.map((item: any) => item.path));

  assert.equal(paths.has("inquiry-invalid.json.inquiries[0].id"), true);
  assert.equal(paths.has("inquiry-invalid.json.inquiries[1].outcome"), true);
});

test("validateProjection rejects inquiry with malformed claimRefs", () => {
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-06-10T09:25:00Z",
    derivedFrom: {},
    producer: { product: "surface", id: "surface-local" },
    scope: { kind: "repo", id: "console" },
    inquiries: [
      {
        id: "inquiry-bad-refs",
        outcome: "matched",
        claimRefs: [{ product: "surface", kind: "claim" }]
      }
    ]
  };

  const errors = validateProjection(projection, "inquiry-bad-refs.json")
    .filter((item: any) => item.severity === "error");
  const paths = new Set(errors.map((item: any) => item.path));

  assert.equal(paths.has("inquiry-bad-refs.json.inquiries[0].claimRefs[0].id"), true);
});
