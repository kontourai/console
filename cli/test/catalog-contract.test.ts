import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import {
  negotiateProductCapabilityDescriptors,
  validateProductCapabilityDescriptor,
} from "@kontourai/console-core/product-capability-descriptor";
import {
  COMPATIBILITY_CATALOG_VERSION,
  compatibilityCatalog,
} from "../src/catalog";

test("compatibility catalog descriptors validate and negotiate as one protocol set", () => {
  assert.equal(COMPATIBILITY_CATALOG_VERSION, "1.0.0");
  assert.deepEqual(
    compatibilityCatalog.map((entry) => entry.descriptor.product.id),
    ["flow-agents", "flow", "console"],
  );

  for (const entry of compatibilityCatalog) {
    const result = validateProductCapabilityDescriptor(entry.descriptor);
    assert.equal(result.ok, true);
    assert.equal(entry.descriptorSource, "compatibility-catalog");
    assert.match(entry.derivedFrom, /Console #144/);
    assert.match(entry.removalTrigger, /ships and tests a product-owned descriptor/);
  }

  const negotiation = negotiateProductCapabilityDescriptors(
    compatibilityCatalog.map((entry) => entry.descriptor),
  );
  assert.equal(negotiation.ok, true);
  assert.equal(negotiation.diagnostics.length, 0);
});

test("catalog orders the nested Flow Agents namespace before Flow and declares kit ownership", () => {
  assert.deepEqual(
    compatibilityCatalog.map((entry) => entry.suitePrefix),
    [["flow", "agents"], ["flow"], ["console"]],
  );

  const commands = new Map(compatibilityCatalog.map((entry) => [
    entry.descriptor.product.id,
    entry.descriptor.commands.map((command) => command.path.join(" ")),
  ]));
  assert.deepEqual(
    commands.get("flow-agents")?.filter((path) => path.startsWith("kit ")),
    ["kit install", "kit activate", "kit status"],
  );
  assert.deepEqual(
    commands.get("flow")?.filter((path) => path.startsWith("kit ")),
    ["kit validate", "kit install", "kit inspect"],
  );
});

test("public router output golden fixture validates against the packaged schema", async () => {
  const schemaPath = fileURLToPath(new URL("../schemas/router-output.schema.json", import.meta.url));
  const fixturePath = fileURLToPath(new URL("./fixtures/router-output.golden.json", import.meta.url));
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const validate = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
});
