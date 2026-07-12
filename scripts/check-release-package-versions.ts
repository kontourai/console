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

export function validateReleasePackageVersions(input: { rootManifest: unknown; cliManifest: unknown; lockfile: unknown; releaseConfig: unknown }): void {
  const rootManifest = identity(input.rootManifest, "root package manifest");
  const cliManifest = identity(input.cliManifest, "CLI package manifest");
  const lockfile = record(input.lockfile, "root package lock");
  const rootLockIdentity = identity(lockfile, "root package lock");
  const lockPackages = record(lockfile.packages, "root package lock packages");
  const rootLock = identity(lockPackages[""], "root package lock workspace");
  const cliLock = identity(lockPackages.cli, "CLI package lock workspace");

  if (rootLockIdentity.name !== rootManifest.name) throw new Error(`root package lock top-level name ${rootLockIdentity.name} does not match manifest ${rootManifest.name}`);
  if (rootLockIdentity.version !== rootManifest.version) throw new Error(`root package lock top-level version ${rootLockIdentity.version} does not match manifest ${rootManifest.version}`);
  if (rootLock.name !== rootManifest.name) throw new Error(`root package lock name ${rootLock.name} does not match manifest ${rootManifest.name}`);
  if (rootLock.version !== rootManifest.version) throw new Error(`root package lock version ${rootLock.version} does not match manifest ${rootManifest.version}`);
  if (cliLock.name !== cliManifest.name) throw new Error(`CLI package lock name ${cliLock.name} does not match manifest ${cliManifest.name}`);
  if (cliLock.version !== cliManifest.version) throw new Error(`CLI package lock version ${cliLock.version} does not match manifest ${cliManifest.version}`);

  const releaseConfig = record(input.releaseConfig, "Release Please config");
  const releasePackages = record(releaseConfig.packages, "Release Please packages");
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
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkReleasePackageVersions(repositoryRoot = resolve(__dirname, "..")): void {
  validateReleasePackageVersions({
    rootManifest: readJson(resolve(repositoryRoot, "package.json")),
    cliManifest: readJson(resolve(repositoryRoot, "cli/package.json")),
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
