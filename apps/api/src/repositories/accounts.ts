/** Creates the tenant row if it is missing; an existing row is left as is. */
export function ensureAccountStatement(
  db: D1Database,
  accountId: string,
): D1PreparedStatement {
  return db
    .prepare("INSERT OR IGNORE INTO accounts(id) VALUES (?)")
    .bind(accountId);
}
