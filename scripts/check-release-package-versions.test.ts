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
    serverManifest: { name: "@kontourai/console", version: "0.1.0", dependencies: { "@kontourai/console-core": coreVersion } },
    lockfile: {
      name: "@kontourai/console",
      version: rootVersion,
      packages: {
        "": { name: "@kontourai/console", version: rootVersion, dependencies: { stable: "1.0.0", "@kontourai/console-core": coreVersion } },
        cli: { name: "@kontourai/cli", version: cliVersion, dependencies: { stable: "1.0.0", "@kontourai/console-core": coreVersion } },
        "console-core": { name: "@kontourai/console-core", version: coreVersion },
        "console-server": { name: "@kontourai/console", version: "0.1.0", dependencies: { "@kontourai/console-core": coreVersion } },
        "node_modules/stable": { version: "1.0.0", integrity: "sha512-unchanged" },
      },
    },
    releaseConfig: { packages: {
      cli: { "extra-files": [{ type: "json", path: "/package-lock.json", jsonpath: "$.packages.cli.version" }] },
      "console-core": { "extra-files": [{ type: "json", path: "/package-lock.json", jsonpath: "$.packages.console-core.version" }, { type: "json", path: "/package-lock.json", jsonpath: "$.packages.cli.dependencies['@kontourai/console-core']" }, { type: "json", path: "/console-server/package.json", jsonpath: "$.dependencies['@kontourai/console-core']" }, { type: "json", path: "/package-lock.json", jsonpath: "$.packages.console-server.dependencies['@kontourai/console-core']" }, { type: "json", path: "/package-lock.json", jsonpath: "$.packages[''].dependencies['@kontourai/console-core']" }] },
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
  after.coreManifest.version = "0.2.1";
  after.lockfile.version = "2.6.0";
  after.lockfile.packages[""].version = "2.6.0";
  after.lockfile.packages.cli.version = "0.3.0";
  after.lockfile.packages.cli.dependencies["@kontourai/console-core"] = "0.2.1";
  after.lockfile.packages[""].dependencies["@kontourai/console-core"] = "0.2.1";
  after.lockfile.packages["console-server"].dependencies["@kontourai/console-core"] = "0.2.1";
  after.lockfile.packages["console-core"].version = "0.2.1";
  validateReleasePackageVersions(after);
  assert.deepEqual(changedPaths(before.lockfile, after.lockfile), ['$.packages.[""].dependencies.@kontourai/console-core', "$.packages.cli.dependencies.@kontourai/console-core", "$.packages.cli.version", "$.packages.console-core.version", "$.packages.console-server.dependencies.@kontourai/console-core"]);
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
  ["missing Core release updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"] = []; }, /Core package must declare exactly five/],
  ["wrong Core root dependency updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][4].jsonpath = "$.dependencies['@kontourai/console-core']"; }, /must target \/package-lock\.json \$\.packages\[''\]\.dependencies/],
  ["wrong Core CLI dependency updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][1].jsonpath = "$.packages.cli.dependencies.core"; }, /must target \/package-lock\.json \$\.packages\.cli\.dependencies/],
  ["wrong Core Console Server manifest updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][2].path = "/packages/console-server/package.json"; }, /must target \/console-server\/package\.json/],
  ["wrong Core Console Server lock updater", (value: ReturnType<typeof fixture>) => { value.releaseConfig.packages["console-core"]["extra-files"][3].jsonpath = "$.packages['console-server'].dependencies.core"; }, /must target \/package-lock\.json \$\.packages\.console-server\.dependencies/],
] as const) test(`release package checker rejects ${label}`, () => {
  const value = fixture();
  mutate(value);
  assert.throws(() => validateReleasePackageVersions(value), expected);
});
