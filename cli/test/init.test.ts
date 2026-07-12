import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { runCli } from "../src/cli";

const fixtures = resolve(fileURLToPath(new URL("./fixtures/packages", import.meta.url)));

async function agentsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kontour-init-agents-"));
  await cp(join(fixtures, "flow-agents"), root, { recursive: true });
  await mkdir(join(root, "kits", "builder"), { recursive: true });
  await writeFile(join(root, "kits", "builder", "kit.json"), `${JSON.stringify({ id: "builder", version: "1.0.0" })}\n`);
  const manifestPath = join(root, "package.json");
  const rootManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  rootManifest.dependencies = { "@kontourai/flow": "3.1.4", "dep-a": "1.0.0", "dep-b": "1.0.0" };
  rootManifest.optionalDependencies = { "optional-dep": "1.0.0" };
  rootManifest.peerDependencies = { "peer-dep": "1.0.0" };
  await writeFile(manifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);
  const flowRoot = join(root, "node_modules", "@kontourai", "flow");
  await mkdir(flowRoot, { recursive: true });
  await writeFile(join(flowRoot, "package.json"), `${JSON.stringify({ name: "@kontourai/flow", version: "3.1.4" })}\n`);
  await writeFile(join(flowRoot, "index.js"), "export {};\n");
  for (const [name, manifest] of [
    ["dep-a", { name: "dep-a", version: "1.0.0", dependencies: { shared: "1.0.0" } }],
    ["dep-b", { name: "dep-b", version: "1.0.0", dependencies: { shared: "2.0.0" } }],
    ["optional-dep", { name: "optional-dep", version: "1.0.0" }],
    ["peer-dep", { name: "peer-dep", version: "1.0.0" }],
  ] as const) {
    const dir = join(root, "node_modules", name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, "package.json"), `${JSON.stringify(manifest)}\n`);
  }
  for (const [parent, version] of [["dep-a", "1.0.0"], ["dep-b", "2.0.0"]] as const) {
    const dir = join(root, "node_modules", parent, "node_modules", "shared"); await mkdir(dir, { recursive: true }); await writeFile(join(dir, "package.json"), `${JSON.stringify({ name: "shared", version })}\n`);
  }
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { bin: Record<string, string> };
  for (const bin of Object.values(manifest.bin)) await chmod(join(root, bin), 0o755);
  return root;
}

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: { stdout: { write: (value: string) => { stdout += value; } }, stderr: { write: (value: string) => { stderr += value; } } },
    read: () => ({ stdout, stderr }),
  };
}

test("init inspect and plan are deterministic and select zero kits by default", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-repo-"));
  const inspect = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--inspect", "--json"], inspect.io, { cwd }), 0);
  const inspected = JSON.parse(inspect.read().stdout);
  assert.equal(inspected.mode, "inspect");
  assert.equal(inspected.products.flowAgents.version, "3.8.0");
  assert.ok(inspected.diagnostics.doctor);
  assert.ok(inspected.diagnostics.kitStatus);

  const first = capture();
  const second = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--runtime", "codex", "--json"], first.io, { cwd }), 0);
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--runtime", "codex", "--json"], second.io, { cwd }), 0);
  assert.equal(first.read().stdout, second.read().stdout);
  const plan = JSON.parse(first.read().stdout);
  const cliManifest = JSON.parse(await readFile(resolve(fileURLToPath(new URL("../package.json", import.meta.url))), "utf8"));
  assert.equal(plan.pins.cli, cliManifest.version);
  assert.deepEqual(plan.desired.kits, []);
  assert.equal(plan.actions.some((action: { argv: string[] }) => action.argv.includes("builder")), false);
  assert.equal(plan.pins.flowAgents, "3.8.0");
  assert.match(plan.plan_id, /^[a-f0-9]{64}$/);
  assert.ok(plan.products.flowAgents.authorityPackages.every((item: { sha256: string }) => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(plan.products.flowAgents.authorityPackages.some((item: { name: string }) => item.name === "@kontourai/flow"));
  assert.deepEqual(plan.products.flowAgents.authorityPackages.filter((item: { name: string }) => item.name === "shared").map((item: { version: string }) => item.version).sort(), ["1.0.0", "2.0.0"]);
  const rootNode = plan.products.flowAgents.authorityPackages.find((item: { name: string }) => item.name === "@kontourai/flow-agents");
  assert.ok(rootNode.edges.some((edge: { name: string; kind: string }) => edge.name === "optional-dep" && edge.kind === "optional"));
  assert.ok(rootNode.edges.some((edge: { name: string; kind: string }) => edge.name === "peer-dep" && edge.kind === "peer"));
  const schema = JSON.parse(await readFile(resolve(fileURLToPath(new URL("../schemas/init-plan.schema.json", import.meta.url))), "utf8"));
  const validate = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validate(plan), true, JSON.stringify(validate.errors));
});

