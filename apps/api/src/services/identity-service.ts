import type { Repositories } from "../repositories";
import type { IdentityKey } from "../repositories/user-identities";
import type { IdentifiedUser, User, UserRole } from "../repositories/users";
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
  /**
   * Opt-in owner handover (OWNER_HANDOVER_FROM): the Access subject the owner
   * signed in with before `ownerSubject` or the team domain changed. Without
   * it, a new identity is never linked to an existing owner.
   */
  handoverFromSubject?: string;
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
    | "findLatestUserIdentity"
    | "findOwnerUser"
    | "findUserByIdentity"
    | "insertAuditEventStatement"
    | "insertUserIdentityStatement"
    | "insertUserStatement"
    | "touchUserIdentityStatement"
    | "updateUserProfileStatement"
    | "updateUserSessionsValidAfterStatement"
  >;
  verifier: AccessTokenVerifier;
  clock: Clock;
  ids: IdGenerator;
  config: IdentityConfig;
}

/** How an identity that is not linked yet may be linked. */
interface LinkPlan {
  /** The existing owner taking the identity over; null creates the owner. */
  owner: User | null;
  /** The owner's identity before the handover. */
  previous: IdentityKey | null;
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

const identityOf = (principal: Principal): IdentityKey => ({
  provider,
  issuer: principal.issuer,
  subject: principal.subject,
});

/** Throws unless the user may act with this token. */
function assertUsable(user: User, principal: Principal) {
  if (user.status !== "active" || user.role !== "owner")
    throw new AccessDeniedError();
  if (principal.issuedAt <= user.sessionsValidAfter)
    throw new SessionEndedError();
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
   * Whether this token may use the API right now, exactly as resolveActor
   * would decide (ended sessions, disabled users and refused handovers are
   * signed out), but without linking or writing anything.
   */
  async isSignedIn(token: string | null): Promise<boolean> {
    const principal = await this.authenticate(token);
    if (!principal) return false;
    try {
      const user = await this.#deps.repos.findUserByIdentity(
        this.#deps.db,
        identityOf(principal),
      );
      const usable = user ?? (await this.#planLink(principal)).owner;
      if (usable) assertUsable(usable, principal);
      return true;
    } catch (error) {
      if (
        error instanceof AccessDeniedError ||
        error instanceof SessionEndedError
      )
        return false;
      throw error;
    }
  }

  /**
   * Finds the user linked to the Access identity, linking the owner on their
   * first request. A new owner keeps the account id equal to their Access
   * subject, so rows saved before users existed stay visible.
   */
  async resolveActor(principal: Principal): Promise<Actor> {
    const user =
      (await this.#deps.repos.findUserByIdentity(
        this.#deps.db,
        identityOf(principal),
      )) ?? (await this.#linkOwner(principal));
    assertUsable(user, principal);
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

  /**
   * Ends every session issued so far: from now on the API rejects each Access
   * token issued at or before this second, without waiting for Cloudflare
   * Access to revoke it. The web then sends the browser to the Access logout.
   */
  async signOut(actor: Actor): Promise<void> {
    const { db, repos, clock, ids } = this.#deps;
    const now = clock.now();
    await db.batch([
      repos.updateUserSessionsValidAfterStatement(db, {
        id: actor.userId,
        accountId: actor.accountId,
        sessionsValidAfter: Math.floor(now.getTime() / 1000),
        updatedAt: sqlTimestamp(now),
      }),
      repos.insertAuditEventStatement(db, {
        id: ids.uuid(),
        accountId: actor.accountId,
        actorUserId: actor.userId,
        action: "session.signed_out",
        targetType: "user",
        targetId: actor.userId,
        summary: { provider },
      }),
    ]);
  }

  /**
   * Decides how an identity that is not linked yet may be linked, without
   * writing. The configured owner's first identity creates the owner. Once an
   * owner exists, a different identity (a changed OWNER_SUB or team domain)
   * takes the owner's account over only through the explicit handover
   * setting, and only from the owner's most recently linked identity, so a
   * setting left behind cannot hand the account over a second time.
   */
  async #planLink(principal: Principal): Promise<LinkPlan> {
    const { db, repos, config } = this.#deps;
    if (principal.subject !== config.ownerSubject)
      throw new AccessDeniedError();
    const owner = await repos.findOwnerUser(db);
    if (!owner) return { owner: null, previous: null };
    const previous = await repos.findLatestUserIdentity(db, owner.id);
    if (
      !config.handoverFromSubject ||
      previous?.subject !== config.handoverFromSubject
    )
      throw new AccessDeniedError();
    return { owner, previous };
  }

  /** Links the owner's identity, creating the owner user if none exists. */
  async #linkOwner(principal: Principal): Promise<IdentifiedUser> {
    const { db, repos, clock, ids } = this.#deps;
    const identity = identityOf(principal);
    let plan: LinkPlan;
    try {
      plan = await this.#planLink(principal);
    } catch (error) {
      // A concurrent first request may have linked this identity after we
      // looked it up; it then counts as the owner's existing identity.
      const linked = await repos.findUserByIdentity(db, identity);
      if (linked) return linked;
      throw error;
    }
    const { owner, previous } = plan;
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
        action: previous ? "identity.handover" : "identity.linked",
        targetType: "user",
        targetId: userId,
        summary: previous
          ? {
              provider,
              issuerChanged: previous.issuer !== identity.issuer,
              subjectChanged: previous.subject !== identity.subject,
            }
          : { provider, newUser: true },
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

  /**
   * Keeps the profile current and records activity at most every 10 minutes.
   * This is bookkeeping that rides on any request, reads included, so a
   * failed write (D1 busy or read-only) never fails the request itself.
   */
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
          ...identityOf(principal),
          lastSeenAt: sqlTimestamp(now),
        }),
      );
    if (!statements.length) return;
    try {
      await db.batch(statements);
    } catch {
      // Retried on a later request; the profile shown comes from the token.
    }
  }
}
