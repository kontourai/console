import assert from "node:assert/strict";
import test from "node:test";
import { validateReleasePackageVersions } from "./check-release-package-versions";

function changedPaths(before: unknown, after: unknown, prefix = "$"): string[] {
  if (Object.is(before, after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [prefix];
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => changedPaths(left[key], right[key], `${prefix}.${key === "" ? '[""]' : key}`));
}

function fixture(rootVersion = "2.6.0", cliVersion = "0.3.1", coreVersion = "0.2.0") {
  return {
    rootManifest: { name: "@kontourai/console", version: rootVersion, dependencies: { "@kontourai/console-core": coreVersion } },
    cliManifest: { name: "@kontourai/cli", version: cliVersion, dependencies: { "@kontourai/console-core": coreVersion } },
    coreManifest: { name: "@kontourai/console-core", version: coreVersion },
    serverManifest: { name: "@kontourai/console-server", version: "0.1.0", publishConfig: { access: "public" }, dependencies: { "@kontourai/console-core": coreVersion } },
    uiManifest: { name: "@kontourai/console-ui", version: "0.1.0", publishConfig: { access: "public" }, dependencies: { "@kontourai/console-core": coreVersion } },
    lockfile: {
      name: "@kontourai/console",
      version: rootVersion,
      packages: {
        "": { name: "@kontourai/console", version: rootVersion, dependencies: { stable: "1.0.0", "@kontourai/console-core": coreVersion } },
        cli: { name: "@kontourai/cli", version: cliVersion, dependencies: { stable: "1.0.0", "@kontourai/console-core": coreVersion } },
        "console-core": { name: "@kontourai/console-core", version: coreVersion },
        "console-server": { name: "@kontourai/console-server", version: "0.1.0", dependencies: { "@kontourai/console-core": coreVersion } },
        "console-ui": { name: "@kontourai/console-ui", version: "0.1.0", dependencies: { "@kontourai/console-core": coreVersion } },
        "node_modules/stable": { version: "1.0.0", integrity: "sha512-unchanged" },
      },
    },
    releaseConfig: { packages: {
      ".": { "exclude-paths": ["cli", "console-core", "console-server", "console-ui"] },
      cli: { "extra-files": [{ type: "json", path: "/package-lock.json", jsonpath: "$.packages.cli.version" }] },
      "console-core": { "extra-files": [{ type: "json", path: "/package-lock.json", jsonpath: "$.packages.console-core.version" }, { type: "json", path: "/package-lock.json", jsonpath: "$.packages.cli.dependencies['@kontourai/console-core']" }, { type: "json", path: "/console-server/package.json", jsonpath: "$.dependencies['@kontourai/console-core']" }, { type: "json", path: "/package-lock.json", jsonpath: "$.packages.console-server.dependencies['@kontourai/console-core']" }, { type: "json", path: "/package-lock.json", jsonpath: "$.packages[''].dependencies['@kontourai/console-core']" }, { type: "json", path: "/package-lock.json", jsonpath: "$.packages.console-ui.dependencies['@kontourai/console-core']" }, { type: "json", path: "/console-ui/package.json", jsonpath: "$.dependencies['@kontourai/console-core']" }] },
      "console-server": { "package-name": "@kontourai/console-server", "include-component-in-tag": true, "extra-files": [{ type: "json", path: "/package-lock.json", jsonpath: "$.packages.console-server.version" }] },
      "console-ui": { "package-name": "@kontourai/console-ui", "include-component-in-tag": true, "extra-files": [{ type: "json", path: "/package-lock.json", jsonpath: "$.packages.console-ui.version" }] },
    } },
  };
}

test("release package checker accepts current and simultaneous root/CLI release identities", () => {
  assert.doesNotThrow(() => validateReleasePackageVersions(fixture()));
  assert.doesNotThrow(() => validateReleasePackageVersions(fixture("2.7.0", "0.3.2", "0.2.1")));
});

test("simulated targeted Release Please updates change only root and CLI lock identities", () => {
  const before = fixture();
  const after = structuredClone(before);
  after.rootManifest.version = "2.6.0";
  after.cliManifest.version = "0.3.0";
  after.cliManifest.dependencies["@kontourai/console-core"] = "0.2.1";
  after.rootManifest.dependencies["@kontourai/console-core"] = "0.2.1";
  after.serverManifest.dependencies["@kontourai/console-core"] = "0.2.1";
  after.uiManifest.dependencies["@kontourai/console-core"] = "0.2.1";
  after.coreManifest.version = "0.2.1";
  after.lockfile.version = "2.6.0";
  after.lockfile.packages[""].version = "2.6.0";
  after.lockfile.packages.cli.version = "0.3.0";
  after.lockfile.packages.cli.dependencies["@kontourai/console-core"] = "0.2.1";
  after.lockfile.packages[""].dependencies["@kontourai/console-core"] = "0.2.1";
  after.lockfile.packages["console-server"].dependencies["@kontourai/console-core"] = "0.2.1";
  after.lockfile.packages["console-ui"].dependencies["@kontourai/console-core"] = "0.2.1";
  after.lockfile.packages["console-core"].version = "0.2.1";
  validateReleasePackageVersions(after);
  assert.deepEqual(changedPaths(before.lockfile, after.lockfile), ['$.packages.[""].dependencies.@kontourai/console-core', "$.packages.cli.dependencies.@kontourai/console-core", "$.packages.cli.version", "$.packages.console-core.version", "$.packages.console-server.dependencies.@kontourai/console-core", "$.packages.console-ui.dependencies.@kontourai/console-core"]);
});

for (const [label, mutate, expected] of [
  ["stale CLI lock version", (value: ReturnType<typeof fixture>) => { value.cliManifest.version = "0.3.0"; }, /CLI package lock version 0\.3\.1 does not match manifest 0\.3\.0/],
  ["stale root workspace lock version", (value: ReturnType<typeof fixture>) => { value.lockfile.packages[""].version = "2.4.0"; }, /root package lock version/],
  ["stale top-level root lock version", (value: ReturnType<typeof fixture>) => { value.lockfile.version = "2.4.0"; }, /root package lock top-level version/],
  ["stale top-level root lock name", (value: ReturnType<typeof fixture>) => { value.lockfile.name = "@kontourai/not-console"; }, /root package lock top-level name/],
  ["missing top-level root lock version", (value: ReturnType<typeof fixture>) => { delete (value.lockfile as Record<string, unknown>).version; }, /root package lock must contain string name and version/],
  ["missing top-level root lock name", (value: ReturnType<typeof fixture>) => { delete (value.lockfile as Record<string, unknown>).name; }, /root package lock must contain string name and version/],
  ["wrong-type top-level root lock version", (value: ReturnType<typeof fixture>) => { (value.lockfile as Record<string, unknown>).version = 2; }, /root package lock must contain string name and version/],
  ["wrong-type top-level root lock name", (value: ReturnType<typeof fixture>) => { (value.lockfile as Record<string, unknown>).name = null; }, /root package lock must contain string name and version/],
  ["wrong CLI lock name", (value: ReturnType<typeof fixture>) => { value.lockfile.packages.cli.name = "@kontourai/not-cli"; }, /CLI package lock name/],
  ["missing CLI workspace", (value: ReturnType<typeof fixture>) => { delete (value.lockfile.packages as Record<string, unknown>).cli; }, /CLI package lock workspace/],
  ["non-string CLI manifest version", (value: ReturnType<typeof fixture>) => { (value.cliManifest as Record<string, unknown>).version = 3; }, /CLI package manifest must contain string name and version/],
  ["missing lock updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages.cli["extra-files"] = []; }, /exactly one root package-lock updater/],
  ["relative lock updater path", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages.cli["extra-files"][0].path = "package-lock.json"; }, /must use repository-root path/],
  ["wrong lock updater JSONPath", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages.cli["extra-files"][0].jsonpath = "$.version"; }, /must target \$\.packages\.cli\.version/],
  ["ranged Core dependency", (value: ReturnType<typeof fixture>) => { value.cliManifest.dependencies["@kontourai/console-core"] = "^0.2.0"; }, /must be an exact semver/],
  ["stale Core lock edge", (value: ReturnType<typeof fixture>) => { value.lockfile.packages.cli.dependencies["@kontourai/console-core"] = "0.1.0"; }, /does not match package lock workspace edge/],
  ["ranged root Core dependency", (value: ReturnType<typeof fixture>) => { value.rootManifest.dependencies["@kontourai/console-core"] = "^0.2.0"; }, /root package manifest Core dependency must be an exact semver/],
  ["stale root Core lock edge", (value: ReturnType<typeof fixture>) => { value.lockfile.packages[""].dependencies["@kontourai/console-core"] = "0.1.0"; }, /root Core dependency does not match package lock workspace edge/],
  ["ranged Console Server Core dependency", (value: ReturnType<typeof fixture>) => { value.serverManifest.dependencies["@kontourai/console-core"] = "^0.2.0"; }, /Console Server package manifest Core dependency must be an exact semver/],
  ["stale Console Server Core lock edge", (value: ReturnType<typeof fixture>) => { value.lockfile.packages["console-server"].dependencies["@kontourai/console-core"] = "0.1.0"; }, /Console Server Core dependency does not match package lock workspace edge/],
  ["stale Console Server lock version", (value: ReturnType<typeof fixture>) => { value.lockfile.packages["console-server"].version = "2.6.2"; }, /Console Server package lock identity .* does not match manifest/],
  ["private Console Server package", (value: ReturnType<typeof fixture>) => { (value.serverManifest as Record<string, unknown>).private = true; }, /Console Server package manifest must not be private/],
  ["missing Console Server publishConfig", (value: ReturnType<typeof fixture>) => { delete (value.serverManifest as Record<string, unknown>).publishConfig; }, /publishConfig must be an object/],
  ["Console Server publishConfig not public", (value: ReturnType<typeof fixture>) => { (value.serverManifest as Record<string, unknown>).publishConfig = { access: "restricted" }; }, /publishConfig must declare public access/],
  ["missing Console Server root exclusion", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["."]["exclude-paths"] = ["cli", "console-core", "console-ui"]; }, /root package must exclude console-server ownership/],
  ["missing Console Server release package-name", (value: ReturnType<typeof fixture>) => { delete (value.releaseConfig.packages["console-server"] as Record<string, unknown>)["package-name"]; }, /must declare package-name @kontourai\/console-server/],
  ["missing Console Server include-component-in-tag", (value: ReturnType<typeof fixture>) => { (value.releaseConfig.packages["console-server"] as Record<string, unknown>)["include-component-in-tag"] = false; }, /must include the component in its release tag/],
  ["missing Console Server release lock updater", (value: ReturnType<typeof fixture>) => { (value.releaseConfig.packages["console-server"] as Record<string, unknown>)["extra-files"] = []; }, /Console Server package must declare exactly one root package-lock updater/],
  ["wrong Console Server release lock updater JSONPath", (value: ReturnType<typeof fixture>) => { (value.releaseConfig.packages["console-server"] as { "extra-files": Array<Record<string, unknown>> })["extra-files"][0].jsonpath = "$.version"; }, /must target \$\.packages\.console-server\.version/],
  ["stale Console UI Core lock edge", (value: ReturnType<typeof fixture>) => { value.lockfile.packages["console-ui"].dependencies["@kontourai/console-core"] = "0.1.0"; }, /Console UI Core dependency does not match package lock workspace edge/],
  ["ranged Console UI Core dependency", (value: ReturnType<typeof fixture>) => { value.uiManifest.dependencies["@kontourai/console-core"] = "^0.2.0"; }, /Console UI package manifest Core dependency must be an exact semver/],
  ["stale Console UI lock version", (value: ReturnType<typeof fixture>) => { value.lockfile.packages["console-ui"].version = "0.1.2"; }, /Console UI package lock identity .* does not match manifest/],
  ["private Console UI package", (value: ReturnType<typeof fixture>) => { (value.uiManifest as Record<string, unknown>).private = true; }, /Console UI package manifest must not be private/],
  ["missing Console UI publishConfig", (value: ReturnType<typeof fixture>) => { delete (value.uiManifest as Record<string, unknown>).publishConfig; }, /publishConfig must be an object/],
  ["Console UI publishConfig not public", (value: ReturnType<typeof fixture>) => { (value.uiManifest as Record<string, unknown>).publishConfig = { access: "restricted" }; }, /publishConfig must declare public access/],
  ["missing Console UI release package-name", (value: ReturnType<typeof fixture>) => { delete (value.releaseConfig.packages["console-ui"] as Record<string, unknown>)["package-name"]; }, /must declare package-name @kontourai\/console-ui/],
  ["missing Console UI include-component-in-tag", (value: ReturnType<typeof fixture>) => { (value.releaseConfig.packages["console-ui"] as Record<string, unknown>)["include-component-in-tag"] = false; }, /must include the component in its release tag/],
  ["missing Console UI release lock updater", (value: ReturnType<typeof fixture>) => { (value.releaseConfig.packages["console-ui"] as Record<string, unknown>)["extra-files"] = []; }, /Console UI package must declare exactly one root package-lock updater/],
  ["wrong Console UI release lock updater JSONPath", (value: ReturnType<typeof fixture>) => { (value.releaseConfig.packages["console-ui"] as { "extra-files": Array<Record<string, unknown>> })["extra-files"][0].jsonpath = "$.version"; }, /must target \$\.packages\.console-ui\.version/],
  ["missing Core release updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"] = []; }, /Core package must declare exactly seven/],
  ["wrong Core root dependency updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][4].jsonpath = "$.dependencies['@kontourai/console-core']"; }, /must target \/package-lock\.json \$\.packages\[''\]\.dependencies/],
  ["wrong Core CLI dependency updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][1].jsonpath = "$.packages.cli.dependencies.core"; }, /must target \/package-lock\.json \$\.packages\.cli\.dependencies/],
  ["wrong Core Console Server manifest updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][2].path = "/packages/console-server/package.json"; }, /must target \/console-server\/package\.json/],
  ["wrong Core Console Server lock updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][3].jsonpath = "$.packages['console-server'].dependencies.core"; }, /must target \/package-lock\.json \$\.packages\.console-server\.dependencies/],
  ["wrong Core Console UI lock updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][5].jsonpath = "$.packages['console-ui'].dependencies.core"; }, /must target \/package-lock\.json \$\.packages\.console-ui\.dependencies/],
  ["wrong Core Console UI manifest updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][6].path = "/packages/console-ui/package.json"; }, /must target \/console-ui\/package\.json/],
] as const) test(`release package checker rejects ${label}`, () => {
  const value = fixture();
  mutate(value);
  assert.throws(() => validateReleasePackageVersions(value), expected);
});
