import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { delegateProduct, DelegationError } from "../src/delegate";
import {
  missingProductRemediation,
  validateExactPackageSpec,
  validateExplicitDownloadSpecs,
} from "../src/install-policy";
import { routeCommand } from "../src/router";

const fixtures = path.resolve(fileURLToPath(new URL("./fixtures/packages", import.meta.url)));

async function flowRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kontour-install-policy-"));
  await cp(path.join(fixtures, "flow"), root, { recursive: true });
  await chmod(path.join(root, "bin", "record.mjs"), 0o755);
  return root;
}

test("missing-product remediation is inert and requires an exact-version placeholder", async () => {
  const remediation = missingProductRemediation("flow", "@kontourai/flow", "flow");
  assert.deepEqual(remediation, {
    productId: "flow",
    packageName: "@kontourai/flow",
    localInstall: "npm install --save-exact @kontourai/flow@<exact-semver>",
    oneShot: "npm exec --yes --package=@kontourai/flow@<exact-semver> -- flow",
    mutates: false,
  });

  const root = await mkdtemp(path.join(tmpdir(), "kontour-package-manager-trap-"));
  const marker = path.join(root, "invoked");
  const npm = path.join(root, "npm");
  await writeFile(npm, `#!/bin/sh\nprintf invoked > "${marker}"\nexit 99\n`);
  await chmod(npm, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${root}${path.delimiter}${priorPath ?? ""}`;
  try {
    const routed = await routeCommand(["flow", "agents", "workflow", "status"]);
    assert.equal(routed.ok, false);
    if (!routed.ok) {
      assert.equal(routed.diagnostics[0].code, "DESCRIPTOR_EXECUTABLE_MISSING");
      assert.match(routed.diagnostics[0].message, /@kontourai\/flow-agents@3\.8\.0/);
      assert.doesNotMatch(routed.diagnostics[0].message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    process.env.PATH = priorPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("exact opt-in accepts literal semver and rejects tags, ranges, alternate sources, absence, and conflicts", () => {
  assert.deepEqual(validateExactPackageSpec("@kontourai/flow@1.2.3", "@kontourai/flow"), {
    ok: true,
    value: { packageName: "@kontourai/flow", version: "1.2.3", spec: "@kontourai/flow@1.2.3" },
  });
  assert.equal(validateExactPackageSpec("@kontourai/flow@1.2.3-beta.1+build.7").ok, true);
  for (const hostile of [
    "", "@kontourai/flow", "@kontourai/flow@latest", "@kontourai/flow@next",
    "@kontourai/flow@^1.2.3", "@kontourai/flow@~1.2.3", "@kontourai/flow@>=1",
    "@kontourai/flow@1.x", "@kontourai/flow@*", "@kontourai/flow@git+https://example.invalid/x",
    "@kontourai/flow@https://example.invalid/x.tgz", "@kontourai/flow@file:../x",
    "@kontourai/flow@../x", "@kontourai/flow@1.2.3\n--registry=evil",
  ]) assert.equal(validateExactPackageSpec(hostile, "@kontourai/flow").ok, false, hostile);
  assert.equal(validateExactPackageSpec("@attacker/wrong@1.2.3", "@kontourai/flow").ok, false);
  assert.equal(validateExplicitDownloadSpecs([], "@kontourai/flow").ok, false);
  assert.equal(validateExplicitDownloadSpecs(["@kontourai/flow@1.2.3", "@kontourai/flow@2.0.0"], "@kontourai/flow").ok, false);
});

test("router rejects unsafe bin paths and escaping symlinks without leaking hostile metadata", async (t) => {
  const hostileBins = ["../outside", "/tmp/outside", "C:\\outside.exe", "bin/%2e%2e/outside", "bin/control\u0000.mjs"];
  for (const bin of hostileBins) {
    await t.test("unsafe-bin", async () => {
      const root = await flowRoot();
      try {
        const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { bin: Record<string, string> };
        manifest.bin.flow = bin;
        await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
        const result = await routeCommand([`--product-root=flow=${root}`, "flow", "status"]);
        assert.equal(result.ok, false);
        if (!result.ok) assert.ok(result.diagnostics.every((item) => !item.message.includes(bin) && !item.message.includes(root)));
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  await t.test("escaping-symlink", async () => {
    const root = await flowRoot();
    const outside = path.join(await mkdtemp(path.join(tmpdir(), "kontour-outside-")), "outside.mjs");
    await writeFile(outside, "#!/usr/bin/env node\n");
    try {
      await unlink(path.join(root, "bin", "record.mjs"));
      await symlink(outside, path.join(root, "bin", "record.mjs"));
      const result = await routeCommand([`--product-root=flow=${root}`, "flow", "status"]);
      assert.equal(result.ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(path.dirname(outside), { recursive: true, force: true });
    }
  });
});

test("unsafe descriptor argv fails closed and a vanished resolved executable produces a safe spawn error", async () => {
  const root = await flowRoot();
  try {
    const descriptorPath = path.join(root, "product-capability-descriptor.json");
    const descriptor = JSON.parse(await readFile(fileURLToPath(new URL("../descriptors/flow.json", import.meta.url)), "utf8")) as { commands: Array<{ argv: string[] }> };
    descriptor.commands[0].argv = ["status\n--registry=secret"];
    await writeFile(descriptorPath, JSON.stringify(descriptor));
    const unsafe = await routeCommand([`--product-root=flow=${root}`, "flow", "status"]);
    assert.equal(unsafe.ok, false);

    await unlink(descriptorPath);
    const routed = await routeCommand([`--product-root=flow=${root}`, "flow", "status"]);
    assert.equal(routed.ok, true);
    if (!routed.ok) return;
    await unlink(routed.executablePath);
    await assert.rejects(delegateProduct(routed.executablePath, routed.argv), (error: unknown) => {
      assert.ok(error instanceof DelegationError);
      assert.equal(error.message, "The product executable could not be started.");
      assert.doesNotMatch(error.message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
