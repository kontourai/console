import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceRefLinks } from "../src/components/SourceRefLinks";
import type { SourceRef } from "../src/utils/sourceRefs";

// console#256: SourceRefLinks is the ONE shared render for source-of-truth
// chips (fleet cards + run detail). Markup-level honesty contract: a ref only
// ever becomes a real <a href> when it carries a url; every other ref renders
// as plain text, never a dead/fake anchor. Mirrors the renderToStaticMarkup
// convention used elsewhere in this repo (no jsdom/testing-library).

function render(props: Parameters<typeof SourceRefLinks>[0]): string {
  return renderToStaticMarkup(React.createElement(SourceRefLinks, props));
}

test("SourceRefLinks: renders nothing (null) for an empty refs array", () => {
  assert.equal(render({ refs: [] }), "");
});

test("SourceRefLinks: a ref with a url renders as a real <a href> with rel=noopener noreferrer and target=_blank", () => {
  const refs: SourceRef[] = [{ kind: "work-item", label: "#254", url: "https://github.com/kontourai/flow-agents/issues/254" }];
  const markup = render({ refs });
  assert.match(markup, /<a[^>]*href="https:\/\/github\.com\/kontourai\/flow-agents\/issues\/254"[^>]*>#254<\/a>/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /target="_blank"/);
});

test("SourceRefLinks: a ref with no url renders as plain text (code), never an anchor", () => {
  const refs: SourceRef[] = [{ kind: "assignment-branch", label: "feature/checkout-banner" }];
  const markup = render({ refs });
  assert.doesNotMatch(markup, /<a /);
  assert.match(markup, /<code[^>]*>feature\/checkout-banner<\/code>/);
});

// XSS probe (defense in depth): SourceRefLinks re-validates `url` itself
// (isSafeExternalUrl) rather than blindly trusting it was pre-filtered by
// `deriveSourceRefs` -- so even a hand-built SourceRef with an unsafe scheme
// NEVER becomes a live href, only an honest text chip.
test("SourceRefLinks: a javascript: url is never rendered as a live link (component-level XSS probe)", () => {
  const refs = [{ kind: "work-item", label: "evil", url: "javascript:alert(1)" }] as SourceRef[];
  const markup = render({ refs });
  assert.doesNotMatch(markup, /<a /);
  assert.doesNotMatch(markup, /href="javascript:/);
  assert.doesNotMatch(markup, /javascript:alert/);
  assert.match(markup, /<code[^>]*>evil<\/code>/);
});

test("SourceRefLinks: refs render in the order given (ordering is the derivation's job, not this component's)", () => {
  const refs: SourceRef[] = [
    { kind: "work-item", label: "Work item", url: "https://example.test/1" },
    { kind: "assignment-branch", label: "Branch" },
    { kind: "assignment-actor", label: "Actor" },
    { kind: "assignment-artifact-dir", label: "Artifact dir" },
  ];
  const markup = render({ refs });
  const labels = ["Work item", "Branch", "Actor", "Artifact dir"];
  let lastIndex = -1;
  for (const label of labels) {
    const index = markup.indexOf(label);
    assert.ok(index > lastIndex, `expected "${label}" to appear after the previous ref in:\n${markup}`);
    lastIndex = index;
  }
});

test("SourceRefLinks: `only` restricts rendering to the given kinds, e.g. the fleet card's work-item-only chip", () => {
  const refs: SourceRef[] = [
    { kind: "work-item", label: "Work item", url: "https://example.test/1" },
    { kind: "assignment-branch", label: "Branch" },
  ];
  const markup = render({ refs, only: ["work-item"] });
  assert.match(markup, /Work item/);
  assert.doesNotMatch(markup, /Branch/);
});

test("SourceRefLinks: `only` filtering down to nothing renders null, not an empty <ul>", () => {
  const refs: SourceRef[] = [{ kind: "assignment-branch", label: "Branch" }];
  assert.equal(render({ refs, only: ["work-item"] }), "");
});

test("SourceRefLinks: default aria-label is 'Source of truth'; ariaLabel overrides it", () => {
  const refs: SourceRef[] = [{ kind: "work-item", label: "Work item", url: "https://example.test/1" }];
  assert.match(render({ refs }), /aria-label="Source of truth"/);
  assert.match(render({ refs, ariaLabel: "Work item" }), /aria-label="Work item"/);
});
