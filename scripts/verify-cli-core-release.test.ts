import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

function makeFakeNpm(directory: string, viewJson: unknown, exitCode = 0, spec = "0.3.0"): void {
  const fakeNpmPath = join(directory, "npm");
  writeFileSync(
    fakeNpmPath,
    `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === "view" && args[1] === ${JSON.stringify("@kontourai/console-core@" + spec)} && args[args.length - 1] === "--json") {\n  process.stdout.write(${JSON.stringify(JSON.stringify(viewJson))});\n  process.exit(${exitCode});\n}\nprocess.stderr.write("unsupported fake npm invocation: " + args.join(" ") + "\\n");\nprocess.exit(1);\n`,
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

const requiredExports = { "./product-capability-descriptor": {}, "./product-capability-descriptor/node": {}, "./intent-binding": {} };
for (const [name, manifestPath] of [
  ["@kontourai/console", "package.json"],
  ["@kontourai/console-server", "console-server/package.json"],
  ["@kontourai/console-ui", "console-ui/package.json"],
]) {
  for (const control of ["absent", "wrong-version", "missing-descriptor", "missing-intent-binding", "valid"] as const) {
    test(`${name} resolved tag manifest: ${control} Core registry control`, () => {
      const root = mkdtempSync(join(tmpdir(), "verify-target-core-"));
      try {
        const manifest = join(root, manifestPath);
        mkdirSync(dirname(manifest), { recursive: true });
        // Deliberately differs from main's pin: the resolved tag owns this value.
        writeFileSync(manifest, JSON.stringify({ name, dependencies: { "@kontourai/console-core": "0.4.0" } }));
        linkRepoNodeModules(root);
        const npmBin = join(root, "npm-bin");
        mkdirSync(npmBin);
        const exports = { ...requiredExports } as Record<string, unknown>;
        if (control === "missing-descriptor") delete exports["./product-capability-descriptor/node"];
        if (control === "missing-intent-binding") delete exports["./intent-binding"];
        makeFakeNpm(npmBin, control === "absent" ? { error: { code: "E404" } } : {
          version: control === "wrong-version" ? "0.3.0" : "0.4.0", exports,
        }, control === "absent" ? 1 : 0, "0.4.0");
        const result = spawnSync(process.execPath, ["--import", "tsx", scriptPath], {
          cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000,
          env: { ...process.env, PATH: `${npmBin}:${process.env.PATH}`, PACKAGE_MANIFEST: manifestPath },
        });
        if (control === "valid") {
          assert.equal(result.status, 0, result.stderr);
          assert.match(result.stdout, /Confirmed compatible @kontourai\/console-core@0\.4\.0/);
          assert.ok(result.stdout.includes(manifestPath));
        } else {
          assert.equal(result.status, 1, result.stderr);
          assert.doesNotMatch(result.stdout, /Confirmed compatible/);
          assert.match(result.stderr, control === "absent" ? /Command failed/ : control === "wrong-version" ? /not registry-visible/ : /required.*export/);
        }
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
}

test("Core publication does not look up itself, but a self-dependency is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "verify-core-self-"));
  try {
    mkdirSync(join(root, "console-core"));
    const manifest = join(root, "console-core/package.json");
    writeFileSync(manifest, JSON.stringify({ name: "@kontourai/console-core" }));
    linkRepoNodeModules(root);
    const npmBin = join(root, "npm-bin");
    mkdirSync(npmBin);
    makeFakeNpm(npmBin, {}, 97); // Any lookup would fail this acceptance control.
    const options = { cwd: root, encoding: "utf8" as const, windowsHide: true, timeout: 30_000,
      env: { ...process.env, PATH: `${npmBin}:${process.env.PATH}`, PACKAGE_MANIFEST: "console-core/package.json" } };
    const stdout = execFileSync(process.execPath, ["--import", "tsx", scriptPath], options);
    assert.match(stdout, /Core publication has no Core dependency to verify/);
    writeFileSync(manifest, JSON.stringify({ name: "@kontourai/console-core", dependencies: { "@kontourai/console-core": "0.4.0" } }));
    assert.throws(() => execFileSync(process.execPath, ["--import", "tsx", scriptPath], { ...options, stdio: "pipe" }), /Core must not depend on itself/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
