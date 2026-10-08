import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";

const migrations = new URL("../../migrations/", import.meta.url);

// Children before parents so foreign keys never block a reset. A new table
// must be added here, otherwise every suite that uses the database fails.
const deleteOrder = [
  "audit_events",
  "user_identities",
  "users",
  "reviews",
  "subscriptions",
  "conversations",
  "attachments",
  "accounts",
];

export interface LocalD1 {
  db: D1Database;
  /** Delete every row, keeping the migrated schema. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Starts a real local D1 (workerd through Wrangler's platform proxy) with
 * every migration in apps/api/migrations applied. Nothing is persisted.
 */
export async function startLocalD1(): Promise<LocalD1> {
  const directory = mkdtempSync(join(tmpdir(), "saldo-d1-"));
  const configPath = join(directory, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "saldo-test",
      compatibility_date: "2026-10-01",
      send_metrics: false,
      d1_databases: [
        {
          binding: "DB",
          database_name: "saldo-test",
          database_id: "saldo-test",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath,
    persist: false,
  });
  const db = proxy.env.DB;
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.prepare(readFileSync(new URL(file, migrations), "utf8")).run();
  const { results } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .all<{ name: string }>();
  const unknown = results.filter((t) => !deleteOrder.includes(t.name));
  if (unknown.length)
    throw new Error(
      `Add ${unknown.map((t) => t.name).join(", ")} to deleteOrder in tests/support/d1.ts`,
    );
  const tables = deleteOrder.filter((name) =>
    results.some((t) => t.name === name),
  );
  return {
    db,
    async reset() {
      await db.batch(tables.map((name) => db.prepare(`DELETE FROM ${name}`)));
    },
    async dispose() {
      await proxy.dispose();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
