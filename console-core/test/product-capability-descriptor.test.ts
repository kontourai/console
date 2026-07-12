import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020";
import childProcess from "node:child_process";
import dns from "node:dns";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  PRODUCT_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
  PRODUCT_CAPABILITY_PROTOCOL_VERSION,
  negotiateProductCapabilityDescriptors,
  validateProductCapabilityDescriptor,
  type ProductCapabilityDescriptor
} from "../src/index";
import { resolveLocalProductExecutable } from "../src/product-capability-descriptor-node";

const FIXTURE_NAMES = ["flow", "flow-agents", "console"] as const;
const PACKAGE_NAME = "@kontourai/flow";

async function checkedInSchemaValidator(): Promise<(input: unknown) => boolean> {
  const schemaUrl = new URL("../schemas/product-capability-descriptor.schema.json", import.meta.url);
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  return (input: unknown) => Boolean(validate(input));
}

async function readFixture(name: (typeof FIXTURE_NAMES)[number]): Promise<unknown> {
  const url = new URL(`./fixtures/product-capability-descriptors/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

test("descriptor fixtures conform for Flow, Flow Agents, and Console", async () => {
  const fixtures = await Promise.all(FIXTURE_NAMES.map(readFixture));
  const schemaAccepts = await checkedInSchemaValidator();

  for (const [index, input] of fixtures.entries()) {
    assert.equal(schemaAccepts(input), true, `${FIXTURE_NAMES[index]} does not conform to the checked-in schema`);
    const result = validateProductCapabilityDescriptor(input);
    assert.equal(result.ok, true, `${FIXTURE_NAMES[index]}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(result.diagnostics, []);
  }

  const descriptors = fixtures as ProductCapabilityDescriptor[];
  assert.deepEqual(descriptors.map(({ product }) => product.id), ["flow", "flow-agents", "console"]);
  assert.equal(new Set(descriptors.map(({ product }) => product.id)).size, descriptors.length);
  assert.ok(descriptors.every(({ schemaVersion }) => schemaVersion === PRODUCT_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION));
  assert.ok(descriptors.every(({ protocolVersion }) => protocolVersion === PRODUCT_CAPABILITY_PROTOCOL_VERSION));
});

test("descriptor fixtures reflect the current product package and bin contracts", async () => {
  const descriptors = await Promise.all(FIXTURE_NAMES.map(readFixture)) as ProductCapabilityDescriptor[];

  // Source contracts: kontourai/flow/package.json, kontourai/flow-agents/package.json,
  // and this repository's package.json. Versions are intentionally not encoded:
  // descriptor resolution negotiates protocol compatibility independently of package releases.
  assert.deepEqual(
    descriptors.map(({ product, executables }) => ({
      packageName: product.packageName,
      packageBins: executables.map(({ packageBin }) => packageBin)
    })),
    [
      { packageName: "@kontourai/flow", packageBins: ["flow"] },
      { packageName: "@kontourai/flow-agents", packageBins: ["flow-agents"] },
      { packageName: "@kontourai/console", packageBins: ["kontour", "console-inspect"] }
    ]
  );

  for (const descriptor of descriptors) {
    assert.ok(descriptor.commands.some(({ sideEffect }) => sideEffect === "read-local"));
    assert.ok(descriptor.artifacts.length > 0);
    assert.ok(descriptor.projections.length > 0);
    assert.ok(descriptor.commands.every(({ authority }) =>
      authority.kind === "product" && authority.productId === descriptor.product.id
    ));
  }
});

test("descriptor schema rejects unknown fields and duplicate commands", async () => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const schemaAccepts = await checkedInSchemaValidator();
  const unknownField = { ...flow, consoleOwnsProductSemantics: true };
  const unknownResult = validateProductCapabilityDescriptor(unknownField);

  assert.equal(unknownResult.ok, false);
  assert.equal(schemaAccepts(unknownField), false);
  assert.ok(unknownResult.diagnostics.some(({ code }) => code === "DESCRIPTOR_UNKNOWN_FIELD"));

  const duplicateCommand = {
    ...flow,
    commands: [...flow.commands, flow.commands[0]]
  };
  const duplicateResult = validateProductCapabilityDescriptor(duplicateCommand);

  assert.equal(duplicateResult.ok, false);
  assert.deepEqual(
    duplicateResult.diagnostics.map(({ code }) => code),
    ["DESCRIPTOR_DUPLICATE_COMMAND"]
  );
});

