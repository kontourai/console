import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
}

const root = mkdtempSync(join(tmpdir(), "console-core-surface-"));
try {
  const packs = join(root, "packs");
  const consumer = join(root, "consumer");
  mkdirSync(packs);
  mkdirSync(consumer);
  const output = run("npm", ["pack", "--json", "--pack-destination", packs], packageRoot);
  const json = JSON.parse(output.slice(Math.max(0, output.lastIndexOf("\n[") + 1))) as Array<{ filename: string; files: Array<{ path: string }> }>;
  assert.equal(json.length, 1);
  const paths = new Set(json[0].files.map(({ path }) => path));
  for (const path of [
    "dist/product-capability-descriptor.js", "dist/product-capability-descriptor.d.ts",
    "dist/product-capability-descriptor-node.js", "dist/product-capability-descriptor-node.d.ts",
    "dist/intent-binding.js", "dist/intent-binding.d.ts",
    "schemas/product-capability-descriptor.schema.json",
  ]) assert.ok(paths.has(path), `packed Core missing ${path}`);

  run("npm", ["init", "-y"], consumer);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", join(packs, json[0].filename)], consumer, {
    npm_config_offline: "true", npm_config_registry: "http://127.0.0.1:9/", npm_config_cache: join(root, "cache"),
  });
  const installed = join(consumer, "node_modules/@kontourai/console-core");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as { exports: Record<string, unknown> };
  assert.ok(manifest.exports["./product-capability-descriptor"]);
  assert.ok(manifest.exports["./product-capability-descriptor/node"]);
  assert.ok(manifest.exports["./intent-binding"]);
  assert.ok(manifest.exports["./schemas/product-capability-descriptor.schema.json"]);
  for (const file of ["dist/product-capability-descriptor.js", "dist/product-capability-descriptor.d.ts", "dist/product-capability-descriptor-node.js", "dist/product-capability-descriptor-node.d.ts", "dist/intent-binding.js", "dist/intent-binding.d.ts"])
    assert.ok(existsSync(join(installed, file)), `installed Core missing ${file}`);
  run("node", ["-e", "require('@kontourai/console-core/product-capability-descriptor'); require('@kontourai/console-core/product-capability-descriptor/node'); require('@kontourai/console-core/intent-binding')"], consumer, { NODE_PATH: "" });
  run("node", ["-e", "const schema=require('@kontourai/console-core/schemas/product-capability-descriptor.schema.json'); if (!schema.$schema || !schema.$id) process.exit(1)"], consumer, { NODE_PATH: "" });
  writeFileSync(join(consumer, "consumer.ts"), [
    "import { PRODUCT_CAPABILITY_PROTOCOL_VERSION, type ProductCapabilityDescriptor, type ProductExecutableResolutionResult } from '@kontourai/console-core/product-capability-descriptor';",
    "import { resolveLocalProductExecutable } from '@kontourai/console-core/product-capability-descriptor/node';",
    "import { resolveIntentBinding, type HostIntentBinding } from '@kontourai/console-core/intent-binding';",
    "const descriptor: ProductCapabilityDescriptor | undefined = undefined;",
    "const result: ProductExecutableResolutionResult | undefined = undefined;",
    "const resolver: typeof resolveLocalProductExecutable = resolveLocalProductExecutable;",
    "const bindings: HostIntentBinding[] = [];",
    "const resolveBinding: typeof resolveIntentBinding = resolveIntentBinding;",
    "console.log(PRODUCT_CAPABILITY_PROTOCOL_VERSION, descriptor, result, resolver, bindings, resolveBinding);",
  ].join("\n"));
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "Node16", moduleResolution: "Node16", strict: true, noEmit: true, skipLibCheck: true }, files: ["consumer.ts"] }, null, 2));
  run(process.execPath, [join(repositoryRoot(), "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], consumer, { NODE_PATH: "", npm_config_offline: "true", npm_config_registry: "http://127.0.0.1:9/" });
  process.stdout.write(`Core package surface passed for ${json[0].filename}.\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function repositoryRoot(): string {
  return resolve(packageRoot, "..");
}
