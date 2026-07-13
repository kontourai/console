import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface ImportBoundaryFinding {
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "..");
const permittedConsoleCore = new Set([
  "@kontourai/console-core/product-capability-descriptor",
  "@kontourai/console-core/product-capability-descriptor/node",
]);
const deniedExact = new Set([
  "@kontourai/console",
  "@kontourai/console-server",
  "@kontourai/console-ui",
  "node:cluster", "cluster", "node:dgram", "dgram", "node:dns", "dns",
  "node:http", "http", "node:http2", "http2", "node:https", "https",
  "node:net", "net", "node:tls", "tls", "node:vm", "vm",
  "cross-spawn", "execa", "shelljs", "npm", "npx", "undici",
]);
const deniedPrefixes = ["@kontourai/flow", "@kontourai/flow-agents", "@kontourai/station"];
const deniedSegments = ["console-server", "console-ui", "test/fixtures/packages"];

function imports(source: string): Array<{ specifier: string; dynamic: boolean }> {
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

function resolveRelative(importer: string, specifier: string): string | undefined {
  const candidate = resolve(dirname(importer), specifier);
  const candidates = extname(candidate)
    ? [candidate, ...(candidate.endsWith(".js") ? [`${candidate.slice(0, -3)}.ts`] : [])]
    : [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, `${candidate}.mjs`,
      join(candidate, "index.ts"), join(candidate, "index.js")];
  return candidates.find((item) => existsSync(item) && statSync(item).isFile());
}

export function inspectImportBoundary(entrypoints: readonly string[]): ImportBoundaryFinding[] {
  const findings: ImportBoundaryFinding[] = [];
  const pending = entrypoints.map((entrypoint) => resolve(entrypoint));
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const displayFile = relative(repositoryRoot, file).split(sep).join("/");
    const source = readFileSync(file, "utf8");
    for (const imported of imports(source)) {
      const specifier = imported.specifier;
      const deniedPackage = deniedExact.has(specifier)
        || deniedPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));
      if (deniedPackage) {
        findings.push({ file: displayFile, specifier, reason: "denied runtime dependency" });
        continue;
      }
      if (specifier.startsWith("@kontourai/console-core") && !permittedConsoleCore.has(specifier)) {
        findings.push({ file: displayFile, specifier, reason: "unapproved console-core entrypoint" });
        continue;
      }
      if ((specifier === "node:child_process" || specifier === "child_process")
          && !displayFile.endsWith("/delegate.ts") && !displayFile.endsWith("/delegate.js")) {
        findings.push({ file: displayFile, specifier, reason: "subprocess access outside delegation adapter" });
        continue;
      }
      if (!specifier.startsWith(".")) continue;
      const target = resolveRelative(file, specifier);
      if (!target) {
        findings.push({ file: displayFile, specifier, reason: "unresolved relative import" });
        continue;
      }
      const normalized = relative(repositoryRoot, target).split(sep).join("/");
      if (deniedSegments.some((segment) => normalized.includes(segment))) {
        findings.push({ file: displayFile, specifier, reason: "denied product or Console implementation path" });
        continue;
      }
      pending.push(target);
    }
    const scrubbed = source
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

function productionEntrypoints(): string[] {
  const src = join(packageRoot, "src");
  const walk = (directory: string): string[] => readFileTree(directory)
    .filter((file) => file.endsWith(".ts"));
  return walk(src);
}

function readFileTree(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    return entry.isDirectory() ? readFileTree(target) : [target];
  });
}

function main(): void {
  const negative = process.argv.includes("--negative");
  const compiled = process.argv.includes("--compiled");
  const entrypoints = negative
    ? [join(packageRoot, "test/fixtures/import-boundary/forbidden-transitive.ts")]
    : compiled
      ? readFileTree(join(packageRoot, "dist")).filter((file) => file.endsWith(".js"))
      : productionEntrypoints();
  const findings = inspectImportBoundary(entrypoints);
  if (negative) {
    const expected = findings.some((item) => item.specifier === "node:net")
      && findings.some((item) => item.specifier === "@kontourai/flow-agents");
    if (!expected) throw new Error(`Negative import-boundary fixture did not produce expected findings: ${JSON.stringify(findings)}`);
    process.stdout.write(`Import boundary negative fixture rejected (${findings.length} findings).\n`);
    return;
  }
  if (findings.length > 0) {
    process.stderr.write(`${JSON.stringify(findings, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Import boundary passed (${entrypoints.length} ${compiled ? "compiled" : "source"} production modules).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
