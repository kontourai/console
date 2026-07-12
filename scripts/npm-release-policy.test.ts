import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertExactCoreMetadata, assertTagVersion, selectRelease } from "./npm-release-policy";

test("release tag selection is behavioral and unambiguous", () => {
  assert.deepEqual(selectRelease("v2.6.0"), { workspace: ".", manifest: "package.json", tagPrefix: "v" });
  assert.deepEqual(selectRelease("cli-v0.3.1"), { workspace: "@kontourai/cli", manifest: "cli/package.json", tagPrefix: "cli-v" });
  assert.deepEqual(selectRelease("console-core-v0.2.0"), { workspace: "@kontourai/console-core", manifest: "console-core/package.json", tagPrefix: "console-core-v" });
  assert.throws(() => selectRelease("core-v0.2.0"), /Unsupported/);
  assert.throws(() => selectRelease("console-server-v0.1.0"), /Unsupported/);
  assert.throws(() => selectRelease("server-v0.1.0"), /Unsupported/);
  assert.doesNotThrow(() => assertTagVersion("cli-v0.3.1", "cli-v", "0.3.1"));
  assert.throws(() => assertTagVersion("cli-v0.3.1", "cli-v", "0.3.0"), /does not match/);
});

test("workflow selection entrypoint writes GitHub outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "release-selection-"));
  try {
    const output = join(root, "output");
    execFileSync(process.execPath, ["--import", "tsx", join(__dirname, "npm-release-policy.ts"), "select", "console-core-v0.2.0"], { env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.equal(readFileSync(output, "utf8"), "workspace=@kontourai/console-core\nmanifest=console-core/package.json\ntag_prefix=console-core-v\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI Core registry gate accepts only exact matching compatible metadata", () => {
  const good = { version: "0.2.0", exports: { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {} } };
  assert.doesNotThrow(() => assertExactCoreMetadata("0.2.0", good));
  for (const spec of ["^0.2.0", "latest", "file:../core", "workspace:*", "git+https://example.test/core.git", undefined])
    assert.throws(() => assertExactCoreMetadata(spec, good), /exact semver/);
  for (const metadata of [undefined, "bad", {}, { version: "0.1.0", exports: good.exports }, { version: "0.2.0", exports: {} }, { version: "0.2.0", exports: { "./product-capability-descriptor": {} } }])
    assert.throws(() => assertExactCoreMetadata("0.2.0", metadata));
});

test("publish ordering stops before publish when Core lookup fails", async () => {
  const events: string[] = [];
  const release = async (lookup: () => Promise<unknown>) => {
    events.push("lookup");
    assertExactCoreMetadata("0.2.0", await lookup());
    events.push("publish");
  };
  await assert.rejects(release(async () => { throw new Error("E401 auth failure"); }), /E401/);
  assert.deepEqual(events, ["lookup"]);
});
