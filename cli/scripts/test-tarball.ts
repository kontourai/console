import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(cliRoot, "..");

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

function runCombined(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function pack(packageRoot: string, destination: string): string {
  const output = run("npm", ["pack", "--json", "--pack-destination", destination], packageRoot);
  const jsonStart = output.lastIndexOf("\n[");
  const result = JSON.parse(output.slice(jsonStart < 0 ? 0 : jsonStart + 1)) as Array<{ filename: string }>;
  assert.equal(result.length, 1, `Expected one tarball from ${packageRoot}`);
  return join(destination, result[0].filename);
}

function installOffline(project: string, tarballs: readonly string[], cache: string): void {
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", ...tarballs], project, {
    npm_config_offline: "true",
    npm_config_cache: cache,
    npm_config_registry: "http://127.0.0.1:9/registry/",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
  });
}

function assertPackedCli(project: string): string {
  const installed = join(project, "node_modules/@kontourai/cli");
  for (const file of [
    "dist/bin/kontour.js",
    "descriptors/flow.json",
    "descriptors/flow-agents.json",
    "descriptors/console.json",
    "schemas/router-output.schema.json",
  ]) assert.ok(existsSync(join(installed, file)), `packed @kontourai/cli is missing ${file}`);
  const executable = join(project, "node_modules/.bin/kontour");
  assert.ok(existsSync(executable), "packed @kontourai/cli did not install its advertised kontour bin");
  return executable;
}

function cliSmoke(root: string, tarballs: string[]): void {
  const project = join(root, "cli-project");
  const cache = join(root, "offline-cache-cli");
  run("npm", ["init", "-y"], project);
  installOffline(project, tarballs, cache);
  const kontour = assertPackedCli(project);
  const packageRoot = (product: string) => join(project, "node_modules/@kontourai", product);
  const roots = [
    `--product-root=flow=${packageRoot("flow")}`,
    `--product-root=flow-agents=${packageRoot("flow-agents")}`,
    `--product-root=console=${packageRoot("console")}`,
  ];
  const cleanEnv = { NODE_PATH: "", npm_config_offline: "true", npm_config_registry: "http://127.0.0.1:9/" };
  const products = run(kontour, [...roots, "products", "--json"], project, cleanEnv);
  assert.match(products, /"schemaVersion"|"schema_version"/, "installed CLI did not emit versioned discovery JSON");

  const recordFile = join(root, "routes.jsonl");
  const routeEnv = { ...cleanEnv, KONTOUR_RECORD_FILE: recordFile };
  run(kontour, [...roots, "flow", "kit", "validate", "--fixture-arg"], project, routeEnv);
  run(kontour, [...roots, "flow", "agents", "kit", "status", "--fixture-arg"], project, routeEnv);
  run(kontour, [...roots, "console", "serve", "--help"], project, routeEnv);
  const records = readFileSync(recordFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { product: string });
  assert.deepEqual(records.map(({ product }) => product), ["flow", "flow-agents", "console"]);
}

function legacyConsoleSmoke(root: string, rootTarball: string, dependencyTarballs: string[]): void {
  const project = join(root, "legacy-project");
  const cache = join(root, "offline-cache-legacy");
  run("npm", ["init", "-y"], project);
  installOffline(project, [rootTarball, ...dependencyTarballs], cache);
  const packageJson = JSON.parse(readFileSync(join(project, "node_modules/@kontourai/console/package.json"), "utf8")) as {
    bin?: Record<string, string>;
  };
  assert.equal(packageJson.bin?.kontour, "console-server/dist/bin/kontour.js");
  const kontour = join(project, "node_modules/.bin/kontour");
  assert.ok(existsSync(kontour), "legacy @kontourai/console tarball did not install kontour bin");
  const help = runCombined(kontour, ["serve", "--help"], project, { NODE_PATH: "", npm_config_offline: "true" });
  assert.match(help, /Usage: kontour serve/);
}

function main(): void {
  const root = mkdtempSync(join(tmpdir(), "kontour-cli-tarball-"));
  const packs = join(root, "packs");
  const makeDirectory = (path: string): void => { mkdirSync(path, { recursive: true }); };
  makeDirectory(packs);
  makeDirectory(join(root, "cli-project"));
  makeDirectory(join(root, "legacy-project"));
  try {
    // Build/package while the checkout is available. Everything below the pack
    // calls installs and executes with npm offline and no source NODE_PATH.
    const consoleCore = pack(join(repositoryRoot, "console-core"), packs);
    const cli = pack(cliRoot, packs);
    const fixtures = ["flow", "flow-agents", "console"].map((name) =>
      pack(join(cliRoot, "test/fixtures/packages", name), packs));
    let cliFailure: unknown;
    try {
      cliSmoke(root, [cli, consoleCore, ...fixtures]);
    } catch (error) {
      cliFailure = error;
    }
    // Pack the root only after the fixture install: both intentionally own the
    // @kontourai/console name/version and therefore the same tarball filename.
    const rootConsole = pack(repositoryRoot, packs);
    const telemetry = pack(join(repositoryRoot, "telemetry"), packs);
    const jose = pack(join(repositoryRoot, "node_modules/jose"), packs);
    legacyConsoleSmoke(root, rootConsole, [consoleCore, telemetry, jose]);
    if (cliFailure) throw cliFailure;
    process.stdout.write(`Tarball smoke passed: ${basename(cli)}, three product fixtures, and ${basename(rootConsole)}.\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
