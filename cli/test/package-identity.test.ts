import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { CLI_PACKAGE_VERSION, parseCliPackageIdentity, readCliPackageIdentityFile } from "../src/package-identity";

const cliRoot = resolve(import.meta.dirname, "..");

test("CLI package identity comes from the adjacent package manifest", async () => {
  const manifest = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8"));
  assert.equal(CLI_PACKAGE_VERSION, manifest.version);
  assert.deepEqual(parseCliPackageIdentity({ name: "@kontourai/cli", version: "0.3.0" }), { name: "@kontourai/cli", version: "0.3.0" });
});

for (const invalid of [
  null,
  { name: "@kontourai/other", version: "0.3.0" },
  { name: "@kontourai/cli", version: "latest" },
  { name: "@kontourai/cli", version: "^0.3.0" },
  { name: "@kontourai/cli", version: "01.2.3" },
  { name: "@kontourai/cli", version: "1.2.3-01" },
]) test(`CLI package identity rejects ${JSON.stringify(invalid)}`, () => {
  assert.throws(() => parseCliPackageIdentity(invalid), /KONTOUR_CLI_PACKAGE_IDENTITY_INVALID/);
});

test("CLI package identity securely rejects symlink, oversized, directory, and malformed manifest inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "kontour-cli-hostile-manifest-"));
  const valid = join(root, "valid.json");
  const linked = join(root, "linked.json");
  const oversized = join(root, "oversized.json");
  const malformed = join(root, "malformed.json");
  await writeFile(valid, `${JSON.stringify({ name: "@kontourai/cli", version: "0.3.0" })}\n`);
  await symlink(valid, linked);
  await writeFile(oversized, Buffer.alloc(1024 * 1024 + 1, 0x20));
  await writeFile(malformed, "{not-json\n");
  assert.throws(() => readCliPackageIdentityFile(linked), /KONTOUR_CLI_PACKAGE_IDENTITY_INVALID/);
  assert.throws(() => readCliPackageIdentityFile(oversized), /KONTOUR_CLI_PACKAGE_IDENTITY_INVALID/);
  assert.throws(() => readCliPackageIdentityFile(root), /KONTOUR_CLI_PACKAGE_IDENTITY_INVALID/);
  assert.throws(() => readCliPackageIdentityFile(malformed), /KONTOUR_CLI_PACKAGE_IDENTITY_INVALID/);
  assert.equal(readCliPackageIdentityFile(valid).version, "0.3.0");
});

test("compiled init plan follows a staged Release Please manifest and binds the version into plan id", async () => {
  async function stagedPlan(version: string): Promise<{ pins: { cli: string }; plan_id: string }> {
    const stage = await mkdtemp(join(tmpdir(), "kontour-cli-version-stage-"));
    const dist = join(stage, "dist");
    await mkdir(dist);
    for (const moduleName of ["package-identity", "init-plan"]) {
      const source = await readFile(join(cliRoot, "src", `${moduleName}.ts`), "utf8");
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      await writeFile(join(dist, `${moduleName}.js`), compiled);
    }
    await writeFile(join(stage, "package.json"), `${JSON.stringify({ name: "@kontourai/cli", version, type: "commonjs" })}\n`);
    const script = `const {buildInitPlan}=require(process.argv[1]); const plan=buildInitPlan({cwd:"/repo",repositoryRealpath:"/repo",repositoryDev:1,repositoryIno:2,interpreter:{realpath:"/node",dev:3,ino:4,sha256:"a".repeat(64)},runtime:"codex",kits:[],flowAgentsVersion:"3.8.0",packageRoot:"/agents",executableRealpath:"/agents/bin.js",rootInstanceId:"/agents",authorityPackages:[]}); process.stdout.write(JSON.stringify(plan))`;
    return JSON.parse(execFileSync(process.execPath, ["-e", script, join(dist, "init-plan.js")], { cwd: tmpdir(), encoding: "utf8" }));
  }
  const releasePlan = await stagedPlan("0.3.0");
  const futurePlan = await stagedPlan("0.4.0");
  assert.equal(releasePlan.pins.cli, "0.3.0");
  assert.equal(futurePlan.pins.cli, "0.4.0");
  assert.notEqual(releasePlan.plan_id, futurePlan.plan_id);
});
