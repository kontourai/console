import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import type { CatalogProductId } from "../src/catalog";
import { runCli } from "../src/cli";
import { discoverProducts } from "../src/discovery";
import { buildRouterOutput, renderRouterOutput } from "../src/output";

const fixtures = resolve(fileURLToPath(new URL("./fixtures/packages", import.meta.url)));
const schemaPath = resolve(fileURLToPath(new URL("../schemas/router-output.schema.json", import.meta.url)));

async function fixtureRoot(id: CatalogProductId, prefix = "kontour-output-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${prefix}${id}-`));
  await cp(join(fixtures, id), root, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { bin: Record<string, string> };
  for (const bin of Object.values(manifest.bin)) await chmod(join(root, bin), 0o755);
  return root;
}

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: { stdout: { write: (value: string) => { stdout += value; } }, stderr: { write: (value: string) => { stderr += value; } } },
    read: () => ({ stdout, stderr }),
  };
}

test("products deterministic json is schema-valid, ordered, and redacts different temp roots", async () => {
  const firstRoots = await Promise.all((["flow", "flow-agents", "console"] as const).map((id) => fixtureRoot(id, "first-secret-root-")));
  const secondRoots = await Promise.all((["flow", "flow-agents", "console"] as const).map((id) => fixtureRoot(id, "second-secret-root-")));
  const firstOptions = (["flow", "flow-agents", "console"] as const).map((productId, index) => ({ productId, root: firstRoots[index] })).reverse();
  const secondOptions = (["flow", "flow-agents", "console"] as const).map((productId, index) => ({ productId, root: secondRoots[index] }));
  const first = buildRouterOutput("products", await discoverProducts(firstOptions));
  const second = buildRouterOutput("products", await discoverProducts(secondOptions));
  assert.deepEqual(first, second);
  assert.deepEqual(first.products.map((product) => product.id), ["console", "flow", "flow-agents"]);
  const serialized = JSON.stringify(first);
  for (const root of [...firstRoots, ...secondRoots]) assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes("secret-root"), false);
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const validate = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validate(first), true, JSON.stringify(validate.errors));
});

test("capabilities filters one product without changing shape and exposes authority metadata", async () => {
  const output = buildRouterOutput("capabilities", await discoverProducts([]), "flow-agents");
  assert.equal(output.products.length, 1);
  assert.equal(output.products[0].id, "flow-agents");
  assert.ok(output.products[0].commands.some((command) => command.path.join(" ") === "kit install" && command.sideEffect === "write-local" && command.authority.confirmation === "user-request"));
  assert.match(renderRouterOutput(output), /command kit install .* write-local; confirmation=user-request/);
});

test("doctor is read-only, reports stable remediation, and rejects reserved online mode", async () => {
  const first = capture();
  assert.equal(await runCli(["doctor", "--json"], first.io), 0);
  const parsed = JSON.parse(first.read().stdout) as { command: string; products: Array<{ availability: string; remediation: string[] }> };
  assert.equal(parsed.command, "doctor");
  const unavailable = parsed.products.filter((product) => product.availability !== "available");
  assert.ok(unavailable.length > 0);
  assert.ok(unavailable.every((product) => product.remediation.some((item) => /npm install --save-exact @kontourai\/.+@\d+\.\d+\.\d+/.test(item))));
  assert.ok(unavailable.every((product) => product.remediation.some((item) => item.startsWith("npm exec --yes --package="))));

  const online = capture();
  assert.equal(await runCli(["doctor", "--online"], online.io), 2);
  assert.match(online.read().stderr, /^ROUTER_ARGUMENT_INVALID:/);
  assert.equal(online.read().stdout, "");
});

test("thin cli delegates product routes and maps stable argument errors", async () => {
  const root = await fixtureRoot("flow");
  const called: Array<{ executable: string; argv: readonly string[] }> = [];
  const delegated = capture();
  const code = await runCli([`--product-root=flow=${root}`, "flow", "status", "--literal", "a b"], delegated.io, {
    delegate: async (executable, argv) => { called.push({ executable, argv }); return 37; },
  });
  assert.equal(code, 37);
  assert.equal(called.length, 1);
  assert.match(called[0].executable, /bin\/record\.mjs$/);
  assert.deepEqual(called[0].argv, ["status", "--literal", "a b"]);

  const unknown = capture();
  assert.equal(await runCli(["capabilities", "station"], unknown.io), 2);
  assert.match(unknown.read().stderr, /^ROUTER_PRODUCT_UNKNOWN:/);
});

test("top-level and init help are inert in an empty directory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "kontour-help-empty-"));
  const before = await readdir(cwd);
  for (const argv of [["--help"], ["init", "--help"]]) {
    const output = capture();
    assert.equal(await runCli(argv, output.io, { cwd }), 0);
    assert.match(output.read().stdout, /^Usage: kontour/);
    assert.equal(output.read().stderr, "");
    assert.deepEqual(await readdir(cwd), before);
  }
});

test("human products and doctor render from the same normalized records", async () => {
  const discovered = await discoverProducts([]);
  const products = renderRouterOutput(buildRouterOutput("products", discovered));
  const doctor = renderRouterOutput(buildRouterOutput("doctor", discovered));
  for (const id of ["console", "flow", "flow-agents"]) {
    assert.match(products, new RegExp(`\\[${id}\\]`));
    assert.match(doctor, new RegExp(`\\[${id}\\]`));
  }
  assert.doesNotMatch(products, /remediation:/);
  assert.match(doctor, /remediation: (?:Optionally override discovery|npm install --save-exact)/);
});
