import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "..");

const deniedModules = new Set([
  "node:child_process",
  "child_process",
  "node:cluster",
  "cluster",
  "node:dgram",
  "dgram",
  "node:dns",
  "dns",
  "node:http",
  "http",
  "node:http2",
  "http2",
  "node:https",
  "https",
  "node:net",
  "net",
  "node:module",
  "module",
  "node:tls",
  "tls",
  "node:vm",
  "vm",
  "node:worker_threads",
  "worker_threads",
  "cross-spawn",
  "axios",
  "execa",
  "got",
  "node-fetch",
  "shelljs",
  "undici",
  "@kontourai/console",
  "@kontourai/console-ui",
]);

const deniedPackagePrefixes = ["@kontourai/flow", "@kontourai/flow-agents"];
const deniedPathSegments = ["console-server", "console-ui"];

type BoundaryFinding = { file: string; specifier: string; reason: string };

function importedSpecifiers(source: string): Array<{ specifier: string; dynamic: boolean }> {
  const found: Array<{ specifier: string; dynamic: boolean }> = [];
  const patterns = [
    { dynamic: false, regex: /(?:^|\n)\s*(?:import|export)\s+(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']/g },
    { dynamic: false, regex: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g },
    { dynamic: true, regex: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g },
  ];
  for (const { dynamic, regex } of patterns) {
    for (const match of source.matchAll(regex)) found.push({ specifier: match[1], dynamic });
  }
  return found;
}

function resolveRelativeImport(importer: string, specifier: string): string | undefined {
  const candidate = resolve(dirname(importer), specifier);
  const candidates = extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, join(candidate, "index.ts"), join(candidate, "index.js")];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile());
}

function inspectImportBoundary(entrypoint: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const pending = [resolve(entrypoint)];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const displayFile = relative(repositoryRoot, file).split(sep).join("/");
    for (const imported of importedSpecifiers(readFileSync(file, "utf8"))) {
      const { specifier } = imported;
      if (deniedModules.has(specifier) || deniedPackagePrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
        findings.push({ file: displayFile, specifier, reason: "denied runtime dependency" });
        continue;
      }
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeImport(file, specifier);
      if (!resolved) {
        findings.push({ file: displayFile, specifier, reason: "unresolved relative import" });
        continue;
      }
      const segments = relative(repositoryRoot, resolved).split(sep);
      if (segments.some((segment) => deniedPathSegments.includes(segment))) {
        findings.push({ file: displayFile, specifier, reason: "denied Console server or UI dependency" });
        continue;
      }
      pending.push(resolved);
    }

    // Only literal dynamic imports are permitted. This prevents descriptor code
    // from becoming an executable/plugin loader while retaining contained lazy
    // loading of fixed Node platform modules.
    const scrubbed = readFileSync(file, "utf8")
      .replace(/\bimport\s*\(\s*["'][^"']+["']\s*\)/g, "")
      .replace(/\brequire\s*\(\s*["'][^"']+["']\s*\)/g, "");
    if (/\bimport\s*\(/.test(scrubbed)) {
      findings.push({ file: displayFile, specifier: "<dynamic>", reason: "non-literal dynamic import" });
    }
    if (/\brequire\s*\(/.test(scrubbed)) {
      findings.push({ file: displayFile, specifier: "<dynamic>", reason: "non-literal dynamic require" });
    }
  }
  return findings.sort((a, b) => `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`));
}

test("descriptor import boundary traverses transitive imports and rejects forbidden dependencies", () => {
  assert.deepEqual(inspectImportBoundary(join(packageRoot, "src/product-capability-descriptor.ts")), []);
  assert.deepEqual(inspectImportBoundary(join(packageRoot, "src/product-capability-descriptor-node.ts")), []);

  const negativeFindings = inspectImportBoundary(
    join(packageRoot, "test/fixtures/product-capability-descriptor-boundary/forbidden-network.ts"),
  );
  assert.deepEqual(negativeFindings, [{
    file: "console-core/test/fixtures/product-capability-descriptor-boundary/forbidden-network.ts",
    specifier: "node:net",
    reason: "denied runtime dependency",
  }]);
});

test("descriptor package builds, imports independently, and packs its schema", () => {
  execFileSync("npm", ["run", "build"], { cwd: packageRoot, encoding: "utf8", stdio: "pipe" });

  const compiledEntrypoint = join(packageRoot, "dist/product-capability-descriptor.js");
  const compiledNodeEntrypoint = join(packageRoot, "dist/product-capability-descriptor-node.js");
  execFileSync(process.execPath, ["-e", "require(process.argv[1])", compiledEntrypoint], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["-e", "require(process.argv[1])", compiledNodeEntrypoint], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  assert.deepEqual(inspectImportBoundary(compiledEntrypoint), []);
  assert.deepEqual(inspectImportBoundary(compiledNodeEntrypoint), []);

  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: "pipe",
  })) as Array<{ files: Array<{ path: string }> }>;
  const files = new Set(packed[0].files.map(({ path }) => path));
  assert.ok(files.has("dist/product-capability-descriptor.js"));
  assert.ok(files.has("dist/product-capability-descriptor.d.ts"));
  assert.ok(files.has("dist/product-capability-descriptor-node.js"));
  assert.ok(files.has("dist/product-capability-descriptor-node.d.ts"));
  assert.ok(files.has("schemas/product-capability-descriptor.schema.json"));
});
