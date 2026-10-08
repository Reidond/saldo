export async function reviewExists(
  db: D1Database,
  accountId: string,
  requestId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT request_id FROM reviews WHERE account_id = ? AND request_id = ?",
    )
    .bind(accountId, requestId)
    .first();
  return row !== null;
}

export function insertReviewStatement(
  db: D1Database,
  accountId: string,
  requestId: string,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO reviews(account_id, request_id) VALUES (?, ?)")
    .bind(accountId, requestId);
}
