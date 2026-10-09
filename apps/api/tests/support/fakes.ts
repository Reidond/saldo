// In-memory fakes for service tests. FakeDatabase mirrors the repository
// contracts (scoping, unique keys, atomic batches) without SQL; the real SQL
// is covered by tests/repositories against a local D1.
import type { Subscription } from "@saldo/domain";
import type { Repositories } from "../../src/repositories";
import type { AuditEvent } from "../../src/repositories/audit-events";
import type { SubscriptionRow } from "../../src/repositories/subscriptions";
import type { IdentityKey } from "../../src/repositories/user-identities";
import type { User } from "../../src/repositories/users";
import type { Actor } from "../../src/services/identity-service";
import type {
  AccessTokenClaims,
  AccessTokenVerifier,
  AiProvider,
  Clock,
  ExtractionInput,
  ExtractionResult,
  IdGenerator,
} from "../../src/services/ports";

interface State {
  accounts: Set<string>;
  subscriptions: Map<string, SubscriptionRow>;
  reviews: Set<string>;
  users: Map<string, User>;
  identities: Map<string, { userId: string; lastSeenAt: string | null }>;
  auditEvents: AuditEvent[];
}

type FakeStatement = D1PreparedStatement & { apply(state: State): void };

const key = (...parts: string[]) => parts.join("\u0000");
const identityKey = (i: IdentityKey) => key(i.provider, i.issuer, i.subject);

export class FakeDatabase {
  state: State = {
    accounts: new Set(),
    subscriptions: new Map(),
    reviews: new Set(),
    users: new Map(),
    identities: new Map(),
    auditEvents: [],
  };
  batches: number[] = [];
  /** Makes the next batch fail as if a constraint was violated. */
  failNextBatch: Error | null = null;

  /** All or nothing, like D1's batch. */
  async batch(statements: D1PreparedStatement[]) {
    this.batches.push(statements.length);
    const failure = this.failNextBatch;
    this.failNextBatch = null;
    if (failure) throw failure;
    const next = structuredClone(this.state);
    for (const statement of statements)
      (statement as FakeStatement).apply(next);
    this.state = next;
    return [];
  }

  statement(apply: (state: State) => void): D1PreparedStatement {
    const statement = {
      apply,
      run: async () => {
        await this.batch([statement as unknown as D1PreparedStatement]);
        return { success: true, results: [], meta: {} };
      },
    };
    return statement as unknown as D1PreparedStatement;
  }

  /** The fake as the D1Database that services receive. */
  get d1() {
    return this as unknown as D1Database;
  }

  subscriptionsOf(accountId: string): Subscription[] {
    return [...this.state.subscriptions.values()]
      .filter((row) => row.accountId === accountId)
      .map((row) => row.subscription);
  }
}

export function fakeRepositories(db: FakeDatabase): Repositories {
  const userWithIdentity = (identity: IdentityKey) => {
    const link = db.state.identities.get(identityKey(identity));
    const user = link && db.state.users.get(link.userId);
    return user ? { ...user, identityLastSeenAt: link.lastSeenAt } : null;
  };
  return {
    ensureAccountStatement: (_, accountId) =>
      db.statement((s) => void s.accounts.add(accountId)),
    listSubscriptionsByAccount: async (_, accountId) =>
      structuredClone(db.subscriptionsOf(accountId)),
    upsertSubscriptionStatement: (_, row) =>
      db.statement((s) => {
        for (const other of s.subscriptions.values())
          if (
            other.accountId === row.accountId &&
            other.subscription.id !== row.subscription.id &&
            other.duplicateKey === row.duplicateKey
          )
            throw new Error(
              "UNIQUE constraint failed: subscriptions.account_id, subscriptions.duplicate_key",
            );
        s.subscriptions.set(
          key(row.accountId, row.subscription.id),
          structuredClone(row),
        );
      }),
    deleteSubscription: async (_, accountId, id) => {
      await db.batch([
        db.statement((s) => void s.subscriptions.delete(key(accountId, id))),
      ]);
    },
    reviewExists: async (_, accountId, requestId) =>
      db.state.reviews.has(key(accountId, requestId)),
    insertReviewStatement: (_, accountId, requestId) =>
      db.statement((s) => {
        if (s.reviews.has(key(accountId, requestId)))
          throw new Error("UNIQUE constraint failed: reviews");
        s.reviews.add(key(accountId, requestId));
      }),
    findUserByIdentity: async (_, identity) => userWithIdentity(identity),
    findOwnerUser: async () =>
      [...db.state.users.values()].find((u) => u.role === "owner") ?? null,
    insertUserStatement: (_, user) =>
      db.statement((s) => {
        if (!s.accounts.has(user.accountId))
          throw new Error("FOREIGN KEY constraint failed");
        s.users.set(user.id, {
          ...user,
          status: "active",
          sessionsValidAfter: 0,
        });
      }),
    updateUserProfileStatement: (_, profile) =>
      db.statement((s) => {
        const user = s.users.get(profile.id);
        if (user)
          Object.assign(user, {
            email: profile.email,
            displayName: profile.displayName,
          });
      }),
    insertUserIdentityStatement: (_, identity) =>
      db.statement((s) => {
        if (s.identities.has(identityKey(identity)))
          throw new Error("UNIQUE constraint failed: user_identities");
        s.identities.set(identityKey(identity), {
          userId: identity.userId,
          lastSeenAt: identity.lastSeenAt,
        });
      }),
    touchUserIdentityStatement: (_, identity) =>
      db.statement((s) => {
        const link = s.identities.get(identityKey(identity));
        if (link) link.lastSeenAt = identity.lastSeenAt;
      }),
    insertAuditEventStatement: (_, event) =>
      db.statement((s) => void s.auditEvents.push(structuredClone(event))),
  };
}

export function fixedClock(iso = "2026-10-08T12:00:00.000Z") {
  const clock = {
    current: new Date(iso),
    now: () => new Date(clock.current),
    advance(ms: number) {
      clock.current = new Date(clock.current.getTime() + ms);
    },
  };
  return clock satisfies Clock;
}

export function sequentialIds(prefix = "id"): IdGenerator {
  let next = 0;
  return { uuid: () => `${prefix}-${++next}` };
}

/** Accepts tokens named "token:<subject>" and rejects everything else. */
export function fakeVerifier(
  claims: Partial<AccessTokenClaims> = {},
): AccessTokenVerifier & { calls: number } {
  const verifier = {
    calls: 0,
    async verify(token: string, expected: { teamDomain: string }) {
      verifier.calls++;
      if (!token.startsWith("token:")) throw new Error("invalid token");
      return {
        issuer: `https://${expected.teamDomain}`,
        subject: token.slice("token:".length),
        issuedAt: 1_800_000_000,
        ...claims,
      };
    },
  };
  return verifier;
}

export function fakeAiProvider(
  reply: ExtractionResult | ((input: ExtractionInput) => ExtractionResult) = {
    reply: "Done.",
    proposals: [],
  },
): AiProvider & { inputs: ExtractionInput[]; signals: AbortSignal[] } {
  const provider = {
    enabled: true,
    inputs: [] as ExtractionInput[],
    signals: [] as AbortSignal[],
    status: async () => ({ connected: true }),
    async extract(input: ExtractionInput, signal: AbortSignal) {
      provider.inputs.push(input);
      provider.signals.push(signal);
      return typeof reply === "function" ? reply(input) : reply;
    },
  };
  return provider;
}

export const ownerActor: Actor = {
  userId: "user-owner",
  accountId: "account-owner",
  role: "owner",
  email: "owner@example.test",
  displayName: "Synthetic Owner",
};