test("descriptor fixture identities are deterministic and duplicate-free", async () => {
  const descriptors = await Promise.all(FIXTURE_NAMES.map(readFixture)) as ProductCapabilityDescriptor[];
  const duplicateIdentityInput = [...descriptors, descriptors[0]];
  const duplicateIds = duplicateIdentityInput
    .map(({ product }) => product.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index)
    .sort();

  assert.deepEqual(duplicateIds, ["flow"]);
});

test("descriptor negotiation accepts supported minors and diagnoses unsupported versions deterministically", async () => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const compatible = { ...flow, protocolVersion: "1.999.0" };
  assert.equal(validateProductCapabilityDescriptor(compatible).ok, true);

  const result = negotiateProductCapabilityDescriptors([
    { ...flow, protocolVersion: "2.0.0" },
    flow,
    flow
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.descriptors.map(({ product }) => product.id), ["flow"]);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "DESCRIPTOR_DUPLICATE_IDENTITY",
    "DESCRIPTOR_PROTOCOL_UNSUPPORTED"
  ]);
  assert.ok(result.diagnostics.every(({ message }) => !message.includes(tmpdir())));
});

test("descriptor diagnostics reject executable overrides while retaining harmless literal argv punctuation", async () => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const harmless = {
    ...flow,
    commands: [{ ...flow.commands[0], argv: ["status", "a;b", "$(literal)"] }]
  };
  assert.equal(validateProductCapabilityDescriptor(harmless).ok, true);

  for (const token of ["--exec=other", "--executable", "--shell=/bin/sh", "-c"]) {
    const hostile = {
      ...flow,
      commands: [{ ...flow.commands[0], argv: [token] }]
    };
    const result = validateProductCapabilityDescriptor(hostile);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(({ code }) => code === "DESCRIPTOR_UNSAFE_ARGV"));
  }
});

test("descriptor offline resolution stays inside supplied roots and permits contained symlinks", async (t) => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "kontour-descriptor-")));
  const outside = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "kontour-outside-")));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  });
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin", "flow.js"), "#!/usr/bin/env node\n");
  await chmod(join(root, "bin", "flow.js"), 0o755);

  const direct = await resolveLocalProductExecutable(flow, "flow-cli", [{ root, packageName: PACKAGE_NAME, bins: { flow: "bin/flow.js" } }]);
  assert.equal(direct.ok, true);
  if (direct.ok) {
    const { realpath } = await import("node:fs/promises");
    assert.equal(direct.value.executablePath, await realpath(join(root, "bin", "flow.js")));
  }

  await symlink("flow.js", join(root, "bin", "flow-link"));
  const linked = await resolveLocalProductExecutable(flow, "flow-cli", [{ root, packageName: PACKAGE_NAME, bins: { flow: "bin/flow-link" } }]);
  assert.equal(linked.ok, true);

  await writeFile(join(outside, "escape.js"), "#!/usr/bin/env node\n");
  await symlink(join(outside, "escape.js"), join(root, "bin", "escape"));
  for (const bin of ["../escape.js", join(outside, "escape.js"), "bin/escape", "bin/missing"]) {
    const rejected = await resolveLocalProductExecutable(flow, "flow-cli", [{ root, packageName: PACKAGE_NAME, bins: { flow: bin } }]);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.deepEqual(rejected.diagnostics.map(({ code }) => code), ["DESCRIPTOR_EXECUTABLE_MISSING"]);
      assert.ok(rejected.diagnostics.every(({ message }) => !message.includes(root) && !message.includes(outside)));
    }
  }
});

