import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { compatibilityCatalog } from "../src/catalog";
import { parseCommandLine, selectNamespace } from "../src/command-line";
import { discoverProducts, PRODUCT_DESCRIPTOR_ASSET, resolveDiscoveredExecutable } from "../src/discovery";
import { routeCommand } from "../src/router";
import { buildRouterOutput } from "../src/output";

const fixtures = resolve(fileURLToPath(new URL("./fixtures/packages", import.meta.url)));

async function fixtureRoot(id: "flow" | "flow-agents" | "console"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `kontour-${id}-`));
  await cp(join(fixtures, id), root, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { bin: Record<string, string> };
  for (const bin of Object.values(manifest.bin)) await chmod(join(root, bin), 0o755);
  return root;
}

async function installedGraph(prefix = "kontour-installed-products-"): Promise<{ install: string; resolutionBase: string }> {
  const install = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const cli = join(install, "node_modules", "@kontourai", "cli");
  const resolutionBase = join(cli, "dist", "discovery.js");
  await mkdir(dirname(resolutionBase), { recursive: true });
  await writeFile(join(cli, "package.json"), JSON.stringify({ name: "@kontourai/cli", version: "0.3.1" }));
  await writeFile(resolutionBase, "");
  return { install, resolutionBase };
}

test("namespace routing uses the longest prefix and preserves the exact remainder argv", () => {
  const agents = selectNamespace(["flow", "agents", "kit", "install", "--name", "a b", "*"]);
  assert.deepEqual(agents, { productId: "flow-agents", namespace: ["flow", "agents"], productArgv: ["kit", "install", "--name", "a b", "*"] });
  assert.equal(selectNamespace(["flow", "kit", "inspect"])?.productId, "flow");
  assert.equal(selectNamespace(["console", "serve"])?.productId, "console");
});

test("bounded parsing accepts explicit roots only before the namespace", () => {
  assert.deepEqual(parseCommandLine(["--product-root=flow=/tmp/flow", "flow", "status", "--product-root=console=/ignored"]), {
    ok: true,
    productRoots: [{ productId: "flow", root: "/tmp/flow" }],
    argv: ["flow", "status", "--product-root=console=/ignored"],
  });
  assert.equal(parseCommandLine(["--product-root=station=/tmp/station"]).ok, false);
  assert.equal(parseCommandLine(["--product-root=flow=relative/path", "flow", "status"]).ok, false);
  assert.equal(parseCommandLine(Array.from({ length: 257 }, () => "x")).ok, false);
});

test("routing resolves exact local product metadata and preserves trailing argv", async () => {
  const root = await fixtureRoot("flow-agents");
  const routed = await routeCommand([`--product-root=flow-agents=${root}`, "flow", "agents", "kit", "install", "--literal", "a b", "'quote'", "*"]);
  assert.equal(routed.ok, true);
  if (!routed.ok) return;
  assert.equal(routed.product.descriptorSource, "compatibility-catalog");
  assert.match(routed.executablePath, /bin\/record\.mjs$/);
  assert.deepEqual(routed.argv, ["kit", "install", "--literal", "a b", "'quote'", "*"]);
});

test("normal package resolution discovers an installed sibling and explicit roots win", async () => {
  const { install, resolutionBase } = await installedGraph();
  const installed = join(install, "node_modules", "@kontourai", "flow-agents");
  await cp(join(fixtures, "flow-agents"), installed, { recursive: true });
  const fromInstall = (await discoverProducts([], { resolutionBase })).find((item) => item.productId === "flow-agents")!;
  assert.equal(fromInstall.candidate?.root, await realpath(installed));
  assert.equal(fromInstall.candidateSource, "installed-package");
  const legacyOutput = buildRouterOutput("products", [fromInstall]);
  const legacySchema = JSON.parse(await readFile(resolve(fileURLToPath(new URL("../schemas/router-output.schema.json", import.meta.url))), "utf8"));
  assert.equal(new Ajv2020({ strict: true }).compile(legacySchema)(legacyOutput), true);
  assert.equal(legacyOutput.schemaVersion, "1.0.0");
  assert.equal(legacyOutput.products[0].executableSource, "explicit-product-root");

  const explicit = await fixtureRoot("flow-agents");
  const overridden = (await discoverProducts([{ productId: "flow-agents", root: explicit }], { resolutionBase }))
    .find((item) => item.productId === "flow-agents")!;
  assert.equal(overridden.candidate?.root, await realpath(explicit));
  assert.equal(overridden.candidateSource, "explicit-product-root");
});

