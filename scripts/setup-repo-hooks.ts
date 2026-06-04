#!/usr/bin/env -S node --import tsx

const { execFileSync } = require("node:child_process");

function runGit(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

if (process.argv.includes("--check")) {
  let hooksPath = "";
  try {
    hooksPath = runGit(["config", "--local", "--get", "core.hooksPath"]);
  } catch {
    hooksPath = "";
  }
  if (hooksPath !== ".githooks") {
    console.error(`Expected local core.hooksPath to be .githooks, found ${hooksPath || "<unset>"}.`);
    process.exit(1);
  }
  console.log("Local repo hooks path is configured.");
  process.exit(0);
}

runGit(["config", "--local", "core.hooksPath", ".githooks"]);
console.log("Configured local Git hooks path: .githooks");
