/** An external sign-in identity, unique per provider, issuer and subject. */
export interface IdentityKey {
  provider: "cloudflare_access";
  issuer: string;
  subject: string;
}

export function insertUserIdentityStatement(
  db: D1Database,
  identity: IdentityKey & { userId: string; lastSeenAt: string },
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO user_identities(provider, issuer, subject, user_id, last_seen_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      identity.provider,
      identity.issuer,
      identity.subject,
      identity.userId,
      identity.lastSeenAt,
    );
}

export function touchUserIdentityStatement(
  db: D1Database,
  identity: IdentityKey & { lastSeenAt: string },
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE user_identities SET last_seen_at = ? WHERE provider = ? AND issuer = ? AND subject = ?",
    )
    .bind(
      identity.lastSeenAt,
      identity.provider,
      identity.issuer,
      identity.subject,
    );
}

/** The identity most recently linked to a user, or null if it has none. */
export async function findLatestUserIdentity(
  db: D1Database,
  userId: string,
): Promise<IdentityKey | null> {
  return db
    .prepare(
      "SELECT provider, issuer, subject FROM user_identities WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .bind(userId)
    .first<IdentityKey>();
}