test("init plan binds process.execPath and ignores a fake node earlier on PATH", async () => {
  const root = await agentsRoot(); const cwd = await mkdtemp(join(tmpdir(), "kontour-init-node-")); const fake = await mkdtemp(join(tmpdir(), "fake-node-"));
  await writeFile(join(fake, "node"), "#!/bin/sh\nexit 99\n"); await chmod(join(fake, "node"), 0o755);
  const old = process.env.PATH;
  try {
    const first = capture(); await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--json"], first.io, { cwd });
    process.env.PATH = `${fake}:${old ?? ""}`;
    const second = capture(); await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--json"], second.io, { cwd });
    const a = JSON.parse(first.read().stdout); const b = JSON.parse(second.read().stdout);
    assert.equal(a.plan_id, b.plan_id); assert.equal(a.interpreter.realpath, await realpath(process.execPath)); assert.match(a.interpreter.sha256, /^[a-f0-9]{64}$/);
  } finally { process.env.PATH = old; }
});

test("apply actions inherit the held repository inode across a pathname replacement", async () => {
  const root = await agentsRoot(); const cwd = await mkdtemp(join(tmpdir(), "kontour-init-held-cwd-")); const inode = (await stat(cwd)).ino;
  const planned = capture(); await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--kit", "builder", "--json"], planned.io, { cwd }); const plan = JSON.parse(planned.read().stdout);
  let calls = 0;
  const code = await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--kit", "builder", "--plan-id", plan.plan_id, "--yes", "--json"], capture().io, { cwd, delegate: async (_file, _argv, options) => {
    calls += 1; assert.equal(options?.cwd, undefined); assert.equal((await stat(".")).ino, inode);
    if (calls === 1) { await rename(cwd, `${cwd}-renamed`); await mkdir(cwd); }
    return 0;
  } });
  assert.equal(code, 0); assert.equal(calls, 3);
});

test("init inspection preserves structured product-owned doctor and kit status output", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-inspect-"));
  const calls: string[][] = [];
  const output = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--inspect", "--json"], output.io, {
    cwd,
    delegateCaptured: async (_file, argv) => {
      calls.push([...argv]);
      return argv.includes("telemetry-doctor")
        ? { code: 3, stdout: JSON.stringify({ status: "not_verified", blocker: "token" }), stderr: "" }
        : { code: 0, stdout: "No local Flow Kits installed.\n", stderr: "" };
    },
  }), 0);
  const result = JSON.parse(output.read().stdout);
  assert.equal(result.diagnostics.doctor.exitCode, 3);
  assert.equal(result.diagnostics.doctor.output.blocker, "token");
  assert.equal(result.diagnostics.kitStatus.output, "No local Flow Kits installed.");
  assert.equal(calls.length, 2);
});

for (const mode of ["inspect", "plan", "apply"] as const) {
  test(`init ${mode} rejects a mismatched Flow Agents package before advertising or executing it`, async () => {
    const root = await agentsRoot();
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.version = "3.7.0";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const cwd = await mkdtemp(join(tmpdir(), "kontour-init-version-mismatch-"));
    const sentinel = join(cwd, "sentinel.txt");
    await writeFile(sentinel, "unchanged\n");
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-")));
    let delegated = false;
    const output = capture();
    const modeArgs = mode === "apply" ? ["--apply", "--plan-id", "untrusted", "--yes"] : [`--${mode}`];
    assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", ...modeArgs, "--json"], output.io, {
      cwd,
      delegate: async () => { delegated = true; return 0; },
    }), 2);
    assert.equal(delegated, false);
    assert.equal(output.read().stdout, "");
    assert.match(output.read().stderr, /KONTOUR_INIT_EXACT_VERSION_REQUIRED: Expected @kontourai\/flow-agents@3\.8\.0/);
    assert.equal(await readFile(sentinel, "utf8"), "unchanged\n");
    const added = (await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-") && !before.has(name));
    assert.deepEqual(added, []);
  });
}

async function addNestedFlow(root: string, rootVersion: string, nestedVersion: string): Promise<void> {
  const rootFlowManifest = join(root, "node_modules", "@kontourai", "flow", "package.json");
  await writeFile(rootFlowManifest, `${JSON.stringify({ name: "@kontourai/flow", version: rootVersion })}\n`);
  const depManifestPath = join(root, "node_modules", "dep-a", "package.json");
  const depManifest = JSON.parse(await readFile(depManifestPath, "utf8"));
  depManifest.dependencies["@kontourai/flow"] = nestedVersion;
  await writeFile(depManifestPath, `${JSON.stringify(depManifest)}\n`);
  const nestedFlow = join(root, "node_modules", "dep-a", "node_modules", "@kontourai", "flow");
  await mkdir(nestedFlow, { recursive: true });
  await writeFile(join(nestedFlow, "package.json"), `${JSON.stringify({ name: "@kontourai/flow", version: nestedVersion })}\n`);
  await writeFile(join(nestedFlow, "index.js"), "export {};\n");
}

