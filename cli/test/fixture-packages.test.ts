import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const expected = [
  ["flow", "@kontourai/flow", "flow"],
  ["flow-agents", "@kontourai/flow-agents", "flow-agents"],
  ["console", "@kontourai/console", "kontour"],
] as const;

test("base product fixture packages declare packable recording bins", async () => {
  for (const [directory, packageName, binName] of expected) {
    const root = new URL(`./fixtures/packages/${directory}/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
    assert.equal(manifest.name, packageName);
    assert.equal(typeof manifest.version, "string");
    assert.equal(manifest.bin[binName], "bin/record.mjs");
    assert.deepEqual(manifest.files, ["bin"]);
    const binPath = fileURLToPath(new URL("bin/record.mjs", root));
    await access(binPath, constants.R_OK);
    assert.match(await readFile(binPath, "utf8"), /^#!\/usr\/bin\/env node/);
  }
});
