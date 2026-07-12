import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = resolve(import.meta.dirname, "../..");
const root = mkdtempSync(join(tmpdir(), "kontour-init-real-e2e-"));
const project = join(root, "repo");
const home = join(root, "home");
const packages = join(root, "packages");
const install = join(root, "install");
for (const dir of [project, home, packages, install]) mkdirSync(dir);
writeFileSync(join(project, ".gitignore"), "# scratch sentinel\n");

const env = { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), npm_config_cache: join(root, "npm-cache"), NODE_PATH: "", NO_COLOR: "1", FORCE_COLOR: "0" };
function command(executable: string, args: string[], cwd: string) {
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, `${executable} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
command("git", ["init", "--quiet"], project);
command("npm", ["pack", "--silent", "--pack-destination", packages, "@kontourai/flow-agents@3.8.0", "@kontourai/flow@3.1.4"], root);
command("npm", ["init", "-y"], install);
command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...["kontourai-flow-agents-3.8.0.tgz", "kontourai-flow-3.1.4.tgz"].map((name) => join(packages, name))], install);
const agents = join(install, "node_modules/@kontourai/flow-agents");

function kontour(args: string[]) {
  return command(process.execPath, [join(repo, "cli/dist/bin/kontour.js"), `--product-root=flow-agents=${agents}`, ...args], project);
}

const before = readFileSync(join(project, ".gitignore"), "utf8");
const inspected = JSON.parse(kontour(["init", "--inspect", "--json"]));
assert.deepEqual(inspected.mutations, []);
assert.equal(typeof inspected.diagnostics.doctor.exitCode, "number");
assert.equal(typeof inspected.diagnostics.kitStatus.exitCode, "number");
const planned = JSON.parse(kontour(["init", "--plan", "--runtime", "codex", "--kit", "builder", "--json"]));
assert.deepEqual(planned.desired.kits, ["builder"]);
assert.equal(readFileSync(join(project, ".gitignore"), "utf8"), before);
const applied = JSON.parse(kontour(["init", "--apply", "--runtime", "codex", "--kit", "builder", "--plan-id", planned.plan_id, "--yes", "--json"]));
assert.equal(applied.status, "completed");
assert.equal(applied.actions.length, 3);
assert.equal(applied.actions[2].id, "flow-agents-doctor");
assert.notEqual(applied.actions[2].output, undefined);
assert.equal(existsSync(join(project, ".codex", "hooks.json")), true, "Codex hook wiring was not installed");
assert.equal(existsSync(join(project, ".codex", "config.toml")), true, "Codex config wiring was not installed");
assert.ok(applied.recovery.every((entry: string) => entry.includes("Flow Agents")));
assert.equal(JSON.parse(command(join(install, "node_modules/.bin/flow-agents"), ["kit", "status", "builder", "--dest", project], project)).id, "builder");
assert.equal(readFileSync(join(project, ".gitignore"), "utf8"), before);
console.log("kontour init real packed Flow Agents/Flow scratch E2E passed; public @kontourai/cli npm bootstrap E2E remains NOT_VERIFIED");
