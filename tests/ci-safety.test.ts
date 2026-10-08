import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateMigration } from "../scripts/ci/migrations";

const migrationScript = resolve("scripts/ci/migrations.ts");
const smokeScript = resolve("scripts/ci/smoke-image.ts");

describe("fail-closed additive migration policy", () => {
  it("accepts the complete existing migration", () => {
    expect(
      validateMigration(readFileSync("migrations/0001_core.sql", "utf8")),
    ).toEqual({ statementCount: 6 });
  });

  it.each([
    "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, note TEXT DEFAULT 'hello');",
    "create table if not exists notes(id INTEGER, amount REAL CHECK(amount >= 0), UNIQUE(id));",
    "CREATE TABLE IF NOT EXISTS notes(id INTEGER, parent_id TEXT, FOREIGN KEY(parent_id) REFERENCES accounts(id));",
    "CREATE INDEX notes_id ON notes(id);",
    "CREATE UNIQUE INDEX IF NOT EXISTS notes_id ON notes(id ASC, note DESC);",
    "ALTER TABLE notes ADD COLUMN description TEXT;",
    "ALTER TABLE notes ADD COLUMN amount NUMERIC DEFAULT -1.25e2;",
    "ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;",
    "ALTER TABLE notes ADD COLUMN note TEXT DEFAULT 'saved' NOT NULL;",
    "ALTER TABLE notes ADD COLUMN optional TEXT DEFAULT NULL;",
    "\uFEFFPRAGMA foreign_keys=ON; -- trailing comment",
  ])("accepts supported additive SQL: %s", (sql) => {
    expect(validateMigration(sql).statementCount).toBe(1);
  });

  it("does not mistake comments, quoted identifiers or string literals for SQL commands", () => {
    expect(
      validateMigration(`
      -- DROP TABLE accounts; DELETE FROM accounts;
      /* UPDATE accounts SET id='x'; TRUNCATE accounts; REPLACE INTO accounts; */
      CREATE TABLE IF NOT EXISTS "DROP" (
        [DELETE] TEXT DEFAULT 'UPDATE; DROP TABLE accounts; -- still text',
        \`TRUNCATE\` TEXT DEFAULT 'it''s /* not a comment */; REPLACE',
        "odd""name" TEXT
      );
      CREATE INDEX "DELETE" ON "DROP"([DELETE]);
    `),
    ).toEqual({ statementCount: 2 });
  });

  it.each([
    "DROP TABLE accounts;",
    "DELETE FROM accounts;",
    "UPDATE accounts SET id='x';",
    "TRUNCATE accounts;",
    "REPLACE INTO accounts VALUES ('x');",
    "INSERT INTO accounts VALUES ('x');",
    "SELECT load_extension('anything');",
    "PRAGMA foreign_keys=OFF;",
    "PRAGMA writable_schema=ON;",
    "PRAGMA foreign_keys=1;",
    "PRAGMA main.foreign_keys=ON;",
    "ATTACH DATABASE 'file' AS other;",
    "DETACH DATABASE other;",
    "VACUUM;",
    "ANALYZE;",
    "REINDEX;",
    "BEGIN;",
    "COMMIT;",
    "CREATE TRIGGER dangerous AFTER INSERT ON accounts BEGIN DELETE FROM accounts; END;",
    "CREATE VIRTUAL TABLE IF NOT EXISTS lookup USING fts5(text);",
    "CREATE VIEW alias AS SELECT * FROM accounts;",
    "CREATE TABLE IF NOT EXISTS copy AS SELECT * FROM accounts;",
    "CREATE TABLE notes(id TEXT);",
    "CREATE TEMP TABLE IF NOT EXISTS notes(id TEXT);",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY ON CONFLICT REPLACE);",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT DEFAULT (random()));",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT CHECK(load_extension('file')));",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT CHECK(unknown_function(id)));",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT GENERATED ALWAYS AS (random()));",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT REFERENCES accounts(id) ON DELETE CASCADE);",
    "CREATE TABLE IF NOT EXISTS sqlite_schema(id TEXT);",
    'CREATE TABLE IF NOT EXISTS "sqlite_internal"(id TEXT);',
    "CREATE TABLE IF NOT EXISTS main.notes(id TEXT);",
    "CREATE INDEX id ON notes(lower(id));",
    "CREATE INDEX id ON notes(id) WHERE id IS NOT NULL;",
    "ALTER TABLE accounts RENAME TO archived;",
    "ALTER TABLE accounts DROP COLUMN id;",
    "ALTER TABLE accounts ADD COLUMN id TEXT PRIMARY KEY;",
    "ALTER TABLE accounts ADD COLUMN id TEXT UNIQUE;",
    "ALTER TABLE accounts ADD COLUMN id TEXT REFERENCES other(id);",
    "ALTER TABLE accounts ADD COLUMN id TEXT CHECK(id != 'bad');",
    "ALTER TABLE accounts ADD COLUMN id TEXT NOT NULL;",
    "ALTER TABLE accounts ADD COLUMN id TEXT NOT NULL DEFAULT NULL;",
    "ALTER TABLE accounts ADD COLUMN id TEXT DEFAULT CURRENT_TIMESTAMP;",
    "ALTER TABLE accounts ADD COLUMN id TEXT DEFAULT (1);",
    "ALTER TABLE accounts ADD COLUMN id TEXT DEFAULT 'a' DEFAULT 'b';",
    "ALTER TABLE accounts ADD COLUMN id TEXT; DROP TABLE accounts;",
    "ALTER TABLE accounts ADD COLUMN id TEXT; /* safe? */ DELETE FROM accounts;",
    "ALTER TABLE accounts ADD COLUMN id TEXT D/**/ROP TABLE accounts;",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT); PRAGMA writable_schema=ON;",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT) unexpected_suffix;",
    "CREATE TABLE IF NOT EXISTS notes(id TEXT DEFAULT 'unterminated);",
    'CREATE TABLE IF NOT EXISTS "unterminated(id TEXT);',
    "/* unterminated",
    "/* nested /* comment */ PRAGMA foreign_keys=ON; */",
    "PRAGMA foreign_keys=ON;\0DROP TABLE accounts;",
    "PRAGMA foreign_keys=ON;;",
    "",
    "-- comments only",
  ])("rejects destructive, ambiguous or unsupported SQL: %s", (sql) => {
    expect(() => validateMigration(sql)).toThrow();
  });

  it("rejects excessively large files and deeply nested checks", () => {
    expect(() => validateMigration(" ".repeat(1_000_001))).toThrow(/1 MB/);
    expect(() =>
      validateMigration(
        `CREATE TABLE IF NOT EXISTS t(id INTEGER CHECK(${"NOT ".repeat(50)}id));`,
      ),
    ).toThrow(/nesting/);
  });

  it("runs the repository-wide check independently of the current directory", () => {
    const result = spawnSync(process.execPath, [migrationScript], {
      cwd: tmpdir(),
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("No database was contacted");
  });

  it("does not accept a caller-selected subset of migrations", () => {
    const result = spawnSync(
      process.execPath,
      [migrationScript, "migrations/0001_core.sql"],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("checks every repository migration");
  });

  it.each([
    "destructive",
    "empty",
    "unexpected file",
    "symlink",
    "nested directory",
    "linked root",
  ])("fails the whole repository scan for %s migration input", (variant) => {
    const root = mkdtempSync(join(tmpdir(), "saldo-migrations-test-"));
    const scriptDirectory = join(root, "scripts", "ci");
    const migrations = join(root, "migrations");
    mkdirSync(scriptDirectory, { recursive: true });
    copyFileSync(migrationScript, join(scriptDirectory, "migrations.ts"));
    mkdirSync(migrations);
    try {
      if (variant !== "empty") {
        writeFileSync(
          join(migrations, "0001_safe.sql"),
          "PRAGMA foreign_keys=ON;",
        );
        if (variant === "destructive")
          writeFileSync(
            join(migrations, "0002_bad.sql"),
            "DROP TABLE accounts;",
          );
        if (variant === "unexpected file")
          writeFileSync(
            join(migrations, "ignored.txt"),
            "DROP TABLE accounts;",
          );
        if (variant === "symlink")
          symlinkSync(
            join(migrations, "0001_safe.sql"),
            join(migrations, "0002_link.sql"),
          );
        if (variant === "nested directory")
          mkdirSync(join(migrations, "extra"));
        if (variant === "linked root") {
          rmSync(migrations, { recursive: true });
          const linked = join(root, "elsewhere");
          mkdirSync(linked);
          writeFileSync(
            join(linked, "0001_safe.sql"),
            "PRAGMA foreign_keys=ON;",
          );
          symlinkSync(linked, migrations);
        }
      }
      const result = spawnSync(
        process.execPath,
        [join(scriptDirectory, "migrations.ts")],
        { encoding: "utf8", timeout: 10_000 },
      );
      expect(result.status, result.stdout).toBe(1);
      expect(result.stderr).not.toBe("");
      expect(result.stdout).not.toContain("Validated");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

type DockerCall = { args: string[]; bridgeSecret: string };

// A fake executable tests orchestration without Docker, a daemon, an image,
// network access or real credentials. Actual image behavior is a CI-only check.
function runWithFakeDocker(failure: "none" | "run" | "smoke" = "none") {
  const directory = mkdtempSync(join(tmpdir(), "saldo-smoke-test-"));
  const log = join(directory, "calls.jsonl");
  writeFileSync(
    join(directory, "docker"),
    `#!/usr/bin/env node
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync(process.env.SALDO_TEST_DOCKER_LOG, JSON.stringify({
      args, bridgeSecret: process.env.AI_BRIDGE_SECRET
    }) + '\\n');
    if (process.env.SALDO_TEST_DOCKER_FAILURE === 'run' && args[0] === 'run') {
      console.error('synthetic container start failure'); process.exit(1);
    }
    if (process.env.SALDO_TEST_DOCKER_FAILURE === 'smoke' && args[0] === 'exec' && args.at(-1).includes('node:assert')) {
      console.error('synthetic smoke failure'); process.exit(1);
    }
    console.log('synthetic success');
  `,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(process.execPath, [smokeScript], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
        SALDO_TEST_DOCKER_LOG: log,
        SALDO_TEST_DOCKER_FAILURE: failure,
        AI_BRIDGE_SECRET: "caller-secret-must-never-be-used",
        OPENAI_API_KEY: "caller-provider-key-must-never-be-used",
      },
    });
    const calls: DockerCall[] = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("isolated prebuilt image smoke orchestration", () => {
  it("passes the Node syntax check", () => {
    const result = spawnSync(process.execPath, ["--check", smokeScript], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("uses only a fresh synthetic secret and performs loopback rejection probes before removal", () => {
    const { result, calls } = runWithFakeDocker();
    expect(result.status, result.stderr).toBe(0);
    const run = calls[0];
    expect(run.args).toContain("saldo-ai-bridge:ci");
    expect(
      run.args.slice(
        run.args.indexOf("--network"),
        run.args.indexOf("--network") + 2,
      ),
    ).toEqual(["--network", "none"]);
    expect(
      run.args.slice(
        run.args.indexOf("--pull"),
        run.args.indexOf("--pull") + 2,
      ),
    ).toEqual(["--pull", "never"]);
    expect(run.args.filter((arg) => arg === "--env")).toHaveLength(1);
    expect(
      run.args.slice(run.args.indexOf("--env"), run.args.indexOf("--env") + 2),
    ).toEqual(["--env", "AI_BRIDGE_SECRET"]);
    expect(run.bridgeSecret).toMatch(/^[A-Za-z0-9_-]{44,128}$/);
    expect(new Set(calls.map((call) => call.bridgeSecret)).size).toBe(1);
    expect(run.bridgeSecret).not.toBe("caller-secret-must-never-be-used");
    expect(run.args).not.toContain("-p");
    expect(run.args).not.toContain("--publish");
    expect(run.args).not.toContain("--env-file");
    expect(run.args).not.toContain("--volume");
    const probes = calls
      .filter((call) => call.args[0] === "exec")
      .map((call) => call.args.at(-1)!);
    expect(probes).toHaveLength(2);
    expect(probes.join("\n")).toContain("http://127.0.0.1:8080");
    expect(probes[1]).toContain("401, 'UNAUTHORIZED'");
    expect(probes[1]).toContain("404, 'NOT_FOUND'");
    expect(probes[1]).toContain("400, 'INVALID_INPUT'");
    expect(probes[1]).not.toContain("accessToken");
    for (const probe of probes) {
      const check = spawnSync(
        process.execPath,
        ["--check", "--input-type=module"],
        { input: probe, encoding: "utf8", timeout: 10_000 },
      );
      expect(check.status, check.stderr).toBe(0);
    }
    expect(calls.at(-1)?.args).toEqual([
      "rm",
      "--force",
      run.args[run.args.indexOf("--name") + 1],
    ]);
  });

  it.each(["run", "smoke"] as const)(
    "fails closed and still removes the container after %s failure",
    (failure) => {
      const { result, calls } = runWithFakeDocker(failure);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("synthetic");
      expect(calls.at(-1)?.args[0]).toBe("rm");
      expect(calls.at(-1)?.args).toContain("--force");
    },
  );

  it("reports a missing Docker executable without suggesting that a container was left behind", () => {
    const directory = mkdtempSync(join(tmpdir(), "saldo-no-docker-test-"));
    try {
      const result = spawnSync(process.execPath, [smokeScript], {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, PATH: directory },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Cannot start prebuilt image");
      expect(result.stderr).toContain("ENOENT");
      expect(result.stderr).not.toContain("Unable to remove");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