test("descriptor hostile executable paths fail closed without leaking supplied roots", async (t) => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const root = await mkdtemp(join(tmpdir(), "kontour-hostile-root-"));
  const outside = await mkdtemp(join(tmpdir(), "kontour-hostile-outside-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));

  await mkdir(join(root, "bin"));
  await mkdir(join(root, "bin", "directory"));
  await writeFile(join(outside, "escape.js"), "#!/usr/bin/env node\n");
  await symlink(join(outside, "escape.js"), join(root, "bin", "escape"));

  const existingHostileBins = [
    "C:\\Windows\\System32\\cmd.exe",
    "C:drive-relative.exe",
    "\\\\server\\share\\tool.exe",
    "\\\\?\\C:\\device.exe",
    "bin/%2e%2e/escape.js",
    "bin/%2E%2E/escape-upper.js",
    "bin/%252e%252e/escape-repeated.js",
    "bin/%2fetc/escape.js",
    "bin/%5cescape.js"
  ];
  for (const bin of existingHostileBins) {
    const target = join(root, bin);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "#!/usr/bin/env node\n");
    assert.equal((await lstat(target)).isFile(), true, `hostile fixture must exist: ${JSON.stringify(bin)}`);
  }

  const hostileBins = [
    "/bin/sh",
    "C:\\Windows\\System32\\cmd.exe",
    "C:drive-relative.exe",
    "\\\\server\\share\\tool.exe",
    "\\\\?\\C:\\device.exe",
    "../escape.js",
    "bin/../../escape.js",
    "bin\\..\\..\\escape.js",
    "bin/..\\../escape.js",
    "bin/%2e%2e/escape.js",
    "bin/%2E%2E/escape-upper.js",
    "bin/%252e%252e/escape-repeated.js",
    "bin/%2fetc/escape.js",
    "bin/%5cescape.js",
    "bin/flow\u0000.js",
    "bin/flow\u001b.js",
    "bin/flow\n.js",
    "bin/escape",
    "bin/directory",
    "bin/missing",
    "/dev/null",
    `bin/${"x".repeat(8192)}`
  ];

  for (const bin of hostileBins) {
    const result = await resolveLocalProductExecutable(flow, "flow-cli", [{ root, packageName: PACKAGE_NAME, bins: { flow: bin } }]);
    assert.equal(result.ok, false, `unexpectedly resolved hostile bin ${JSON.stringify(bin)}`);
    if (!result.ok) {
      assert.deepEqual(result.diagnostics.map(({ code }) => code), ["DESCRIPTOR_EXECUTABLE_MISSING"]);
      assert.ok(result.diagnostics.every(({ message }) =>
        !message.includes(root) && !message.includes(outside) && !message.includes(tmpdir())
      ));
    }
  }
});

test("descriptor hostile oversized and control fields are rejected deterministically", async () => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const cases: Array<{ name: string; input: unknown; code: string }> = [
    { name: "oversized product name", input: { ...flow, product: { ...flow.product, displayName: "x".repeat(129) } }, code: "DESCRIPTOR_MALFORMED" },
    { name: "oversized package name", input: { ...flow, product: { ...flow.product, packageName: `@scope/${"x".repeat(215)}` } }, code: "DESCRIPTOR_MALFORMED" },
    { name: "oversized command summary", input: { ...flow, commands: [{ ...flow.commands[0], summary: "x".repeat(257) }] }, code: "DESCRIPTOR_MALFORMED" },
    { name: "oversized argv token", input: { ...flow, commands: [{ ...flow.commands[0], argv: ["x".repeat(1025)] }] }, code: "DESCRIPTOR_MALFORMED" },
    { name: "NUL argv token", input: { ...flow, commands: [{ ...flow.commands[0], argv: ["ok\u0000no"] }] }, code: "DESCRIPTOR_MALFORMED" },
    { name: "control command path", input: { ...flow, commands: [{ ...flow.commands[0], path: ["status\u001b"] }] }, code: "DESCRIPTOR_MALFORMED" },
    { name: "unknown nested field", input: { ...flow, product: { ...flow.product, executablePath: "/bin/sh" } }, code: "DESCRIPTOR_UNKNOWN_FIELD" }
  ];

  for (const entry of cases) {
    const result = validateProductCapabilityDescriptor(entry.input);
    assert.equal(result.ok, false, entry.name);
    assert.ok(result.diagnostics.some(({ code }) => code === entry.code), entry.name);
    assert.ok(result.diagnostics.every(({ message }) => !message.includes("/bin/sh")), entry.name);
  }
});