test("init accepts the pinned root Flow edge when another physical Flow version is also present", async () => {
  const root = await agentsRoot();
  await addNestedFlow(root, "3.1.4", "3.1.3");
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-flow-duplicate-positive-"));
  const output = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--json"], output.io, { cwd }), 0);
  const plan = JSON.parse(output.read().stdout);
  assert.deepEqual(plan.products.flowAgents.authorityPackages.filter((item: { name: string }) => item.name === "@kontourai/flow").map((item: { version: string }) => item.version).sort(), ["3.1.3", "3.1.4"]);
  const rootNode = plan.products.flowAgents.authorityPackages.find((item: { id: string }) => item.id === plan.products.flowAgents.rootInstanceId);
  const flowEdge = rootNode.edges.find((edge: { name: string }) => edge.name === "@kontourai/flow");
  assert.equal(flowEdge.kind, "dependency");
  assert.equal(plan.products.flowAgents.authorityPackages.find((item: { id: string }) => item.id === flowEdge.targetId).version, "3.1.4");
});

for (const mode of ["inspect", "plan", "apply"] as const) {
  test(`init ${mode} rejects a mismatched root Flow even when nested Flow 3.1.4 masks it`, async () => {
    const root = await agentsRoot();
    await addNestedFlow(root, "3.1.3", "3.1.4");
    const cwd = await mkdtemp(join(tmpdir(), "kontour-init-flow-mask-"));
    const sentinel = join(cwd, "sentinel.txt");
    await writeFile(sentinel, "unchanged\n");
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-")));
    let delegated = false;
    const output = capture();
    const modeArgs = mode === "apply" ? ["--apply", "--plan-id", "untrusted", "--yes"] : [`--${mode}`];
    assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", ...modeArgs, "--json"], output.io, { cwd, delegate: async () => { delegated = true; return 0; } }), 2);
    assert.equal(delegated, false);
    assert.equal(output.read().stdout, "");
    assert.match(output.read().stderr, /KONTOUR_INIT_EXACT_VERSION_REQUIRED: Expected @kontourai\/flow@3\.1\.4 as a Flow Agents runtime dependency/);
    assert.equal(await readFile(sentinel, "utf8"), "unchanged\n");
    const added = (await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-") && !before.has(name));
    assert.deepEqual(added, []);
  });
}

for (const hostileName of ["..", "../escape", "@scope/../escape", "evil\\child", "%2e%2e", "%2fescape", "/absolute", "C:\\escape"]) {
  test(`init inspect rejects hostile dependency name ${JSON.stringify(hostileName)} without staging outside private root`, async () => {
    const root = await agentsRoot();
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies[hostileName] = "1.0.0";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const cwd = await mkdtemp(join(tmpdir(), "kontour-init-hostile-dep-"));
    const outside = join(tmpdir(), "kontour-init-hostile-escape-sentinel");
    await writeFile(outside, "unchanged\n");
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-")));
    let delegated = false;
    await assert.rejects(() => runCli([`--product-root=flow-agents=${root}`, "init", "--inspect", "--json"], capture().io, { cwd, delegate: async () => { delegated = true; return 0; } }), /invalid runtime dependency name/);
    assert.equal(delegated, false);
    assert.equal(await readFile(outside, "utf8"), "unchanged\n");
    const added = (await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-") && !before.has(name));
    assert.deepEqual(added, []);
  });
}

test("init rejects removed saved-plan and output options", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-safe-path-"));
  const outside = await mkdtemp(join(tmpdir(), "kontour-init-outside-"));
  for (const option of ["--output", "--plan-file"]) {
    const result = capture();
    assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", option, "x.json"], result.io, { cwd }), 2);
    assert.match(result.read().stderr, /KONTOUR_INIT_ARGUMENT_INVALID/);
  }
});

test("init plan records explicit Builder selection as Flow Agents-owned literal argv", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-builder-"));
  const output = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--runtime", "codex", "--kit", "builder", "--json"], output.io, { cwd }), 0);
  const plan = JSON.parse(output.read().stdout);
  assert.deepEqual(plan.desired.kits, ["builder"]);
  assert.ok(plan.actions.every((action: { owner: string }) => action.owner === "flow-agents"));
  assert.ok(plan.actions.some((action: { argv: string[] }) => action.argv[0] === "kit" && action.argv[1] === "install"));
  assert.ok(plan.actions.some((action: { argv: string[] }) => action.argv.slice(-2).join(" ") === "--activate-kit builder"));
  assert.ok(plan.actions.every((action: { rollback: string }) => action.rollback.length > 0));
});

