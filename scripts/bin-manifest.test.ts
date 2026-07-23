// console#254 review HIGH finding 2: the root `@kontourai/console` package.json
// `bin` map is the ONLY thing that makes a bin actually installable/runnable
// for a published-package consumer (`npx --package @kontourai/console
// kontour-trust-bridge`, README "Bridge a flow-agents workflow-trust
// projection"). Nothing previously asserted that map against the source tree,
// so a bin could be declared without a backing script (or, going the other
// way, a real bin/*.ts could ship with no package.json entry, silently never
// installed for a published consumer) with no test catching it. This mirrors
// the coverage kontour-process-bridge should have gotten in #241 and extends
// it to a general, self-verifying rule: EVERY declared bin has a backing
// console-server/bin/<name>.ts source file and points at the matching
// compiled dist path.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(__dirname, "..");

function readRootManifest(): { bin?: Record<string, string> } {
  return JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
}

test("root package.json bin map: every declared bin points at console-server/dist/bin/<name>.js and has a backing console-server/bin/<name>.ts source", () => {
  const manifest = readRootManifest();
  assert.ok(manifest.bin && Object.keys(manifest.bin).length > 0, "package.json must declare a bin map");
  for (const [name, distPath] of Object.entries(manifest.bin!)) {
    const expectedDistPath = `console-server/dist/bin/${name}.js`;
    assert.equal(distPath, expectedDistPath, `bin "${name}" should point at ${expectedDistPath} (compiled dist path convention, mirrors kontour-flow-bridge/kontour-process-bridge)`);
    const sourcePath = resolve(repositoryRoot, "console-server/bin", `${name}.ts`);
    assert.ok(existsSync(sourcePath), `bin "${name}" is declared in package.json but has no backing source at ${sourcePath}`);
  }
});

test("root package.json bin map registers the flow-agents projection bridges (console#239 kontour-process-bridge, console#254 kontour-trust-bridge)", () => {
  const manifest = readRootManifest();
  assert.equal(manifest.bin?.["kontour-process-bridge"], "console-server/dist/bin/kontour-process-bridge.js");
  assert.equal(manifest.bin?.["kontour-trust-bridge"], "console-server/dist/bin/kontour-trust-bridge.js");
});
