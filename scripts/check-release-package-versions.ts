#!/usr/bin/env -S node --import tsx

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function identity(value: unknown, label: string): { name: string; version: string } {
  const item = record(value, label);
  if (typeof item.name !== "string" || typeof item.version !== "string") throw new Error(`${label} must contain string name and version fields`);
  return { name: item.name, version: item.version };
}

export function validateReleasePackageVersions(input: { rootManifest: unknown; cliManifest: unknown; coreManifest: unknown; serverManifest: unknown; lockfile: unknown; releaseConfig: unknown }): void {
  const rootManifest = identity(input.rootManifest, "root package manifest");
  const cliManifest = identity(input.cliManifest, "CLI package manifest");
  const coreManifest = identity(input.coreManifest, "Core package manifest");
  const serverManifest = identity(input.serverManifest, "Console Server package manifest");
  const serverManifestRecord = record(input.serverManifest, "Console Server package manifest");
  if (serverManifestRecord.private) throw new Error("Console Server package manifest must not be private");
  const serverPublishConfig = record(serverManifestRecord.publishConfig, "Console Server package manifest publishConfig");
  if (serverPublishConfig.access !== "public") throw new Error("Console Server package manifest publishConfig must declare public access");
  const exactCoreEdge = (value: unknown, label: string): string => {
    const dependency = record(record(value, label).dependencies, `${label} dependencies`)["@kontourai/console-core"];
    if (typeof dependency !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(dependency)) throw new Error(`${label} Core dependency must be an exact semver version`);
    if (dependency !== coreManifest.version) throw new Error(`${label} Core dependency ${dependency} does not match Core manifest ${coreManifest.version}`);
    return dependency;
  };
  const rootCoreDependency = exactCoreEdge(input.rootManifest, "root package manifest");
  const cliCoreDependency = exactCoreEdge(input.cliManifest, "CLI package manifest");
  const serverCoreDependency = exactCoreEdge(input.serverManifest, "Console Server package manifest");
  const lockfile = record(input.lockfile, "root package lock");
  const rootLockIdentity = identity(lockfile, "root package lock");
  const lockPackages = record(lockfile.packages, "root package lock packages");
  const rootLock = identity(lockPackages[""], "root package lock workspace");
  const cliLock = identity(lockPackages.cli, "CLI package lock workspace");
  const coreLock = identity(lockPackages["console-core"], "Core package lock workspace");
  const serverLockWorkspace = record(lockPackages["console-server"], "Console Server package lock workspace");
  const serverLock = identity(serverLockWorkspace, "Console Server package lock workspace");

  if (rootLockIdentity.name !== rootManifest.name) throw new Error(`root package lock top-level name ${rootLockIdentity.name} does not match manifest ${rootManifest.name}`);
  if (rootLockIdentity.version !== rootManifest.version) throw new Error(`root package lock top-level version ${rootLockIdentity.version} does not match manifest ${rootManifest.version}`);
  if (rootLock.name !== rootManifest.name) throw new Error(`root package lock name ${rootLock.name} does not match manifest ${rootManifest.name}`);
  if (rootLock.version !== rootManifest.version) throw new Error(`root package lock version ${rootLock.version} does not match manifest ${rootManifest.version}`);
  if (cliLock.name !== cliManifest.name) throw new Error(`CLI package lock name ${cliLock.name} does not match manifest ${cliManifest.name}`);
  if (cliLock.version !== cliManifest.version) throw new Error(`CLI package lock version ${cliLock.version} does not match manifest ${cliManifest.version}`);
  if (coreLock.name !== coreManifest.name || coreLock.version !== coreManifest.version) throw new Error(`Core package lock identity ${coreLock.name}@${coreLock.version} does not match manifest ${coreManifest.name}@${coreManifest.version}`);
  if (serverLock.name !== serverManifest.name || serverLock.version !== serverManifest.version) throw new Error(`Console Server package lock identity ${serverLock.name}@${serverLock.version} does not match manifest ${serverManifest.name}@${serverManifest.version}`);
  const rootLockDependencies = record(record(lockPackages[""], "root package lock workspace").dependencies, "root package lock dependencies");
  const cliLockDependencies = record(record(lockPackages.cli, "CLI package lock workspace").dependencies, "CLI package lock dependencies");
  const serverLockDependencies = record(serverLockWorkspace.dependencies, "Console Server package lock dependencies");
  if (rootLockDependencies["@kontourai/console-core"] !== rootCoreDependency) throw new Error("root Core dependency does not match package lock workspace edge");
  if (cliLockDependencies["@kontourai/console-core"] !== cliCoreDependency) throw new Error("CLI Core dependency does not match package lock workspace edge");
  if (serverLockDependencies["@kontourai/console-core"] !== serverCoreDependency) throw new Error("Console Server Core dependency does not match package lock workspace edge");

  const releaseConfig = record(input.releaseConfig, "Release Please config");
  const releasePackages = record(releaseConfig.packages, "Release Please packages");
  const rootRelease = record(releasePackages["."], "Release Please root package");
  const rootExclusions = rootRelease["exclude-paths"];
  if (!Array.isArray(rootExclusions) || !rootExclusions.includes("console-server")) throw new Error("Release Please root package must exclude console-server ownership");
  const cliRelease = record(releasePackages.cli, "Release Please CLI package");
  if (!Array.isArray(cliRelease["extra-files"])) throw new Error("Release Please CLI package must declare extra-files");
  const lockUpdaters = cliRelease["extra-files"].filter((value): value is JsonRecord => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const path = (value as JsonRecord).path;
    return typeof path === "string" && path.replace(/^\/+/, "") === "package-lock.json";
  });
  if (lockUpdaters.length !== 1) throw new Error("Release Please CLI package must declare exactly one root package-lock updater");
  const updater = lockUpdaters[0];
  if (updater.path !== "/package-lock.json") throw new Error("Release Please CLI package-lock updater must use repository-root path /package-lock.json");
  if (updater.type !== "json" || updater.jsonpath !== "$.packages.cli.version") throw new Error("Release Please CLI package-lock updater must target $.packages.cli.version as JSON");
  const coreRelease = record(releasePackages["console-core"], "Release Please Core package");
  const coreExtraFiles = coreRelease["extra-files"];
  if (!Array.isArray(coreExtraFiles) || coreExtraFiles.length !== 5) throw new Error("Release Please Core package must declare exactly five dependency updaters");
  const coreUpdaters = coreExtraFiles.map((value, index) => record(value, `Release Please Core package-lock updater ${index}`));
  const targets = new Set(coreUpdaters.map(value => `${value.type}:${value.path}:${value.jsonpath}`));
  for (const [path, jsonpath] of [["/package-lock.json", "$.packages.console-core.version"], ["/package-lock.json", "$.packages.cli.dependencies['@kontourai/console-core']"], ["/console-server/package.json", "$.dependencies['@kontourai/console-core']"], ["/package-lock.json", "$.packages.console-server.dependencies['@kontourai/console-core']"], ["/package-lock.json", "$.packages[''].dependencies['@kontourai/console-core']"]])
    if (!targets.has(`json:${path}:${jsonpath}`)) throw new Error(`Release Please Core updater must target ${path} ${jsonpath}`);
  const serverRelease = record(releasePackages["console-server"], "Release Please Console Server package");
  if (serverRelease["package-name"] !== "@kontourai/console-server") throw new Error("Release Please Console Server package must declare package-name @kontourai/console-server");
  if (serverRelease["include-component-in-tag"] !== true) throw new Error("Release Please Console Server package must include the component in its release tag");
  if (!Array.isArray(serverRelease["extra-files"])) throw new Error("Release Please Console Server package must declare extra-files");
  const serverLockUpdaters = serverRelease["extra-files"].filter((value): value is JsonRecord => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const path = (value as JsonRecord).path;
    return typeof path === "string" && path.replace(/^\/+/, "") === "package-lock.json";
  });
  if (serverLockUpdaters.length !== 1) throw new Error("Release Please Console Server package must declare exactly one root package-lock updater");
  const serverUpdater = serverLockUpdaters[0];
  if (serverUpdater.path !== "/package-lock.json") throw new Error("Release Please Console Server package-lock updater must use repository-root path /package-lock.json");
  if (serverUpdater.type !== "json" || serverUpdater.jsonpath !== "$.packages.console-server.version") throw new Error("Release Please Console Server package-lock updater must target $.packages.console-server.version as JSON");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkReleasePackageVersions(repositoryRoot = resolve(__dirname, "..")): void {
  validateReleasePackageVersions({
    rootManifest: readJson(resolve(repositoryRoot, "package.json")),
    cliManifest: readJson(resolve(repositoryRoot, "cli/package.json")),
    coreManifest: readJson(resolve(repositoryRoot, "console-core/package.json")),
    serverManifest: readJson(resolve(repositoryRoot, "console-server/package.json")),
    lockfile: readJson(resolve(repositoryRoot, "package-lock.json")),
    releaseConfig: readJson(resolve(repositoryRoot, "release-please-config.json")),
  });
}

if (require.main === module) {
  try {
    checkReleasePackageVersions();
    process.stdout.write("Release package manifest, lock, and updater identities match.\n");
  } catch (error) {
    process.stderr.write(`RELEASE_PACKAGE_VERSION_MISMATCH: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
