import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// console#264: verify-cli-core-release.ts must (Route A) read package
// manifests from the invoking process's working directory — NOT from its own
// on-disk location — so publish-npm.yml can execute a fixed copy of this
// script from a separate `console-main` checkout while manifest data stays
// authoritative from the immutable tag checkout. And (Route B) it must
// tolerate npm CLI output-shape drift (array-wrapped single result) without
// failing closed on shape alone.
const scriptPath = join(__dirname, "verify-cli-core-release.ts");
const repoNodeModules = join(__dirname, "..", "node_modules");

// `node --import tsx` resolves the bare "tsx" specifier by walking up from
// the spawned process's cwd, not from the script's own file location.
// Fixture cwds live under a fresh tmpdir with no node_modules of their own,
// so link the repo's node_modules in so the child process can resolve tsx —
// this mirrors the real workflow, where `working-directory: console` cwd
// has its own `npm ci`-installed node_modules.
function linkRepoNodeModules(cwdDirectory: string): void {
  symlinkSync(repoNodeModules, join(cwdDirectory, "node_modules"), "dir");
}

function makeFakeNpm(directory: string, viewJson: unknown): void {
  const fakeNpmPath = join(directory, "npm");
  writeFileSync(
    fakeNpmPath,
    `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === "view" && args[args.length - 1] === "--json") {\n  process.stdout.write(${JSON.stringify(JSON.stringify(viewJson))});\n  process.exit(0);\n}\nprocess.stderr.write("unsupported fake npm invocation: " + args.join(" ") + "\\n");\nprocess.exit(1);\n`,
  );
  chmodSync(fakeNpmPath, 0o755);
}

test("root resolves from process.cwd(), not the script's own directory, so a main-checked-out copy still reads the tag's manifest (Route A)", () => {
  const root = mkdtempSync(join(tmpdir(), "verify-cli-core-release-"));
  try {
    // Simulate the tag checkout: only manifest data lives here.
    const tagCheckout = join(root, "console");
    mkdirSync(join(tagCheckout, "console-server"), { recursive: true });
    writeFileSync(join(tagCheckout, "console-server", "package.json"), JSON.stringify({ name: "@kontourai/console-server", dependencies: { "@kontourai/console-core": "0.3.0" } }));
    linkRepoNodeModules(tagCheckout);

    // Simulate the separately checked-out main scripts/ directory. The script
    // is invoked from HERE, but must not read manifests from here.
    const bogusManifest = join(root, "console-server-should-not-be-read");
    mkdirSync(bogusManifest, { recursive: true });

    const npmBin = join(root, "npm-bin");
    mkdirSync(npmBin);
    makeFakeNpm(npmBin, [
      {
        version: "0.3.0",
        exports: { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {}, "./intent-binding": {} },
      },
    ]);

    const stdout = execFileSync(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: tagCheckout,
      encoding: "utf8",
      env: { ...process.env, PATH: `${npmBin}:${process.env.PATH}`, PACKAGE_MANIFEST: "console-server/package.json" },
    });
    assert.match(stdout, /Confirmed compatible @kontourai\/console-core@0\.3\.0 on npm/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("array-wrapped npm@latest output shape (console#264 root cause) no longer fails the gate (Route B)", () => {
  const root = mkdtempSync(join(tmpdir(), "verify-cli-core-release-"));
  try {
    mkdirSync(join(root, "console-server"), { recursive: true });
    writeFileSync(join(root, "console-server", "package.json"), JSON.stringify({ name: "@kontourai/console-server", dependencies: { "@kontourai/console-core": "0.3.0" } }));
    linkRepoNodeModules(root);

    const npmBin = join(root, "npm-bin");
    mkdirSync(npmBin);
    // Array-wrapped — the exact shape empirically captured from
    // `npx -y npm@latest view @kontourai/console-core@0.3.0 --json` (npm 12.0.1).
    makeFakeNpm(npmBin, [
      {
        version: "0.3.0",
        versions: ["0.1.0", "0.2.0", "0.3.0"],
        exports: { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {}, "./intent-binding": {} },
      },
    ]);

    const stdout = execFileSync(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${npmBin}:${process.env.PATH}`, PACKAGE_MANIFEST: "console-server/package.json" },
    });
    assert.match(stdout, /Confirmed compatible @kontourai\/console-core@0\.3\.0 on npm/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Core missing the required intent-binding export still fails closed after shape normalization", () => {
  const root = mkdtempSync(join(tmpdir(), "verify-cli-core-release-"));
  try {
    mkdirSync(join(root, "console-server"), { recursive: true });
    writeFileSync(join(root, "console-server", "package.json"), JSON.stringify({ name: "@kontourai/console-server", dependencies: { "@kontourai/console-core": "0.3.0" } }));
    linkRepoNodeModules(root);

    const npmBin = join(root, "npm-bin");
    mkdirSync(npmBin);
    makeFakeNpm(npmBin, [
      { version: "0.3.0", exports: { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {} } },
    ]);

    assert.throws(
      () =>
        execFileSync(process.execPath, ["--import", "tsx", scriptPath], {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, PATH: `${npmBin}:${process.env.PATH}`, PACKAGE_MANIFEST: "console-server/package.json" },
          stdio: ["ignore", "pipe", "pipe"],
        }),
      /intent-binding/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