test("descriptor diagnostics never reflect hostile unknown field names", async () => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const sentinels = [
    "/private/tmp/descriptor-secret",
    "token=super-secret-value",
    "line-one\r\nline-two",
    "escape-\u001b]8;;https://attacker.invalid\u0007",
    `oversized-${"x".repeat(16_384)}`
  ];

  for (const sentinel of sentinels) {
    const result = validateProductCapabilityDescriptor({ ...flow, [sentinel]: true });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.deepEqual(result.diagnostics.filter(({ code }) => code === "DESCRIPTOR_UNKNOWN_FIELD"), [{
      code: "DESCRIPTOR_UNKNOWN_FIELD",
      severity: "error",
      message: "Descriptor object contains an unknown field."
    }]);
    const serialized = JSON.stringify(result.diagnostics);
    assert.ok(serialized.length < 1024);
    assert.equal(serialized.includes(sentinel), false);
    assert.equal(serialized.includes("super-secret-value"), false);
    assert.equal(/[\r\n\u001b\u0007]/.test(serialized), false);
  }
});

test("descriptor hostile argv rejects structural executable overrides but preserves literal arguments", async () => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const schemaAccepts = await checkedInSchemaValidator();
  const structuralOverrides = [
    ["--exec"],
    ["--exec=other"],
    ["--executable"],
    ["--executable=other"],
    ["--shell"],
    ["--shell=/bin/sh"],
    ["-c"]
  ];

  for (const argv of structuralOverrides) {
    const input = { ...flow, commands: [{ ...flow.commands[0], argv }] };
    const result = validateProductCapabilityDescriptor(input);
    assert.equal(schemaAccepts(input), false, `checked-in schema accepted ${argv.join(" ")}`);
    assert.equal(result.ok, false, argv.join(" "));
    assert.ok(result.diagnostics.some(({ code }) => code === "DESCRIPTOR_UNSAFE_ARGV"));
  }

  for (const argv of [
    ["status", "a;b", "$(literal)", "*.json", "&&", "|"],
    ["--format", "--exec-is-data"],
    ["path with spaces", "quote'and\"quote"]
  ]) {
    const input = { ...flow, commands: [{ ...flow.commands[0], argv }] };
    assert.equal(schemaAccepts(input), true, argv.join(" "));
    assert.equal(validateProductCapabilityDescriptor(input).ok, true, argv.join(" "));
  }
});

test("descriptor checked-in schema and runtime conform for shared structural corpus", async () => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const schemaAccepts = await checkedInSchemaValidator();
  const corpus: Array<{ name: string; input: unknown; accepted: boolean }> = [
    ...await Promise.all(FIXTURE_NAMES.map(async (name) => ({ name, input: await readFixture(name), accepted: true }))),
    { name: "unknown root field", input: { ...flow, unknown: true }, accepted: false },
    { name: "missing product", input: { ...flow, product: undefined }, accepted: false },
    { name: "control summary", input: { ...flow, commands: [{ ...flow.commands[0], summary: "bad\nsummary" }] }, accepted: false },
    { name: "oversized argv", input: { ...flow, commands: [{ ...flow.commands[0], argv: ["x".repeat(1025)] }] }, accepted: false },
    ...["-c", "--shell", "--shell=/bin/sh", "--exec", "--exec=other", "--executable", "--executable=other"]
      .map((token) => ({ name: `unsafe argv ${token}`, input: { ...flow, commands: [{ ...flow.commands[0], argv: [token] }] }, accepted: false }))
  ];

  for (const entry of corpus) {
    const schemaResult = schemaAccepts(entry.input);
    const runtimeResult = validateProductCapabilityDescriptor(entry.input).ok;
    assert.equal(schemaResult, entry.accepted, `${entry.name}: schema outcome`);
    assert.equal(runtimeResult, entry.accepted, `${entry.name}: runtime outcome`);
    assert.equal(schemaResult, runtimeResult, `${entry.name}: schema/runtime drift`);
  }
});

