import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (result.status !== 0) {
    // tsc writes diagnostics to stdout, not stderr; include both so a failure
    // here is diagnosable from this error alone.
    throw new Error(`${command} exited ${result.status}: ${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function pack(packageRoot: string, destination: string, options: { ignoreScripts?: boolean } = {}): string {
  const args = ["pack", "--json", "--pack-destination", destination];
  if (options.ignoreScripts) args.push("--ignore-scripts");
  const output = run("npm", args, packageRoot);
  const jsonStart = output.lastIndexOf("\n[");
  const result = JSON.parse(output.slice(jsonStart < 0 ? 0 : jsonStart + 1)) as Array<{ filename: string }>;
  assert.equal(result.length, 1, `Expected one tarball from ${packageRoot}`);
  return join(destination, result[0].filename);
}

// Stages a copy of an already-installed node_modules package with its
// `scripts` field stripped from the STAGED manifest, so `npm pack` on the
// staged copy can never invoke a lifecycle script. This is required, not just
// defensive: npm's `--ignore-scripts` (and `npm_config_ignore_scripts=true`)
// handling for the `prepare` lifecycle is inconsistent across npm major
// versions — npm 10.x (bundled with Node 22) still runs `prepare` on
// `npm pack` despite both, while npm 11.x (bundled with Node 24) does not
// (reproduced directly against a downloaded Node 22.18.0/npm 10.9.3 before
// this fix, confirmed both suppression attempts alone were insufficient).
// These installed copies carry only published-package content (no dev
// source), so any `prepare`/`build` script here always fails regardless — its
// dev-only build inputs are absent — and is never needed for our purpose (we
// only read the already-built `dist` output already present in node_modules).
function stageForPack(sourceDir: string, stagingRoot: string): string {
  const staged = join(stagingRoot, basename(sourceDir));
  mkdirSync(staged);
  cpSync(sourceDir, staged, { recursive: true });
  const manifestPath = join(staged, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  delete manifest.scripts;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return staged;
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
    "schemas/init-plan.schema.json",
  ]) assert.ok(existsSync(join(installed, file)), `packed @kontourai/cli is missing ${file}`);
  const executable = join(project, "node_modules/.bin/kontour");
  assert.ok(existsSync(executable), "packed @kontourai/cli did not install its advertised kontour bin");
  return executable;
}

function assertPackedCore(project: string): void {
  const installed = join(project, "node_modules/@kontourai/console-core");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as { exports?: Record<string, unknown> };
  for (const subpath of ["./product-capability-descriptor", "./product-capability-descriptor/node"])
    assert.ok(manifest.exports?.[subpath], `packed Core is missing export ${subpath}`);
  for (const file of [
    "dist/product-capability-descriptor.js", "dist/product-capability-descriptor.d.ts",
    "dist/product-capability-descriptor-node.js", "dist/product-capability-descriptor-node.d.ts",
    "schemas/product-capability-descriptor.schema.json",
  ]) assert.ok(existsSync(join(installed, file)), `packed Core is missing ${file}`);
  run("node", ["-e", "require('@kontourai/console-core/product-capability-descriptor'); require('@kontourai/console-core/product-capability-descriptor/node')"], project, { NODE_PATH: "" });
}

function cliSmoke(root: string, tarballs: string[]): void {
  const project = join(root, "cli-project");
  const cache = join(root, "offline-cache-cli");
  run("npm", ["init", "-y"], project);
  installOffline(project, tarballs, cache);
  assertPackedCore(project);
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

// The published library entry (#228): `require`/`import` of the packed
// @kontourai/console tarball must resolve the producer-emission surface the
// README documents (KontourEmitter, LocalFileSink, validateEvent, ...) with
// types, not just the kontour bin. This is the acceptance proof for #228.
const CONSOLE_LIBRARY_EXPORTS = [
  "KontourEmitter",
  "LocalFileSink",
  "CompositeSink",
  "InMemorySink",
  "ApiSink",
  "validateEvent",
  "validateProjection",
  "inspectLocalKontour",
  "surfaceClaimStateToProjection",
  "surfaceFreshnessTransitionToEvent",
] as const;

function assertPackedConsoleLibrary(project: string): void {
  const installed = join(project, "node_modules/@kontourai/console");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as {
    main?: string;
    types?: string;
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
  };
  assert.equal(manifest.main, "console-server/dist/src/console-foundation/index.js", "packed @kontourai/console must declare its library main entry");
  assert.equal(manifest.types, "console-server/dist/src/console-foundation/index.d.ts", "packed @kontourai/console must declare its library types entry");
  assert.ok(manifest.exports?.["."], 'packed @kontourai/console must declare a "." exports entry');
  assert.ok(manifest.dependencies?.["@kontourai/flow"], 'packed @kontourai/console must declare @kontourai/flow as a dependency (#228 review finding 1: the library entry re-exports flow-bridge/flow-ingest declarations that resolve @kontourai/flow/console-contract types)');
  for (const file of [
    "console-server/dist/src/console-foundation/index.js",
    "console-server/dist/src/console-foundation/index.d.ts",
  ]) assert.ok(existsSync(join(installed, file)), `packed @kontourai/console is missing ${file}`);

  const checkNames = `const names = ${JSON.stringify(CONSOLE_LIBRARY_EXPORTS)}; for (const name of names) { if (typeof lib[name] !== "function") throw new Error("missing or non-function export: " + name); }`;
  const requireOutput = runCombined(
    "node",
    ["-e", `const lib = require("@kontourai/console"); ${checkNames} console.log("require-ok");`],
    project,
    { NODE_PATH: "", npm_config_offline: "true" },
  );
  assert.match(requireOutput, /require-ok/, "require('@kontourai/console') did not resolve the documented library exports");

  const importOutput = runCombined(
    "node",
    ["--input-type=module", "-e", `import lib from "@kontourai/console"; ${checkNames} console.log("import-ok");`],
    project,
    { NODE_PATH: "", npm_config_offline: "true" },
  );
  assert.match(importOutput, /import-ok/, "import('@kontourai/console') did not resolve the documented library exports");
}

// (#228 review finding 1) Isolated declaration-graph proof: a TS consumer
// compiling ONLY against the packed tarball's OWN installed dependencies must
// resolve every name in CONSOLE_LIBRARY_EXPORTS with real types — not just
// `typeof lib[name] === "function"` at runtime, which cannot catch a broken
// re-export chain (a transitively-imported type whose package is absent from
// the manifest's dependencies fails TS2307; a name with no type declaration at
// all fails TS2305). This runs against the SAME node_modules the offline
// require()/import() checks above already populated — @kontourai/flow (and its
// own transitive tree) is installed there because it is now a declared
// dependency of the packed manifest (finding 1's fix). @types/node is copied
// in because the console-foundation declarations reference ambient NodeJS.*
// types; it is a devDependency of this repo, not a published runtime
// dependency of @kontourai/console, so it is not part of the offline install.
function assertPackedConsoleLibraryTypes(project: string): void {
  // @types/node itself depends on undici-types (>=7.24.0 <7.24.7); both are
  // copied straight from this repo's own node_modules (a devDependency, not a
  // published runtime dependency of @kontourai/console).
  cpSync(join(repositoryRoot, "node_modules/@types/node"), join(project, "node_modules/@types/node"), { recursive: true });
  cpSync(join(repositoryRoot, "node_modules/undici-types"), join(project, "node_modules/undici-types"), { recursive: true });

  const typesCheckDir = join(project, "types-check");
  mkdirSync(typesCheckDir, { recursive: true });
  const importList = CONSOLE_LIBRARY_EXPORTS.join(",\n  ");
  writeFileSync(join(typesCheckDir, "consumer.ts"), `import {
  ${importList}
} from "@kontourai/console";

const emitter = new KontourEmitter({ sink: new LocalFileSink({ root: ".kontourai/console" }) });
const composite = new CompositeSink([new InMemorySink(), new ApiSink("http://127.0.0.1:0/records")]);
const proof: unknown[] = [
  emitter,
  composite,
  validateEvent,
  validateProjection,
  inspectLocalKontour,
  surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent,
];
console.log(proof.length);
`);
  writeFileSync(join(typesCheckDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "commonjs",
      moduleResolution: "node",
      target: "es2022",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: ["node"],
      // Matches this repo's own tsconfig.build.json files: TypeScript 6 treats
      // "moduleResolution": "node" as the deprecated "node10" alias.
      ignoreDeprecations: "6.0",
    },
    include: ["consumer.ts"],
  }, null, 2));

  const tsc = join(repositoryRoot, "node_modules/.bin/tsc");
  const output = runCombined(tsc, ["-p", join(typesCheckDir, "tsconfig.json")], project, { NODE_PATH: "" });
  assert.equal(output.trim(), "", `isolated tsc consumer of the packed @kontourai/console tarball reported errors:\n${output}`);
}

// #230: the published `@kontourai/console-ui` components entry
// (`console-ui/lib/src/index.ts`) is a SEPARATE npm identity from the root
// `@kontourai/console` library entry checked above — its consumer is a host
// app mounting `BoardView`, not a Node service `require()`-ing an emitter.
// This is the package-exports resolution proof console#230 calls for,
// extending this file's existing tarball-smoke pattern rather than
// duplicating it (packThirdParty/stageForPack/installOffline are already
// exactly what a peer-dependency-bearing React component package needs).
const CONSOLE_UI_EXPORTS = [
  "BoardView",
  "boardCardSelectIntent",
  "BOARD_SELECT_CARD_INTENT",
  "deriveBoard",
  "classifyBoardStage",
  "runIdFromProcessId",
  "BOARD_STAGES",
  "BOARD_STAGE_LABEL",
] as const;

function assertPackedConsoleUi(project: string): void {
  const installed = join(project, "node_modules/@kontourai/console-ui");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as {
    main?: string;
    types?: string;
    exports?: Record<string, unknown>;
    peerDependencies?: Record<string, string>;
  };
  assert.equal(manifest.main, "dist/lib/index.js", "packed @kontourai/console-ui must declare its components-entry main");
  assert.equal(manifest.types, "dist/lib/index.d.ts", "packed @kontourai/console-ui must declare its components-entry types");
  assert.ok(manifest.exports?.["."], 'packed @kontourai/console-ui must declare a "." exports entry');
  assert.ok(manifest.exports?.["./board.css"], "packed @kontourai/console-ui must declare a ./board.css export (console#230: BoardView ships no self-imported CSS, matching @kontourai/ui's own react+styles.css split)");
  assert.ok(manifest.peerDependencies?.react, "packed @kontourai/console-ui must declare react as a peer dependency, not a bundled runtime copy");
  for (const file of [
    "dist/lib/index.js",
    "dist/lib/index.d.ts",
    "dist/lib/BoardView.js",
    "dist/lib/BoardView.d.ts",
    "dist/lib/board.js",
    "dist/lib/board.d.ts",
    "dist/lib/intent.d.ts",
    "lib/src/board-view.css",
  ]) assert.ok(existsSync(join(installed, file)), `packed @kontourai/console-ui is missing ${file}`);

  // ESM-only package (console-ui's manifest declares "type": "module"): resolve
  // via import(), not require().
  const checkNames = `const names = ${JSON.stringify(CONSOLE_UI_EXPORTS)}; for (const name of names) { if (!(name in lib)) throw new Error("missing export: " + name); }`;
  const importOutput = runCombined(
    "node",
    ["--input-type=module", "-e", `import * as lib from "@kontourai/console-ui"; ${checkNames} console.log("import-ok");`],
    project,
    { NODE_PATH: "", npm_config_offline: "true" },
  );
  assert.match(importOutput, /import-ok/, "import('@kontourai/console-ui') did not resolve the documented components-entry exports");
}

// Isolated declaration-graph proof (mirrors assertPackedConsoleLibraryTypes):
// a TS consumer compiling ONLY against the packed tarball's own installed
// dependencies must resolve BoardView's props (OperatingState, ConsoleIntent)
// with real JSX types, not just a runtime shape check above.
function assertPackedConsoleUiTypes(project: string): void {
  for (const typesPackage of ["@types/react", "@types/react-dom", "csstype"]) {
    cpSync(join(repositoryRoot, "node_modules", typesPackage), join(project, "node_modules", typesPackage), { recursive: true });
  }

  const typesCheckDir = join(project, "console-ui-types-check");
  mkdirSync(typesCheckDir, { recursive: true });
  writeFileSync(join(typesCheckDir, "consumer.tsx"), `import type { OperatingState } from "@kontourai/console-core";
import { BoardView, type BoardViewProps, type ConsoleIntent, deriveBoard } from "@kontourai/console-ui";

const state: OperatingState = { processes: [] };
const onIntent = (intent: ConsoleIntent): void => {
  console.log(intent.kind, intent.readOnly, intent.authority?.command);
};
const props: BoardViewProps = { operatingState: state, onIntent };
const element = <BoardView {...props} />;
const board = deriveBoard(state);
console.log(element, board.totalCards);
`);
  writeFileSync(join(typesCheckDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      target: "es2022",
      lib: ["ES2022", "DOM"],
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ["consumer.tsx"],
  }, null, 2));

  const tsc = join(repositoryRoot, "node_modules/.bin/tsc");
  const output = runCombined(tsc, ["-p", join(typesCheckDir, "tsconfig.json")], project, { NODE_PATH: "" });
  assert.equal(output.trim(), "", `isolated tsc consumer of the packed @kontourai/console-ui tarball reported errors:\n${output}`);
}

function consoleUiLibrarySmoke(root: string, tarballs: string[]): void {
  const project = join(root, "console-ui-project");
  const cache = join(root, "offline-cache-console-ui");
  run("npm", ["init", "-y"], project);
  installOffline(project, tarballs, cache);
  assertPackedConsoleUi(project);
  assertPackedConsoleUiTypes(project);
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
  assertPackedConsoleLibrary(project);
  assertPackedConsoleLibraryTypes(project);
}

function main(): void {
  const root = mkdtempSync(join(tmpdir(), "kontour-cli-tarball-"));
  const packs = join(root, "packs");
  const staging = join(root, "staging");
  const makeDirectory = (path: string): void => { mkdirSync(path, { recursive: true }); };
  makeDirectory(packs);
  makeDirectory(staging);
  makeDirectory(join(root, "cli-project"));
  makeDirectory(join(root, "legacy-project"));
  makeDirectory(join(root, "console-ui-project"));
  // Third-party packages packed from this repo's own installed node_modules
  // copies (published-package content only, no dev source) so the offline
  // installs below can resolve @kontourai/console's real dependency tree
  // (#228 review finding 1) and the transitive tree @kontourai/flow itself
  // declares. Staged (manifest `scripts` stripped) before packing — see
  // stageForPack().
  const packThirdParty = (name: string): string => pack(stageForPack(join(repositoryRoot, "node_modules", name), staging), packs, { ignoreScripts: true });
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
    const jose = packThirdParty("jose");
    // @kontourai/flow is a real dependency of the root manifest (#228 review
    // finding 1): flow-bridge/flow-ingest re-export types that resolve
    // @kontourai/flow/console-contract.
    const flowDependencyTree = [
      "@kontourai/flow",
      "@kontourai/surface",
      "ajv",
      "hachure",
      "fast-deep-equal",
      "fast-uri",
      "json-schema-traverse",
      "require-from-string",
    ].map(packThirdParty);
    legacyConsoleSmoke(root, rootConsole, [consoleCore, telemetry, jose, ...flowDependencyTree]);
    // #230: @kontourai/console-ui's components entry declares react/react-dom
    // as peers (a host app provides its own copy) and @kontourai/ui as a real
    // dependency — packed straight from this repo's own installed copies, the
    // same pattern as the flowDependencyTree above.
    const consoleUi = pack(join(repositoryRoot, "console-ui"), packs);
    const reactPeerTree = ["react", "react-dom", "scheduler", "@kontourai/ui"].map(packThirdParty);
    let consoleUiFailure: unknown;
    try {
      consoleUiLibrarySmoke(root, [consoleUi, consoleCore, ...reactPeerTree]);
    } catch (error) {
      consoleUiFailure = error;
    }
    if (cliFailure) throw cliFailure;
    if (consoleUiFailure) throw consoleUiFailure;
    process.stdout.write(`Tarball smoke passed: ${basename(cli)}, three product fixtures, ${basename(consoleUi)}, and ${basename(rootConsole)}.\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
