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

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "migrations");

export function loadConsoleMigrations(migrationsDir: string = MIGRATIONS_DIR): ConsoleMigration[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((fileName: string) => /^\d+_.+\.sql$/.test(fileName))
    .sort()
    .map((fileName: string) => {
      const version = fileName.split("_")[0];
      return {
        version,
        name: fileName,
        sql: fs.readFileSync(path.join(migrationsDir, fileName), "utf8")
      };
    });
}

export async function applyConsoleMigrations(client: ConsoleSqlClient, migrations: ConsoleMigration[] = loadConsoleMigrations()): Promise<ConsoleMigrationResult[]> {
  await client.query("create table if not exists console_schema_migrations (version text primary key, applied_at timestamptz not null default now())");
  const results: ConsoleMigrationResult[] = [];
  for (const migration of migrations) {
    const existing = await client.query("select version from console_schema_migrations where version = $1", [migration.version]);
    if (existing.rows.length) {
      results.push({ version: migration.version, name: migration.name, applied: false });
      continue;
    }
    await client.query("begin");
    try {
      await client.query(migration.sql);
      await client.query("insert into console_schema_migrations (version) values ($1)", [migration.version]);
      await client.query("commit");
      results.push({ version: migration.version, name: migration.name, applied: true });
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  return results;
}
