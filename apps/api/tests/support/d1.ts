import { readdirSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

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
 * Starts a real local D1 (workerd through Miniflare, the runtime under cf and
 * the Cloudflare Vite plugin) with every migration in apps/api/migrations
 * applied. Nothing is persisted.
 */
export async function startLocalD1(): Promise<LocalD1> {
  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: "saldo-test",
          compatibilityDate: "2026-10-01",
          manifest: {
            mainModule: "index.mjs",
            modules: {
              "index.mjs": { type: "esm", contents: "export default {};" },
            },
          },
          env: { DB: { type: "d1", id: "saldo-test" } },
        },
      },
    ],
  });
  const db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
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
      await miniflare.dispose();
    },
  };
}
