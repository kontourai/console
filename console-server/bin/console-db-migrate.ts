#!/usr/bin/env node

const { applyConsoleMigrations } = require("../src/console-foundation/migrations");
const { loadConsoleMigrations } = require("../src/console-foundation/migrations");

async function main() {
  // A runner with zero migrations is a packaging bug, not a success
  // (bit the first hosted deploy: .sql files missing from the tarball).
  if (loadConsoleMigrations().length === 0) {
    console.error("No migration files found — the migrations directory is missing or empty.");
    process.exit(2);
  }
  if (process.argv.includes("--dry-run")) {
    for (const migration of loadConsoleMigrations()) {
      console.log(`would apply ${migration.name}`);
    }
    return;
  }

  const databaseUrl = process.env.CONSOLE_DATABASE_URL || process.env.CONSOLE_TELEMETRY_DATABASE_URL;
  if (!databaseUrl) {
    console.error("CONSOLE_DATABASE_URL is required");
    process.exit(2);
  }

  let pg;
  try {
    pg = require("pg");
  } catch {
    console.error("The pg package is required to run migrations against Postgres. Install it in the deployment package or provide a migration runner with a compatible SQL client.");
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const results = await applyConsoleMigrations(pool);
    for (const result of results) {
      console.log(`${result.applied ? "applied" : "skipped"} ${result.name}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

export {};