test("init apply requires exact recomputed plan consent and stops after a failed delegated action", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-apply-"));
  const planned = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--runtime", "codex", "--kit", "builder", "--json"], planned.io, { cwd }), 0);
  const plan = JSON.parse(planned.read().stdout);

  const denied = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--runtime", "codex", "--kit", "builder", "--plan-id", plan.plan_id, "--json"], denied.io, { cwd }), 2);
  assert.match(denied.read().stderr, /KONTOUR_INIT_CONSENT_REQUIRED/);

  const calls: string[][] = [];
  const applied = capture();
  const code = await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--runtime", "codex", "--kit", "builder", "--plan-id", plan.plan_id, "--yes", "--json"], applied.io, {
    cwd,
    delegate: async (_executable, argv) => { calls.push([...argv]); return 9; },
  });
  assert.equal(code, 9);
  assert.equal(calls.length, 1);
  const result = JSON.parse(applied.read().stdout);
  assert.equal(result.actions[0].status, "failed");
  assert.ok(result.actions.slice(1).every((action: { status: string }) => action.status === "not_run"));
  assert.match(result.recovery[0], /Flow Agents/);
});

test("init apply rejects plan tampering and repository drift before delegation", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-drift-"));
  const planned = capture();
  await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--runtime", "codex", "--json"], planned.io, { cwd });
  const plan = JSON.parse(planned.read().stdout);
  let delegated = false;
  const result = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--runtime", "codex", "--kit", "builder", "--plan-id", plan.plan_id, "--yes"], result.io, {
    cwd,
    delegate: async () => { delegated = true; return 0; },
  }), 2);
  assert.equal(delegated, false);
  assert.match(result.read().stderr, /KONTOUR_INIT_PLAN_INVALID/);
});

test("init apply rejects selected kit payload mutation before delegation", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-kit-drift-"));
  const planned = capture();
  await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--kit", "builder", "--json"], planned.io, { cwd });
  const plan = JSON.parse(planned.read().stdout);
  await writeFile(join(root, "kits", "builder", "changed.txt"), "changed after approval\n");
  let delegated = false;
  const result = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--kit", "builder", "--plan-id", plan.plan_id, "--yes"], result.io, { cwd, delegate: async () => { delegated = true; return 0; } }), 2);
  assert.equal(delegated, false);
  assert.match(result.read().stderr, /KONTOUR_INIT_PLAN_INVALID/);
});

for (const [label, mutate] of [
  ["Flow Agents sibling module", async (root: string) => writeFile(join(root, "bin", "transitive.js"), "changed\n")],
  ["resolved Flow dependency", async (root: string) => writeFile(join(root, "node_modules", "@kontourai", "flow", "index.js"), "changed\n")],
] as const) test(`init apply rejects ${label} mutation before delegation`, async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-authority-drift-"));
  const planned = capture();
  await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--json"], planned.io, { cwd });
  const plan = JSON.parse(planned.read().stdout);
  await mutate(root);
  let delegated = false;
  const result = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--plan-id", plan.plan_id, "--yes"], result.io, { cwd, delegate: async () => { delegated = true; return 0; } }), 2);
  assert.equal(delegated, false);
});

test("init cleans private authority snapshots after delegated failure", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-cleanup-"));
  const planned = capture();
  await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--json"], planned.io, { cwd });
  const plan = JSON.parse(planned.read().stdout);
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-")));
  await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--plan-id", plan.plan_id, "--yes", "--json"], capture().io, { cwd, delegate: async () => 9 });
  const added = (await readdir(tmpdir())).filter((name) => name.startsWith("kontour-init-authority-") && !before.has(name));
  assert.deepEqual(added, []);
});

test("init apply rejects replacement of the canonical repository directory", async () => {
  const root = await agentsRoot();
  const cwd = await mkdtemp(join(tmpdir(), "kontour-init-root-drift-"));
  const planned = capture();
  await runCli([`--product-root=flow-agents=${root}`, "init", "--plan", "--json"], planned.io, { cwd });
  const plan = JSON.parse(planned.read().stdout);
  await rename(cwd, `${cwd}-original`);
  await mkdir(cwd);
  let delegated = false;
  const result = capture();
  assert.equal(await runCli([`--product-root=flow-agents=${root}`, "init", "--apply", "--plan-id", plan.plan_id, "--yes"], result.io, { cwd, delegate: async () => { delegated = true; return 0; } }), 2);
  assert.equal(delegated, false);
  assert.match(result.read().stderr, /KONTOUR_INIT_PLAN_INVALID/);
});
