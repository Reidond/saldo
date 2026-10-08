export interface AuditEvent {
  id: string;
  accountId: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** Allow-listed, non-secret details only. */
  summary: Record<string, string | number | boolean>;
}

export function insertAuditEventStatement(
  db: D1Database,
  event: AuditEvent,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit_events(id, account_id, actor_user_id, action, target_type, target_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      event.id,
      event.accountId,
      event.actorUserId,
      event.action,
      event.targetType,
      event.targetId,
      JSON.stringify(event.summary),
    );
}
