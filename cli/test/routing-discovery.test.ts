import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compatibilityCatalog } from "../src/catalog";
import { parseCommandLine, selectNamespace } from "../src/command-line";
import { discoverProducts, PRODUCT_DESCRIPTOR_ASSET } from "../src/discovery";
import { routeCommand } from "../src/router";

const fixtures = resolve(fileURLToPath(new URL("./fixtures/packages", import.meta.url)));

async function fixtureRoot(id: "flow" | "flow-agents" | "console"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `kontour-${id}-`));
  await cp(join(fixtures, id), root, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { bin: Record<string, string> };
  for (const bin of Object.values(manifest.bin)) await chmod(join(root, bin), 0o755);
  return root;
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
