const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyConsoleMigrations,
  loadConsoleMigrations
} = require("../src/console-foundation/migrations");

test("loadConsoleMigrations resolves migrations from the published dist layout", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "console-migrations-dist-"));
  try {
    const moduleDir = path.join(rootDir, "pkg", "dist", "src", "console-foundation");
    const invalidSourceDir = path.join(rootDir, "pkg", "dist", "migrations");
    const migrationsDir = path.join(rootDir, "pkg", "migrations");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(path.join(invalidSourceDir, "0001_fake.sql"), { recursive: true });
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, "0001_x.sql"), "select 1;\n");

    assert.deepEqual(loadConsoleMigrations(undefined, moduleDir), [{
      version: "0001",
      name: "0001_x.sql",
      sql: "select 1;\n"
    }]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("loadConsoleMigrations prefers a qualified source layout and preserves an explicit directory override", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "console-migrations-source-"));
  try {
    const moduleDir = path.join(rootDir, "pkg", "src", "console-foundation");
    const sourceDir = path.join(rootDir, "pkg", "migrations");
    const fallbackDir = path.join(rootDir, "migrations");
    const explicitDir = path.join(rootDir, "explicit");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(fallbackDir, { recursive: true });
    fs.mkdirSync(explicitDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "README.md"), "not a migration\n");
    fs.writeFileSync(path.join(fallbackDir, "0002_fallback.sql"), "select 2;\n");
    fs.writeFileSync(path.join(explicitDir, "0002_second.sql"), "select 2;\n");
    fs.writeFileSync(path.join(explicitDir, "0001_first.sql"), "select 1;\n");

    assert.deepEqual(loadConsoleMigrations(undefined, moduleDir).map((migration: any) => migration.name), ["0002_fallback.sql"]);
    assert.deepEqual(loadConsoleMigrations(explicitDir, moduleDir).map((migration: any) => migration.name), [
      "0001_first.sql",
      "0002_second.sql"
    ]);

    fs.rmSync(explicitDir, { recursive: true, force: true });
    assert.throws(
      () => loadConsoleMigrations(explicitDir, moduleDir),
      (error: Error) => error.message.includes(path.resolve(explicitDir))
    );

    fs.writeFileSync(path.join(sourceDir, "0001_source.sql"), "select 1;\n");
    assert.deepEqual(loadConsoleMigrations(undefined, moduleDir).map((migration: any) => migration.name), ["0001_source.sql"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("loadConsoleMigrations throws with probed paths when no migrations directory resolves", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "console-migrations-missing-"));
  try {
    const moduleDir = path.join(rootDir, "pkg", "dist", "src", "console-foundation");
    const sourceCandidate = path.resolve(moduleDir, "..", "..", "migrations");
    const distCandidate = path.resolve(moduleDir, "..", "..", "..", "migrations");
    fs.mkdirSync(sourceCandidate, { recursive: true });
    fs.writeFileSync(path.join(sourceCandidate, "README.md"), "not a migration\n");

    assert.throws(
      () => loadConsoleMigrations(undefined, moduleDir),
      (error: Error) => error.message.includes(sourceCandidate) && error.message.includes(distCandidate)
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("applyConsoleMigrations propagates missing migration resolution before database calls", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "console-migrations-apply-missing-"));
  try {
    const moduleDir = path.join(rootDir, "pkg", "dist", "src", "console-foundation");
    const sourceCandidate = path.resolve(moduleDir, "..", "..", "migrations");
    const distCandidate = path.resolve(moduleDir, "..", "..", "..", "migrations");
    const client = new CountingMigrationClient();
    fs.mkdirSync(path.join(sourceCandidate, "0001_fake.sql"), { recursive: true });

    await assert.rejects(
      applyConsoleMigrations(client, undefined, moduleDir),
      (error: Error) => error.message.includes(sourceCandidate) && error.message.includes(distCandidate)
    );
    assert.equal(client.queryCount, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("applyConsoleMigrations logs applied and already-applied outcomes with a summary", async () => {
  const client = new FakeMigrationClient();
  const migrations = [
    { version: "0001", name: "0001_first.sql", sql: "select 1" },
    { version: "0002", name: "0002_second.sql", sql: "select 2" }
  ];
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    await applyConsoleMigrations(client, migrations);
    await applyConsoleMigrations(client, migrations);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(lines, [
    "console migration applied 0001_first.sql",
    "console migration applied 0002_second.sql",
    "console migrations complete: total=2 applied=2 skipped=0",
    "console migration already applied; skipped 0001_first.sql",
    "console migration already applied; skipped 0002_second.sql",
    "console migrations complete: total=2 applied=0 skipped=2"
  ]);
});

class FakeMigrationClient {
  migrations = new Set<string>();

  async query(text: string, values: any[] = []) {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized.startsWith("select version from console_schema_migrations")) {
      return { rows: this.migrations.has(values[0]) ? [{ version: values[0] }] : [] };
    }
    if (normalized.startsWith("insert into console_schema_migrations")) {
      this.migrations.add(values[0]);
    }
    return { rows: [] };
  }
}

class CountingMigrationClient {
  queryCount = 0;

  async query() {
    this.queryCount += 1;
    return { rows: [] };
  }
}
