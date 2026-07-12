#!/usr/bin/env -S node --import tsx

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");

const SELF = "scripts/check-content-boundary.ts";

const bannedTerms = [
  {
    label: "private vertical product name",
    pattern: new RegExp(["c", "a", "m", "p", "f", "i", "t"].join(""), "i"),
  },
  {
    label: "private regulated vertical repository name",
    pattern: new RegExp("\\b" + ["t", "a", "x", "e", "s"].join("") + "\\b", "i"),
  },
  {
    label: "private regulated vertical term",
    pattern: new RegExp("\\b" + ["t", "a", "x"].join("") + "\\b", "i"),
  },
];

const ignoredPathPatterns = [
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^\.git\//,
  /^\.astro\//,
  /^test-results\//,
  /^\.omx\//,
];

type Finding = {
  filePath: string;
  line: number;
  label: string;
};

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter(Boolean);
}

function isIgnoredPath(filePath: string): boolean {
  return filePath === SELF || ignoredPathPatterns.some((pattern) => pattern.test(filePath));
}

function lineNumberFor(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

const findings: Finding[] = [];

const initRouterSpec = readFileSync("docs/specs/kontour-cli-router.md", "utf8");
for (const staleClaim of ["plan output file", "requires a saved plan"]) {
  const index = initRouterSpec.indexOf(staleClaim);
  if (index >= 0) findings.push({
    filePath: "docs/specs/kontour-cli-router.md",
    line: lineNumberFor(initRouterSpec, index),
    label: `stale kontour init filesystem contract: ${staleClaim}`,
  });
}
for (const requiredClaim of ["stdout", "`--plan-id`", "`--plan-file`", "`--output`"]) {
  if (!initRouterSpec.includes(requiredClaim)) findings.push({
    filePath: "docs/specs/kontour-cli-router.md",
    line: 1,
    label: `kontour init router contract must document ${requiredClaim}`,
  });
}

for (const filePath of trackedFiles()) {
  if (filePath.startsWith(".flow-agents/")) {
    findings.push({
      filePath,
      line: 1,
      label: "Flow Agents runtime artifact must not be tracked in this repo",
    });
    continue;
  }

  if (isIgnoredPath(filePath)) {
    continue;
  }

  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  if (content.includes("\0")) {
    continue;
  }

  for (const term of bannedTerms) {
    const match = term.pattern.exec(content);
    if (match) {
      findings.push({
        filePath,
        line: lineNumberFor(content, match.index),
        label: term.label,
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Content boundary check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.line} ${finding.label}`);
  }
  process.exit(1);
}

console.log("Content boundary check passed.");