test("descriptor resolution binds candidates to the exact package name before bin lookup", async (t) => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const wrongRoot = await mkdtemp(join(tmpdir(), "kontour-wrong-package-"));
  const correctRoot = await mkdtemp(join(tmpdir(), "kontour-correct-package-"));
  t.after(() => Promise.all([rm(wrongRoot, { recursive: true, force: true }), rm(correctRoot, { recursive: true, force: true })]));
  for (const root of [wrongRoot, correctRoot]) {
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin", "flow.js"), "#!/usr/bin/env node\n");
  }

  const result = await resolveLocalProductExecutable(flow, "flow-cli", [
    { root: wrongRoot, packageName: "@attacker/not-flow", bins: { flow: "bin/flow.js" } },
    { root: correctRoot, packageName: PACKAGE_NAME, bins: { flow: "bin/flow.js" } }
  ]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.executablePath, await import("node:fs/promises").then(({ realpath }) => realpath(join(correctRoot, "bin", "flow.js"))));

  const wrongOnly = await resolveLocalProductExecutable(flow, "flow-cli", [
    { root: wrongRoot, packageName: "@attacker/not-flow", bins: { flow: "bin/flow.js" } }
  ]);
  assert.equal(wrongOnly.ok, false);

  const missingIdentity = await resolveLocalProductExecutable(flow, "flow-cli", [
    { root: wrongRoot, packageName: undefined, bins: { flow: "bin/flow.js" } } as unknown as Parameters<typeof resolveLocalProductExecutable>[2][number]
  ]);
  assert.equal(missingIdentity.ok, false);
});

test("descriptor offline discovery and resolution deny network and process fallbacks", async (t) => {
  const flow = await readFixture("flow") as ProductCapabilityDescriptor;
  const root = await mkdtemp(join(tmpdir(), "kontour-offline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin", "flow.js"), "#!/usr/bin/env node\n");

  let forbiddenCalls = 0;
  const deny = () => {
    forbiddenCalls += 1;
    throw new Error("offline test denied network or process access");
  };
  const patches: Array<[Record<string, unknown>, string, unknown]> = [];
  const patch = (target: Record<string, unknown>, key: string) => {
    patches.push([target, key, target[key]]);
    target[key] = deny;
  };
  patch(childProcess as unknown as Record<string, unknown>, "spawn");
  patch(childProcess as unknown as Record<string, unknown>, "exec");
  patch(childProcess as unknown as Record<string, unknown>, "execFile");
  patch(dns as unknown as Record<string, unknown>, "lookup");
  patch(http as unknown as Record<string, unknown>, "request");
  patch(http as unknown as Record<string, unknown>, "get");
  patch(https as unknown as Record<string, unknown>, "request");
  patch(https as unknown as Record<string, unknown>, "get");
  patch(net as unknown as Record<string, unknown>, "connect");
  patch(net as unknown as Record<string, unknown>, "createConnection");
  t.after(() => {
    for (const [target, key, original] of patches.reverse()) target[key] = original;
  });

  const negotiated = negotiateProductCapabilityDescriptors([flow]);
  assert.equal(negotiated.ok, true);
  assert.deepEqual(negotiated.diagnostics, []);
  const resolved = await resolveLocalProductExecutable(flow, "flow-cli", [{
    root,
    packageName: PACKAGE_NAME,
    bins: { flow: "bin/flow.js" }
  }]);
  assert.equal(resolved.ok, true);
  assert.equal(forbiddenCalls, 0);

  const missing = await resolveLocalProductExecutable(flow, "flow-cli", [{
    root,
    packageName: PACKAGE_NAME,
    bins: { flow: "bin/not-installed" }
  }]);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.deepEqual(missing.diagnostics.map(({ code }) => code), ["DESCRIPTOR_EXECUTABLE_MISSING"]);
    assert.ok(missing.diagnostics.every(({ message }) => !message.includes(root) && !message.includes(tmpdir())));
  }
  assert.equal(forbiddenCalls, 0);
});
