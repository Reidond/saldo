import { subscriptionSchema, type Subscription } from "@saldo/domain";

export interface SubscriptionRow {
  accountId: string;
  subscription: Subscription;
  duplicateKey: string;
}

export async function listSubscriptionsByAccount(
  db: D1Database,
  accountId: string,
): Promise<Subscription[]> {
  const { results } = await db
    .prepare("SELECT data FROM subscriptions WHERE account_id = ?")
    .bind(accountId)
    .all<{ data: string }>();
  return results.map((row) => subscriptionSchema.parse(JSON.parse(row.data)));
}

/** Inserts the subscription or replaces the stored copy with the same id. */
export function upsertSubscriptionStatement(
  db: D1Database,
  row: SubscriptionRow,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO subscriptions(account_id, id, data, duplicate_key) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, id) DO UPDATE SET data = excluded.data, duplicate_key = excluded.duplicate_key, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(
      row.accountId,
      row.subscription.id,
      JSON.stringify(row.subscription),
      row.duplicateKey,
    );
}

export async function deleteSubscription(
  db: D1Database,
  accountId: string,
  id: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM subscriptions WHERE account_id = ? AND id = ?")
    .bind(accountId, id)
    .run();
}
