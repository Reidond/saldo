import type { IdentityKey } from "./user-identities";

export type UserRole = "owner" | "member";
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  accountId: string;
  role: UserRole;
  status: UserStatus;
  email: string | null;
  displayName: string | null;
  /** Unix seconds; Access tokens issued at or before this are rejected. */
  sessionsValidAfter: number;
}

/** A user reached through one of their sign-in identities. */
export interface IdentifiedUser extends User {
  identityLastSeenAt: string | null;
}

export interface NewUser {
  id: string;
  accountId: string;
  role: UserRole;
  email: string | null;
  displayName: string | null;
}

interface UserRecord {
  id: string;
  account_id: string;
  role: UserRole;
  status: UserStatus;
  email: string | null;
  display_name: string | null;
  sessions_valid_after: number;
}

const toUser = (row: UserRecord): User => ({
  id: row.id,
  accountId: row.account_id,
  role: row.role,
  status: row.status,
  email: row.email,
  displayName: row.display_name,
  sessionsValidAfter: row.sessions_valid_after,
});

export async function findUserByIdentity(
  db: D1Database,
  identity: IdentityKey,
): Promise<IdentifiedUser | null> {
  const row = await db
    .prepare(
      "SELECT u.id, u.account_id, u.role, u.status, u.email, u.display_name, u.sessions_valid_after, i.last_seen_at FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.issuer = ? AND i.subject = ?",
    )
    .bind(identity.provider, identity.issuer, identity.subject)
    .first<UserRecord & { last_seen_at: string | null }>();
  return row ? { ...toUser(row), identityLastSeenAt: row.last_seen_at } : null;
}

/** The earliest owner; Saldo instances have a single owner today. */
export async function findOwnerUser(db: D1Database): Promise<User | null> {
  const row = await db
    .prepare(
      "SELECT id, account_id, role, status, email, display_name, sessions_valid_after FROM users WHERE role = 'owner' ORDER BY created_at, id LIMIT 1",
    )
    .first<UserRecord>();
  return row ? toUser(row) : null;
}

export function insertUserStatement(
  db: D1Database,
  user: NewUser,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO users(id, account_id, role, email, display_name) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(user.id, user.accountId, user.role, user.email, user.displayName);
}

export function updateUserProfileStatement(
  db: D1Database,
  profile: {
    id: string;
    email: string | null;
    displayName: string | null;
    updatedAt: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE id = ?",
    )
    .bind(profile.email, profile.displayName, profile.updatedAt, profile.id);
}

/**
 * Rejects every Access token issued at or before `sessionsValidAfter` (Unix
 * seconds). The value never moves backwards, so a stale sign-out cannot
 * revive sessions that a later one ended.
 */
export function updateUserSessionsValidAfterStatement(
  db: D1Database,
  change: {
    id: string;
    accountId: string;
    sessionsValidAfter: number;
    updatedAt: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE users SET sessions_valid_after = MAX(sessions_valid_after, ?), updated_at = ? WHERE id = ? AND account_id = ?",
    )
    .bind(
      change.sessionsValidAfter,
      change.updatedAt,
      change.id,
      change.accountId,
    );
}
