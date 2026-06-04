#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const failures = [];

function fail(message) {
  failures.push(message);
}

function readRepoFile(filePath) {
  return readFileSync(path.join(repoRoot, filePath), "utf8");
}

function gitOutput(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function expectIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    fail(message);
  }
}

function normalizeHookLines(content) {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function parseBoundaryDenylist(value) {
  return value
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const packageJson = JSON.parse(readRepoFile("package.json"));
if (packageJson.scripts?.["setup:repo-hooks"] !== "node scripts/setup-repo-hooks.cjs") {
  fail("package.json must map setup:repo-hooks to node scripts/setup-repo-hooks.cjs.");
}
if (packageJson.scripts?.["validate:repo-hooks"] !== "node scripts/validate-repo-hooks.cjs") {
  fail("package.json must map validate:repo-hooks to node scripts/validate-repo-hooks.cjs.");
}

const hookPath = path.join(repoRoot, ".githooks/pre-push");
let hookSource = "";
try {
  hookSource = readFileSync(hookPath, "utf8");
  const mode = statSync(hookPath).mode;
  if ((mode & 0o111) === 0) {
    fail(".githooks/pre-push must be executable. Run chmod +x .githooks/pre-push.");
  }
} catch {
  fail(".githooks/pre-push must exist.");
}

if (hookSource) {
  const expectedHookLines = [
    "#!/bin/sh",
    "set -eu",
    "repo_root=$(git rev-parse --show-toplevel)",
    'cd "$repo_root"',
    'echo "pre-push: npm test"',
    "npm test",
  ];
  const actualHookLines = normalizeHookLines(hookSource);
  if (
    actualHookLines.length !== expectedHookLines.length ||
    actualHookLines.some((line, index) => line !== expectedHookLines[index])
  ) {
    fail(
      `.githooks/pre-push must match the expected normalized command sequence:\n` +
        expectedHookLines.map((line) => `  ${line}`).join("\n")
    );
  }
}

const hooksPath = gitOutput(["config", "--local", "--get", "core.hooksPath"]);
if (hooksPath !== ".githooks") {
  fail(`Local core.hooksPath must be .githooks. Run npm run setup:repo-hooks. Current value: ${hooksPath || "<unset>"}.`);
}

const readme = readRepoFile("README.md");
for (const needle of [
  "## Contributor Hook Tooling",
  "npm run setup:repo-hooks",
  "npm run validate:repo-hooks",
  "npm test",
  "local contributor tooling",
  "not Console event, projection, or control-plane semantics",
  "suite products and producers",
  "suite primitives",
]) {
  expectIncludes(readme, needle, `README.md must document ${needle}.`);
}

const boundaryFiles = [
  ".githooks/pre-push",
  "README.md",
  "scripts/setup-repo-hooks.cjs",
  "scripts/validate-repo-hooks.cjs",
];
const envDenylist = parseBoundaryDenylist(process.env.KONTOUR_CONSOLE_BOUNDARY_DENYLIST ?? "");

for (const filePath of boundaryFiles) {
  const content = readRepoFile(filePath);
  for (const term of envDenylist) {
    const pattern = new RegExp(escapeRegExp(term), "i");
    if (pattern.test(content)) {
      fail(`${filePath} contains an environment-denied boundary term; keep hook tooling generic to Console and suite primitives.`);
    }
  }
}

if (failures.length > 0) {
  console.error("Repo hook validation failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("Repo hook validation passed.");
