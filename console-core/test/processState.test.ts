import assert from "node:assert/strict";
import test from "node:test";
import { buildProcessFlow, selectActiveProcess, type ConsoleProcess, type ConsoleProcessStatus, type OperatingState } from "../src/index";

// console#229: interactive-session process states (needs_input, review_pending)
// and the optional blockedReason field.

test("ConsoleProcess accepts the interactive-session states and a blockedReason", () => {
  const needsInput: ConsoleProcess = {
    id: "run-1",
    status: "needs_input",
    blockedReason: "Agent asked a clarifying question about scope."
  };
  const reviewPending: ConsoleProcess = {
    id: "run-2",
    status: "review_pending",
    blockedReason: "Waiting on reviewer approval."
  };

  assert.equal(needsInput.status, "needs_input");
  assert.equal(needsInput.blockedReason, "Agent asked a clarifying question about scope.");
  assert.equal(reviewPending.status, "review_pending");
  assert.equal(reviewPending.blockedReason, "Waiting on reviewer approval.");
});

test("ConsoleProcessStatus stays an open union — product-specific statuses still assign", () => {
  const custom: ConsoleProcessStatus = "provider-specific-status";
  assert.equal(custom, "provider-specific-status");
});

test("selectActiveProcess treats needs_input and review_pending like blocked/waiting", () => {
  const processes: ConsoleProcess[] = [
    { id: "run-done", status: "completed" },
    { id: "run-needs-input", status: "needs_input" }
  ];
  assert.equal(selectActiveProcess(processes)?.id, "run-needs-input");

  const reviewProcesses: ConsoleProcess[] = [
    { id: "run-not-started", status: "not_started" },
    { id: "run-review-pending", status: "review_pending" }
  ];
  assert.equal(selectActiveProcess(reviewProcesses)?.id, "run-review-pending");
});

test("buildProcessFlow round-trips a needs_input process with a blockedReason", () => {
  const state: OperatingState = {
    processes: [{
      id: "run-1",
      label: "Interactive session",
      status: "needs_input",
      blockedReason: "Waiting for the operator to answer a question.",
      currentStep: "await-input"
    }]
  };

  const flow = buildProcessFlow(state);

  assert.equal(flow.activeProcess?.id, "run-1");
  assert.equal(flow.activeProcess?.status, "needs_input");
  assert.equal(flow.activeProcess?.blockedReason, "Waiting for the operator to answer a question.");
  const processNode = flow.nodes.find((node) => node.id === "process:run-1");
  assert.equal(processNode?.status, "needs_input");
});
