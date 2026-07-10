const fs = require("node:fs");
const path = require("node:path");
import type { ConsoleSqlClient } from "./types";

export interface ConsoleMigration {
  version: string;
  name: string;
  sql: string;
}

export interface ConsoleMigrationResult {
  version: string;
  name: string;
  applied: boolean;
}

const MIGRATION_FILE_PATTERN = /^\d+_.+\.sql$/;

function migrationFileNames(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir) || !fs.statSync(migrationsDir).isDirectory()) return [];
  return fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry: import("node:fs").Dirent) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry: import("node:fs").Dirent) => entry.name)
    .sort();
}

function resolveConsoleMigrationsDir(moduleDir: string): string {
  const candidates = [
    path.resolve(moduleDir, "..", "..", "migrations"),
    path.resolve(moduleDir, "..", "..", "..", "migrations")
  ];
  const migrationsDir = candidates.find((candidate) => migrationFileNames(candidate).length > 0);
  if (migrationsDir) return migrationsDir;

  throw new Error(`Unable to resolve Console migrations directory. Probed: ${candidates.join(", ")}`);
}

export function loadConsoleMigrations(migrationsDir?: string, moduleDir: string = __dirname): ConsoleMigration[] {
  const resolvedDir = migrationsDir === undefined
    ? resolveConsoleMigrationsDir(moduleDir)
    : migrationsDir;
  const fileNames = migrationFileNames(resolvedDir);
  if (fileNames.length === 0) {
    throw new Error(`No Console migration files found in explicit migrations directory: ${path.resolve(resolvedDir)}`);
  }

  return fileNames
    .map((fileName: string) => {
      const version = fileName.split("_")[0];
      return {
        version,
        name: fileName,
        sql: fs.readFileSync(path.join(resolvedDir, fileName), "utf8")
      };
    });
}

export async function applyConsoleMigrations(client: ConsoleSqlClient, migrations?: ConsoleMigration[], moduleDir: string = __dirname): Promise<ConsoleMigrationResult[]> {
  const migrationsToApply = migrations ?? loadConsoleMigrations(undefined, moduleDir);
  await client.query("create table if not exists console_schema_migrations (version text primary key, applied_at timestamptz not null default now())");
  const results: ConsoleMigrationResult[] = [];
  for (const migration of migrationsToApply) {
    const existing = await client.query("select version from console_schema_migrations where version = $1", [migration.version]);
    if (existing.rows.length) {
      results.push({ version: migration.version, name: migration.name, applied: false });
      console.log(`console migration already applied; skipped ${migration.name}`);
      continue;
    }
    await client.query("begin");
    try {
      await client.query(migration.sql);
      await client.query("insert into console_schema_migrations (version) values ($1)", [migration.version]);
      await client.query("commit");
      results.push({ version: migration.version, name: migration.name, applied: true });
      console.log(`console migration applied ${migration.name}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  const applied = results.filter((result) => result.applied).length;
  console.log(`console migrations complete: total=${results.length} applied=${applied} skipped=${results.length - applied}`);
  return results;
}
