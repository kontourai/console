import assert from "node:assert/strict";
import test from "node:test";
import { selectLearningsBySubjectRef, type OperatingState } from "../src/index";

test("selectLearningsBySubjectRef matches subjectRef, sourceRef, and refs by product kind id", () => {
  const state: OperatingState = {
    learnings: [
      {
        id: "learning-claim",
        subjectRef: { product: "surface", kind: "claim", id: "claim-1", label: "Claim one" },
        summary: "Claim context."
      },
      {
        id: "learning-run-source",
        sourceRef: { product: "flow", kind: "run", id: "run-1", label: "Run one" },
        summary: "Run source context."
      },
      {
        id: "learning-run-ref",
        refs: [{ product: "flow", kind: "run", id: "run-1", name: "ignored-name" }],
        summary: "Run referenced context."
      },
      {
        id: "learning-other",
        refs: [{ product: "surface", kind: "claim", id: "claim-2" }],
        summary: "Other context."
      }
    ]
  };

  assert.deepEqual(
    selectLearningsBySubjectRef(state, { product: "surface", kind: "claim", id: "claim-1" }).map((item) => item.id),
    ["learning-claim"]
  );
  assert.deepEqual(
    selectLearningsBySubjectRef(state, { product: "flow", kind: "run", id: "run-1" }).map((item) => item.id),
    ["learning-run-source", "learning-run-ref"]
  );
});

test("selectLearningsBySubjectRef ignores labels and missing identity parts", () => {
  const state: OperatingState = {
    learnings: [
      {
        id: "learning-claim",
        refs: [{ product: "surface", kind: "claim", id: "claim-1", label: "Old label" }]
      }
    ]
  };

  assert.deepEqual(
    selectLearningsBySubjectRef(state, { product: "surface", kind: "claim", id: "claim-1", label: "New label" }).map((item) => item.id),
    ["learning-claim"]
  );
  assert.deepEqual(selectLearningsBySubjectRef(state, { product: "surface", kind: "claim" }), []);
  assert.deepEqual(selectLearningsBySubjectRef(state, { product: "surface", kind: "claim", id: "missing" }), []);
});
