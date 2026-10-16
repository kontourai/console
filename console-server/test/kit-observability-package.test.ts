import assert = require("node:assert/strict");
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");

test("packed Console consumer can require Kit observability runtime exports", { timeout: 300_000 }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "console-kit-observability-package-"));
  const packed = join(root, "packed");
  const consumerDirectory = join(root, "consumer");
  mkdirSync(packed);
  mkdirSync(consumerDirectory);
  const consumer = realpathSync(consumerDirectory);
  // npm scripts supply their CLI path; direct Windows runs use Node's bundled npm.
  // Invoke it through Node so temporary paths remain arguments, without a shell.
  const npmCli = process.env.npm_execpath ?? (process.platform === "win32"
    ? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : undefined);
  const npm = npmCli ? process.execPath : "npm";
  const npmArgs = (args: string[]) => npmCli ? [npmCli, ...args] : args;
  const npmOptions = { windowsHide: true, timeout: 120_000 };
  const coreRoot = join(repositoryRoot, "console-core");
  const candidateConsole = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  const candidateCore = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8"));

  function packPackage(packageRoot: string): string {
    const output = execFileSync(npm, npmArgs(["pack", "--json", "--pack-destination", packed]), {
      ...npmOptions, cwd: packageRoot, encoding: "utf8",
    });
    const jsonStart = output.lastIndexOf("\n[");
    const pack = JSON.parse(output.slice(jsonStart + 1)) as Array<{ filename: string }>;
    assert.equal(pack.length, 1);
    assert.ok(pack[0].filename);
    const copiedTarball = join(consumer, pack[0].filename);
    copyFileSync(join(packed, pack[0].filename), copiedTarball);
    return copiedTarball;
  }

  try {
    // Install both candidates together: the exact Core version may not be published yet.
    const coreTarball = packPackage(coreRoot);
    const consoleTarball = packPackage(repositoryRoot);

    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, name: "console-kit-observability-consumer" }));
    execFileSync(npm, npmArgs(["install", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", coreTarball, consoleTarball]), {
      ...npmOptions, cwd: consumer, stdio: "pipe",
    });
    const exported = JSON.parse(execFileSync(process.execPath, ["-e", `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const path = require("node:path");
      const { createRequire } = require("node:module");
      const consumer = fs.realpathSync(process.cwd());
      const consoleEntry = require.resolve("@kontourai/console");
      const coreEntry = createRequire(consoleEntry).resolve("@kontourai/console-core");
      const consoleRoot = path.join(consumer, "node_modules/@kontourai/console");
      const coreRoot = path.join(consumer, "node_modules/@kontourai/console-core");
      for (const [root, entry] of [[consoleRoot, consoleEntry], [coreRoot, coreEntry]]) {
        assert.equal(fs.realpathSync(root), root, "installed package must not be a workspace symlink");
        assert.ok(fs.realpathSync(entry).startsWith(root + path.sep), "runtime must resolve inside the consumer package");
      }
      const consolePackage = JSON.parse(fs.readFileSync(path.join(consoleRoot, "package.json"), "utf8"));
      const corePackage = JSON.parse(fs.readFileSync(path.join(coreRoot, "package.json"), "utf8"));
      const foundation = require("@kontourai/console");
      console.log(JSON.stringify({
        console: { name: consolePackage.name, version: consolePackage.version, coreVersion: consolePackage.dependencies["@kontourai/console-core"] },
        core: { name: corePackage.name, version: corePackage.version },
        consoleEntry, coreEntry,
        KitObservabilityHost: typeof foundation.KitObservabilityHost,
        loadKitObservabilityContractAdapter: typeof foundation.loadKitObservabilityContractAdapter,
        renderKitStandardViewText: typeof foundation.renderKitStandardViewText,
      }));
    `], { cwd: consumer, encoding: "utf8", env: { ...process.env, NODE_PATH: "" }, windowsHide: true, timeout: 30_000 }));
    assert.deepEqual(exported.console, { name: candidateConsole.name, version: candidateConsole.version, coreVersion: candidateCore.version });
    assert.deepEqual(exported.core, { name: candidateCore.name, version: candidateCore.version });
    assert.deepEqual({
      KitObservabilityHost: exported.KitObservabilityHost,
      loadKitObservabilityContractAdapter: exported.loadKitObservabilityContractAdapter,
      renderKitStandardViewText: exported.renderKitStandardViewText,
    }, {
      KitObservabilityHost: "function",
      loadKitObservabilityContractAdapter: "function",
      renderKitStandardViewText: "function",
    });
    t.diagnostic(JSON.stringify(exported));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
