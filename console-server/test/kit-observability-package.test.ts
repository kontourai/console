import assert = require("node:assert/strict");
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");

test("packed Console and Server consumers typecheck and require Kit exports without Flow Agents", { timeout: 300_000 }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "console-kit-observability-package-"));
  const packed = join(root, "packed");
  mkdirSync(packed);
  // npm scripts supply their CLI path; direct Windows runs use Node's bundled npm.
  // Invoke it through Node so temporary paths remain arguments, without a shell.
  const npmCli = process.env.npm_execpath ?? (process.platform === "win32"
    ? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
    : undefined);
  const npm = npmCli ? process.execPath : "npm";
  const npmArgs = (args: string[]) => npmCli ? [npmCli, ...args] : args;
  const npmOptions = { windowsHide: true, timeout: 120_000 };
  const coreRoot = join(repositoryRoot, "console-core");
  const candidateCore = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8"));

  function packPackage(packageRoot: string): string {
    const output = execFileSync(npm, npmArgs(["pack", "--json", "--pack-destination", packed]), {
      ...npmOptions, cwd: packageRoot, encoding: "utf8",
    });
    const jsonStart = output.lastIndexOf("\n[");
    const pack = JSON.parse(output.slice(jsonStart + 1)) as Array<{ filename: string }>;
    assert.equal(pack.length, 1);
    assert.ok(pack[0].filename);
    return join(packed, pack[0].filename);
  }

  try {
    // Install both candidates together: the exact Core version may not be published yet.
    const coreTarball = packPackage(coreRoot);
    const targets = [repositoryRoot, join(repositoryRoot, "console-server")].map((packageRoot) => ({
      manifest: JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
      tarball: packPackage(packageRoot),
    }));
    const compilerVersion = JSON.parse(readFileSync(join(repositoryRoot, "node_modules/typescript/package.json"), "utf8")).version;
    const nodeTypesVersion = JSON.parse(readFileSync(join(repositoryRoot, "node_modules/@types/node/package.json"), "utf8")).version;

    for (const target of targets) {
      const consumerDirectory = join(root, target.manifest.name.split("/").pop());
      mkdirSync(consumerDirectory);
      const consumer = realpathSync(consumerDirectory);
      const tarballs = [coreTarball, target.tarball].map((tarball) => {
        const copied = join(consumer, basename(tarball));
        copyFileSync(tarball, copied);
        return copied;
      });

      writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, name: "console-kit-observability-consumer" }));
      execFileSync(npm, npmArgs(["install", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", ...tarballs, `typescript@${compilerVersion}`, `@types/node@${nodeTypesVersion}`]), {
        ...npmOptions, cwd: consumer, stdio: "pipe",
      });
      assert.equal(existsSync(join(consumer, "node_modules/@kontourai/flow-agents")), false, "Flow Agents must remain absent");
      writeFileSync(join(consumer, "consumer.ts"), `
        import { KitObservabilityHost, loadKitObservabilityContractAdapter, renderKitStandardViewText,
          type KitObservabilityContractAdapter } from "${target.manifest.name}";
        const constructor: typeof KitObservabilityHost = KitObservabilityHost;
        const load: () => Promise<KitObservabilityContractAdapter> = loadKitObservabilityContractAdapter;
        const rendered: string = renderKitStandardViewText("<consumer>");
        void [constructor, load, rendered];
      `);
      writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "Node16", moduleResolution: "Node16", strict: true,
          noEmit: true, skipLibCheck: false, types: ["node"] },
        files: ["consumer.ts"],
      }));
      execFileSync(process.execPath, [join(consumer, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
        cwd: consumer, encoding: "utf8", env: { ...process.env, NODE_PATH: "" }, windowsHide: true, timeout: 30_000,
      });
      const exported = JSON.parse(execFileSync(process.execPath, ["-e", `
        (async () => {
        const assert = require("node:assert/strict");
        const fs = require("node:fs");
        const path = require("node:path");
        const { createRequire } = require("node:module");
        const consumer = fs.realpathSync(process.cwd());
        const consoleEntry = require.resolve(${JSON.stringify(target.manifest.name)});
        const coreEntry = createRequire(consoleEntry).resolve("@kontourai/console-core");
        const consoleRoot = path.join(consumer, "node_modules", ${JSON.stringify(target.manifest.name)});
        const coreRoot = path.join(consumer, "node_modules/@kontourai/console-core");
        for (const [root, entry] of [[consoleRoot, consoleEntry], [coreRoot, coreEntry]]) {
          assert.equal(fs.realpathSync(root), root, "installed package must not be a workspace symlink");
          assert.ok(fs.realpathSync(entry).startsWith(root + path.sep), "runtime must resolve inside the consumer package");
        }
        const consolePackage = JSON.parse(fs.readFileSync(path.join(consoleRoot, "package.json"), "utf8"));
        const corePackage = JSON.parse(fs.readFileSync(path.join(coreRoot, "package.json"), "utf8"));
        const foundation = require(${JSON.stringify(target.manifest.name)});
        await assert.rejects(() => foundation.loadKitObservabilityContractAdapter(), { code: "ERR_MODULE_NOT_FOUND" });
        console.log(JSON.stringify({
          console: { name: consolePackage.name, version: consolePackage.version, coreVersion: consolePackage.dependencies["@kontourai/console-core"] },
          core: { name: corePackage.name, version: corePackage.version },
          consoleEntry, coreEntry,
          KitObservabilityHost: typeof foundation.KitObservabilityHost,
          loadKitObservabilityContractAdapter: typeof foundation.loadKitObservabilityContractAdapter,
          renderKitStandardViewText: typeof foundation.renderKitStandardViewText,
        }));
        })().catch((error) => { console.error(error); process.exitCode = 1; });
      `], { cwd: consumer, encoding: "utf8", env: { ...process.env, NODE_PATH: "" }, windowsHide: true, timeout: 30_000 }));
      assert.deepEqual(exported.console, { name: target.manifest.name, version: target.manifest.version, coreVersion: candidateCore.version });
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
      t.diagnostic(JSON.stringify({ ...exported, typecheck: "passed", flowAgents: "absent" }));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