test("installed discovery ignores NODE_PATH, matching ancestor manifests, and symlink package roots", async () => {
  const { install, resolutionBase } = await installedGraph("kontour-installed-boundary-");
  const outside = await realpath(await mkdtemp(join(tmpdir(), "kontour-node-path-trap-")));
  const outsideProduct = join(outside, "@kontourai", "flow-agents");
  await cp(join(fixtures, "flow-agents"), outsideProduct, { recursive: true });
  await writeFile(join(install, "package.json"), JSON.stringify({ name: "@kontourai/flow-agents", version: "3.8.0" }));
  const priorNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = outside;
  try {
    const missing = (await discoverProducts([], { resolutionBase })).find((item) => item.productId === "flow-agents")!;
    assert.equal(missing.candidate, undefined);

    const lexical = join(install, "node_modules", "@kontourai", "flow-agents");
    await mkdir(dirname(lexical), { recursive: true });
    await symlink(outsideProduct, lexical);
    const linked = (await discoverProducts([], { resolutionBase })).find((item) => item.productId === "flow-agents")!;
    assert.equal(linked.candidate, undefined);
    assert.ok(linked.diagnostics.some((item) => item.message.includes("canonical package directory")));

    await rm(lexical);
    await cp(join(fixtures, "flow-agents"), lexical, { recursive: true });
    const descriptorOutside = join(outside, "descriptor.json");
    await writeFile(descriptorOutside, JSON.stringify(compatibilityCatalog[0].descriptor));
    await symlink(descriptorOutside, join(lexical, PRODUCT_DESCRIPTOR_ASSET));
    const descriptorLinked = (await discoverProducts([], { resolutionBase })).find((item) => item.productId === "flow-agents")!;
    assert.ok(descriptorLinked.diagnostics.some((item) => item.message.includes("descriptor asset is malformed")));
  } finally {
    if (priorNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = priorNodePath;
  }
});

test("installed discovery binds executable symlinks and exact catalog versions", async () => {
  const { install, resolutionBase } = await installedGraph("kontour-installed-hostile-");
  const installed = join(install, "node_modules", "@kontourai", "flow-agents");
  await cp(join(fixtures, "flow-agents"), installed, { recursive: true });
  const outside = join(install, "outside.mjs");
  await writeFile(outside, "#!/usr/bin/env node\n");
  await rm(join(installed, "bin", "record.mjs"));
  await symlink(outside, join(installed, "bin", "record.mjs"));
  const product = (await discoverProducts([], { resolutionBase })).find((item) => item.productId === "flow-agents")!;
  const executable = await resolveDiscoveredExecutable(product, "flow-agents-cli");
  assert.equal(executable.ok, false);
  if (!executable.ok) assert.ok(executable.diagnostics.some((item) => item.code === "DESCRIPTOR_EXECUTABLE_MISSING"));

  const installedManifestPath = join(installed, "package.json");
  const installedManifest = JSON.parse(await readFile(installedManifestPath, "utf8"));
  installedManifest.version = "3.7.0";
  await writeFile(installedManifestPath, JSON.stringify(installedManifest));
  const wrongInstalledVersion = (await discoverProducts([], { resolutionBase })).find((item) => item.productId === "flow-agents")!;
  assert.ok(wrongInstalledVersion.diagnostics.some((item) => item.message === "Expected @kontourai/flow-agents@3.8.0."));

  const explicit = await fixtureRoot("flow-agents");
  const manifestPath = join(explicit, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "3.7.0";
  await writeFile(manifestPath, JSON.stringify(manifest));
  const incompatible = (await discoverProducts([{ productId: "flow-agents", root: explicit }], { resolutionBase }))
    .find((item) => item.productId === "flow-agents")!;
  assert.ok(incompatible.diagnostics.some((item) => item.message === "Expected @kontourai/flow-agents@3.8.0."));
});

test("an invalid explicit root never falls back to a valid installed sibling", async () => {
  const { install, resolutionBase } = await installedGraph("kontour-no-fallback-");
  await cp(join(fixtures, "flow-agents"), join(install, "node_modules", "@kontourai", "flow-agents"), { recursive: true });
  const invalid = join(install, "missing-explicit");
  const product = (await discoverProducts([{ productId: "flow-agents", root: invalid }], { resolutionBase }))
    .find((item) => item.productId === "flow-agents")!;
  assert.equal(product.candidate, undefined);
  assert.equal(product.candidateSource, "explicit-product-root");
  assert.ok(product.diagnostics.length > 0);
});

test("a valid product-owned descriptor wins over compatibility metadata", async () => {
  const root = await fixtureRoot("flow");
  const owned = structuredClone(compatibilityCatalog.find((entry) => entry.descriptor.product.id === "flow")!.descriptor);
  owned.product.displayName = "Product-owned Flow";
  await writeFile(join(root, PRODUCT_DESCRIPTOR_ASSET), JSON.stringify(owned));
  const [product] = (await discoverProducts([{ productId: "flow", root }])).filter((item) => item.productId === "flow");
  assert.equal(product.descriptorSource, "product-package");
  assert.equal(product.descriptor.product.displayName, "Product-owned Flow");
  assert.deepEqual(product.diagnostics, []);
});

test("malformed or incompatible product-owned descriptors fail closed with no executable route", async () => {
  const root = await fixtureRoot("flow");
  await writeFile(join(root, PRODUCT_DESCRIPTOR_ASSET), JSON.stringify({ schemaVersion: "999.0.0" }));
  const routed = await routeCommand([`--product-root=flow=${root}`, "flow", "status"]);
  assert.equal(routed.ok, false);
  if (routed.ok) return;
  assert.ok(routed.diagnostics.some((item) => item.code === "DESCRIPTOR_MALFORMED" || item.code === "DESCRIPTOR_SCHEMA_UNSUPPORTED"));
});

test("wrong package identity and unknown product commands never resolve an executable", async () => {
  const root = await fixtureRoot("flow");
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
  manifest.name = "@attacker/wrong";
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  assert.equal((await routeCommand([`--product-root=flow=${root}`, "flow", "status"])).ok, false);

  const clean = await fixtureRoot("flow");
  const unknown = await routeCommand([`--product-root=flow=${clean}`, "flow", "agents-not-really", "kit", "install"]);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.diagnostics[0].code, "ROUTER_COMMAND_UNKNOWN");
});
