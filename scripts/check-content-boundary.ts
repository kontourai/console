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

// The `kontour init`/CLI router freshness assertions that used to live here
// (hardcoded-pin and stale-docs checks against cli/src/init-plan.ts and
// docs/specs/kontour-cli-router.md|kontour-init.md) moved out along with the
// `@kontourai/cli` package itself — see https://github.com/kontourai/cli.
// This script now only owns the private-vertical-name content boundary
// below; an equivalent freshness gate for kontour init, if still wanted,
// belongs in the kontourai/cli repository against its own source.

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
