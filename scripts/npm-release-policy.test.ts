import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertExactCoreMetadata, assertTagVersion, resolveCoreRegistryManifest, selectRelease } from "./npm-release-policy";

test("release tag selection is behavioral and unambiguous", () => {
  assert.deepEqual(selectRelease("v2.6.0"), { workspace: ".", manifest: "package.json", tagPrefix: "v" });
  assert.deepEqual(selectRelease("cli-v0.3.1"), { workspace: "@kontourai/cli", manifest: "cli/package.json", tagPrefix: "cli-v" });
  assert.deepEqual(selectRelease("console-core-v0.2.0"), { workspace: "@kontourai/console-core", manifest: "console-core/package.json", tagPrefix: "console-core-v" });
  assert.deepEqual(selectRelease("console-server-v0.1.0"), { workspace: "@kontourai/console-server", manifest: "console-server/package.json", tagPrefix: "console-server-v" });
  assert.throws(() => selectRelease("core-v0.2.0"), /Unsupported/);
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
  const good = {
    version: "0.2.0",
    exports: { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {}, "./intent-binding": {} },
  };
  assert.doesNotThrow(() => assertExactCoreMetadata("0.2.0", good));
  for (const spec of ["^0.2.0", "latest", "file:../core", "workspace:*", "git+https://example.test/core.git", undefined])
    assert.throws(() => assertExactCoreMetadata(spec, good), /exact semver/);
  for (const metadata of [
    undefined, "bad", {}, { version: "0.1.0", exports: good.exports }, { version: "0.2.0", exports: {} },
    { version: "0.2.0", exports: { "./product-capability-descriptor": {} } },
    // console#232/C5 (2026-07-20 security review, finding 4): a Core missing
    // ONLY ./intent-binding must still fail closed, even with both
    // descriptor exports present.
    { version: "0.2.0", exports: { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {} } },
  ]) assert.throws(() => assertExactCoreMetadata("0.2.0", metadata), /intent-binding|exports|Core/);
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


test("Core registry metadata is normalized across npm CLI output shapes (console#264)", () => {
  const manifest = {
    version: "0.3.0",
    exports: { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {}, "./intent-binding": {} },
  };

  // Shape 1: the bare exact-version manifest object, as returned by the npm
  // versions this repo previously ran against.
  assert.deepEqual(resolveCoreRegistryManifest("0.3.0", manifest), manifest);

  // Shape 2: array-wrapped single result. Empirically confirmed against
  // `npx -y npm@latest view @kontourai/console-core@<exact> --json` (npm
  // 12.0.1, 2026-07-24): the manifest fields are returned merged at the top
  // level of a single-element array (this is what actually broke cli-v0.5.0).
  assert.deepEqual(resolveCoreRegistryManifest("0.3.0", [manifest]), manifest);

  // Shape 3: a full packument (`.versions` keyed by version string, alongside
  // `dist-tags`) rather than a pre-resolved single manifest.
  const packument = { name: "@kontourai/console-core", "dist-tags": { latest: "0.3.0" }, versions: { "0.2.0": { version: "0.2.0" }, "0.3.0": manifest } };
  assert.deepEqual(resolveCoreRegistryManifest("0.3.0", packument), manifest);

  // Garbage shapes must fail closed, not silently resolve to something the
  // assertion layer happens to accept.
  assert.throws(() => resolveCoreRegistryManifest("0.3.0", []), /exactly one entry, got 0/);
  assert.throws(() => resolveCoreRegistryManifest("0.3.0", [manifest, manifest]), /exactly one entry, got 2/);

  // End-to-end: each normalized shape must still satisfy the full exports gate.
  for (const raw of [manifest, [manifest], packument])
    assert.doesNotThrow(() => assertExactCoreMetadata("0.3.0", resolveCoreRegistryManifest("0.3.0", raw)));

  // A packument missing the requested version key is not a recognized
  // packument shape for that spec — it falls through unresolved and must
  // still fail closed downstream (version won't match spec).
  const stalePackument = { versions: { "0.2.0": { version: "0.2.0" } }, "dist-tags": { latest: "0.2.0" } };
  assert.throws(() => assertExactCoreMetadata("0.3.0", resolveCoreRegistryManifest("0.3.0", stalePackument)), /not registry-visible/);
});

test("real npm@latest array-wrapped output (captured 2026-07-24, npm 12.0.1) passes the gate after normalization", () => {
  // Trimmed capture of `npx -y npm@latest view @kontourai/console-core@0.3.0
  // --json` — the exact shape that broke cli-v0.5.0 in production.
  const rawCapture = [
    {
      name: "@kontourai/console-core",
      "dist-tags": { latest: "0.3.0" },
      versions: ["0.1.0", "0.2.0", "0.3.0"],
      version: "0.3.0",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./product-capability-descriptor": { types: "./dist/product-capability-descriptor.d.ts", default: "./dist/product-capability-descriptor.js" },
        "./product-capability-descriptor/node": { types: "./dist/product-capability-descriptor-node.d.ts", default: "./dist/product-capability-descriptor-node.js" },
        "./intent-binding": { types: "./dist/intent-binding.d.ts", default: "./dist/intent-binding.js" },
        "./schemas/product-capability-descriptor.schema.json": { default: "./schemas/product-capability-descriptor.schema.json" },
      },
    },
  ];
  assert.doesNotThrow(() => assertExactCoreMetadata("0.3.0", resolveCoreRegistryManifest("0.3.0", rawCapture)));
  // Unresolved (pre-console#264 behavior): the array itself must still be
  // rejected directly by assertExactCoreMetadata's own object/array guard.
  assert.throws(() => assertExactCoreMetadata("0.3.0", rawCapture), /Core registry metadata must be an object/);
});
