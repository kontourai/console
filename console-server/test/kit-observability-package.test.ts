import assert = require("node:assert/strict");
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");

test("packed Console consumer can require Kit observability runtime exports", () => {
  const root = mkdtempSync(join(tmpdir(), "console-kit-observability-package-"));
  const packed = join(root, "packed");
  const consumer = join(root, "consumer");
  mkdirSync(packed);
  mkdirSync(consumer);

  try {
    const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", packed], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    const packJsonStart = packOutput.lastIndexOf("\n[");
    assert.ok(packJsonStart >= 0, "npm pack must finish with its JSON package manifest");
    const pack = JSON.parse(packOutput.slice(packJsonStart + 1)) as Array<{ filename: string }>;
    assert.equal(pack.length, 1);
    assert.ok(pack[0].filename);

    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, name: "console-kit-observability-consumer" }));
    execFileSync("npm", ["install", "--ignore-scripts", "--no-package-lock", join(packed, pack[0].filename)], {
      cwd: consumer,
      stdio: "pipe",
    });
    const exported = JSON.parse(execFileSync(process.execPath, ["-e", `
      const foundation = require("@kontourai/console");
      console.log(JSON.stringify({
        KitObservabilityHost: typeof foundation.KitObservabilityHost,
        loadKitObservabilityContractAdapter: typeof foundation.loadKitObservabilityContractAdapter,
        renderKitStandardViewText: typeof foundation.renderKitStandardViewText,
      }));
    `], { cwd: consumer, encoding: "utf8" }));
    assert.deepEqual(exported, {
      KitObservabilityHost: "function",
      loadKitObservabilityContractAdapter: "function",
      renderKitStandardViewText: "function",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
