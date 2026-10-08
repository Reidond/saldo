import type { Repositories } from "../repositories";
import type { IdentifiedUser, UserRole } from "../repositories/users";
import { AccessDeniedError, SessionEndedError } from "./errors";
import type {
  AccessTokenVerifier,
  Clock,
  Database,
  IdGenerator,
} from "./ports";

const provider = "cloudflare_access";
const teamDomainPattern = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const lastSeenIntervalMs = 10 * 60 * 1000;

export interface IdentityConfig {
  teamDomain?: string;
  audience?: string;
  /** The only Access subject allowed to use this instance. */
  ownerSubject?: string;
}

/** A verified owner Access token. No database lookup has happened yet. */
export interface Principal {
  issuer: string;
  subject: string;
  issuedAt: number;
  email: string | null;
  name: string | null;
}

/** The signed-in user that every account-scoped service call acts for. */
export interface Actor {
  userId: string;
  accountId: string;
  role: UserRole;
  email: string | null;
  displayName: string | null;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
}

export interface IdentityServiceDeps {
  db: Database;
  repos: Pick<
    Repositories,
    | "ensureAccountStatement"
    | "findOwnerUser"
    | "findUserByIdentity"
    | "insertAuditEventStatement"
    | "insertUserIdentityStatement"
    | "insertUserStatement"
    | "touchUserIdentityStatement"
    | "updateUserProfileStatement"
  >;
  verifier: AccessTokenVerifier;
  clock: Clock;
  ids: IdGenerator;
  config: IdentityConfig;
}

/** D1's CURRENT_TIMESTAMP format, so every timestamp column compares alike. */
const sqlTimestamp = (date: Date) =>
  date.toISOString().slice(0, 19).replace("T", " ");
const parseSqlTimestamp = (value: string) =>
  Date.parse(`${value.replace(" ", "T")}Z`);

/** Optional display text from a signed claim; anything unusable is dropped. */
function claimText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

export class IdentityService {
  readonly #deps: IdentityServiceDeps;

  constructor(deps: IdentityServiceDeps) {
    this.#deps = deps;
  }

  /**
   * Verifies a Cf-Access-Jwt-Assertion and accepts only the configured owner
   * subject. Fails closed: missing configuration, a missing or invalid token
   * and any other subject all return null. Identity headers such as
   * Cf-Access-Authenticated-User-Email are never consulted.
   */
  async authenticate(token: string | null): Promise<Principal | null> {
    const { teamDomain, audience, ownerSubject } = this.#deps.config;
    if (!teamDomain || !audience || !ownerSubject || !token) return null;
    if (!teamDomainPattern.test(teamDomain)) return null;
    try {
      const claims = await this.#deps.verifier.verify(token, {
        teamDomain,
        audience,
      });
      if (claims.subject !== ownerSubject) return null;
      return {
        issuer: claims.issuer,
        subject: claims.subject,
        issuedAt: claims.issuedAt,
        email: claimText(claims.email, 320),
        name: claimText(claims.name, 160),
      };
    } catch {
      return null;
    }
  }

  /**
   * Finds the user linked to the Access identity, linking the owner on their
   * first request. A new owner keeps the account id equal to their Access
   * subject, so rows saved before users existed stay visible.
   */
  async resolveActor(principal: Principal): Promise<Actor> {
    const identity = {
      provider,
      issuer: principal.issuer,
      subject: principal.subject,
    } as const;
    const user =
      (await this.#deps.repos.findUserByIdentity(this.#deps.db, identity)) ??
      (await this.#linkOwner(principal));
    if (user.status !== "active" || user.role !== "owner")
      throw new AccessDeniedError();
    if (principal.issuedAt <= user.sessionsValidAfter)
      throw new SessionEndedError();
    await this.#refresh(user, principal);
    return {
      userId: user.id,
      accountId: user.accountId,
      role: user.role,
      email: principal.email ?? user.email,
      displayName: principal.name ?? user.displayName,
    };
  }

  describe(actor: Actor): CurrentUser {
    return {
      id: actor.userId,
      email: actor.email,
      displayName: actor.displayName,
      role: actor.role,
    };
  }

  /** Links the owner's identity, creating the owner user if none exists. */
  async #linkOwner(principal: Principal): Promise<IdentifiedUser> {
    const { db, repos, clock, ids, config } = this.#deps;
    if (principal.subject !== config.ownerSubject)
      throw new AccessDeniedError();
    const identity = {
      provider,
      issuer: principal.issuer,
      subject: principal.subject,
    } as const;
    const owner = await repos.findOwnerUser(db);
    const userId = owner?.id ?? ids.uuid();
    const accountId = owner?.accountId ?? principal.subject;
    const statements: D1PreparedStatement[] = [];
    if (!owner)
      statements.push(
        repos.ensureAccountStatement(db, accountId),
        repos.insertUserStatement(db, {
          id: userId,
          accountId,
          role: "owner",
          email: principal.email,
          displayName: principal.name,
        }),
      );
    statements.push(
      repos.insertUserIdentityStatement(db, {
        ...identity,
        userId,
        lastSeenAt: sqlTimestamp(clock.now()),
      }),
      repos.insertAuditEventStatement(db, {
        id: ids.uuid(),
        accountId,
        actorUserId: userId,
        action: "identity.linked",
        targetType: "user",
        targetId: userId,
        summary: { provider, newUser: !owner },
      }),
    );
    try {
      await db.batch(statements);
    } catch (error) {
      // A concurrent first request may have linked the same identity; the
      // batch is atomic, so the loser leaves nothing behind.
      const linked = await repos.findUserByIdentity(db, identity);
      if (linked) return linked;
      throw error;
    }
    const linked = await repos.findUserByIdentity(db, identity);
    if (!linked) throw new Error("Identity link was not stored");
    return linked;
  }

  /** Keeps the profile current and records activity at most every 10 minutes. */
  async #refresh(user: IdentifiedUser, principal: Principal) {
    const { db, repos, clock } = this.#deps;
    const now = clock.now();
    const email = principal.email ?? user.email;
    const displayName = principal.name ?? user.displayName;
    const statements: D1PreparedStatement[] = [];
    if (email !== user.email || displayName !== user.displayName)
      statements.push(
        repos.updateUserProfileStatement(db, {
          id: user.id,
          email,
          displayName,
          updatedAt: sqlTimestamp(now),
        }),
      );
    const lastSeen = user.identityLastSeenAt
      ? parseSqlTimestamp(user.identityLastSeenAt)
      : Number.NaN;
    if (!(now.getTime() - lastSeen < lastSeenIntervalMs))
      statements.push(
        repos.touchUserIdentityStatement(db, {
          provider,
          issuer: principal.issuer,
          subject: principal.subject,
          lastSeenAt: sqlTimestamp(now),
        }),
      );
    if (statements.length) await db.batch(statements);
  }
}
