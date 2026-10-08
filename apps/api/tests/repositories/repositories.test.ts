// Every repository statement against a real local D1 with all migrations.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test";
import { ensureAccountStatement } from "../../src/repositories/accounts";
import { insertAuditEventStatement } from "../../src/repositories/audit-events";
import {
  insertReviewStatement,
  reviewExists,
} from "../../src/repositories/reviews";
import {
  deleteSubscription,
  listSubscriptionsByAccount,
  upsertSubscriptionStatement,
} from "../../src/repositories/subscriptions";
import {
  insertUserIdentityStatement,
  touchUserIdentityStatement,
  type IdentityKey,
} from "../../src/repositories/user-identities";
import {
  findOwnerUser,
  findUserByIdentity,
  insertUserStatement,
  updateUserProfileStatement,
} from "../../src/repositories/users";
import { synthetic } from "../support/fixtures";
import { startLocalD1, type LocalD1 } from "../support/d1";

const { streaming, music } = synthetic;
const identity: IdentityKey = {
  provider: "cloudflare_access",
  issuer: "https://example.cloudflareaccess.com",
  subject: "owner-subject",
};
const owner = {
  id: "user-1",
  accountId: "account-a",
  role: "owner" as const,
  email: "owner@example.test",
  displayName: null,
};

let d1: LocalD1;
let db: D1Database;

beforeAll(async () => {
  d1 = await startLocalD1();
  db = d1.db;
});
afterAll(() => d1?.dispose());
beforeEach(async () => {
  await d1.reset();
  await db.batch([
    ensureAccountStatement(db, "account-a"),
    ensureAccountStatement(db, "account-b"),
  ]);
});

const row = (accountId: string, subscription = streaming) => ({
  accountId,
  subscription,
  duplicateKey: `${subscription.name}|${subscription.currency}`,
});

describe("accounts", () => {
  it("ensures an account without touching an existing one", async () => {
    await ensureAccountStatement(db, "account-a").run();
    const { results } = await db
      .prepare("SELECT id FROM accounts ORDER BY id")
      .all();
    expect(results).toEqual([{ id: "account-a" }, { id: "account-b" }]);
  });
});

describe("subscriptions", () => {
  it("lists only the account's subscriptions as domain objects", async () => {
    await db.batch([
      upsertSubscriptionStatement(db, row("account-a")),
      upsertSubscriptionStatement(db, row("account-b", music)),
    ]);
    expect(await listSubscriptionsByAccount(db, "account-a")).toEqual([
      streaming,
    ]);
    expect(await listSubscriptionsByAccount(db, "nobody")).toEqual([]);
  });

  it("replaces the stored copy on upsert", async () => {
    await upsertSubscriptionStatement(db, row("account-a")).run();
    await upsertSubscriptionStatement(
      db,
      row("account-a", { ...streaming, amount: 20 }),
    ).run();
    expect(await listSubscriptionsByAccount(db, "account-a")).toEqual([
      { ...streaming, amount: 20 },
    ]);
  });

  it("enforces one duplicate key per account and an existing account", async () => {
    await upsertSubscriptionStatement(db, row("account-a")).run();
    await expect(
      upsertSubscriptionStatement(db, {
        ...row("account-a", { ...music, id: "other" }),
        duplicateKey: row("account-a").duplicateKey,
      }).run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    await upsertSubscriptionStatement(db, row("account-b")).run();
    await expect(
      upsertSubscriptionStatement(db, row("missing-account")).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("deletes only within the account", async () => {
    await db.batch([
      upsertSubscriptionStatement(db, row("account-a")),
      upsertSubscriptionStatement(db, row("account-b")),
    ]);
    await deleteSubscription(db, "account-a", streaming.id);
    expect(await listSubscriptionsByAccount(db, "account-a")).toEqual([]);
    expect(await listSubscriptionsByAccount(db, "account-b")).toHaveLength(1);
  });

  it("rolls back a whole batch when one statement fails", async () => {
    await expect(
      db.batch([
        insertReviewStatement(db, "account-a", "review-1"),
        upsertSubscriptionStatement(db, row("account-a")),
        upsertSubscriptionStatement(db, {
          ...row("account-a", music),
          duplicateKey: row("account-a").duplicateKey,
        }),
      ]),
    ).rejects.toThrow();
    expect(await listSubscriptionsByAccount(db, "account-a")).toEqual([]);
    expect(await reviewExists(db, "account-a", "review-1")).toBe(false);
  });
});

describe("reviews", () => {
  it("records a request id once per account", async () => {
    expect(await reviewExists(db, "account-a", "review-1")).toBe(false);
    await insertReviewStatement(db, "account-a", "review-1").run();
    expect(await reviewExists(db, "account-a", "review-1")).toBe(true);
    expect(await reviewExists(db, "account-b", "review-1")).toBe(false);
    await expect(
      insertReviewStatement(db, "account-a", "review-1").run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe("users and identities", () => {
  it("finds a user through a linked identity", async () => {
    expect(await findUserByIdentity(db, identity)).toBeNull();
    await db.batch([
      insertUserStatement(db, owner),
      insertUserIdentityStatement(db, {
        ...identity,
        userId: owner.id,
        lastSeenAt: "2026-10-08 12:00:00",
      }),
    ]);
    expect(await findUserByIdentity(db, identity)).toEqual({
      ...owner,
      status: "active",
      sessionsValidAfter: 0,
      identityLastSeenAt: "2026-10-08 12:00:00",
    });
    expect(
      await findUserByIdentity(db, { ...identity, issuer: "https://other" }),
    ).toBeNull();
  });

  it("keeps each provider, issuer and subject linked once", async () => {
    await insertUserStatement(db, owner).run();
    const link = insertUserIdentityStatement(db, {
      ...identity,
      userId: owner.id,
      lastSeenAt: "2026-10-08 12:00:00",
    });
    await link.run();
    await expect(link.run()).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("rejects users without an account and unknown roles", async () => {
    await expect(
      insertUserStatement(db, { ...owner, accountId: "missing" }).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      insertUserStatement(db, {
        ...owner,
        role: "admin" as "owner",
      }).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("finds the earliest owner", async () => {
    expect(await findOwnerUser(db)).toBeNull();
    await db.batch([
      insertUserStatement(db, { ...owner, role: "member", id: "user-0" }),
      insertUserStatement(db, owner),
      insertUserStatement(db, { ...owner, id: "user-2" }),
    ]);
    expect(await findOwnerUser(db)).toMatchObject({ id: "user-1" });
  });

  it("updates the profile and the identity's last activity", async () => {
    await db.batch([
      insertUserStatement(db, owner),
      insertUserIdentityStatement(db, {
        ...identity,
        userId: owner.id,
        lastSeenAt: "2026-10-08 12:00:00",
      }),
    ]);
    await db.batch([
      updateUserProfileStatement(db, {
        id: owner.id,
        email: "new@example.test",
        displayName: "Synthetic Owner",
        updatedAt: "2026-10-08 12:30:00",
      }),
      touchUserIdentityStatement(db, {
        ...identity,
        lastSeenAt: "2026-10-08 12:30:00",
      }),
    ]);
    expect(await findUserByIdentity(db, identity)).toMatchObject({
      email: "new@example.test",
      displayName: "Synthetic Owner",
      identityLastSeenAt: "2026-10-08 12:30:00",
    });
  });
});

describe("audit events", () => {
  it("stores the summary as JSON", async () => {
    await insertUserStatement(db, owner).run();
    await insertAuditEventStatement(db, {
      id: "event-1",
      accountId: "account-a",
      actorUserId: owner.id,
      action: "identity.linked",
      targetType: "user",
      targetId: owner.id,
      summary: { provider: "cloudflare_access", newUser: true },
    }).run();
    expect(
      await db
        .prepare("SELECT action, summary FROM audit_events WHERE id = ?")
        .bind("event-1")
        .first(),
    ).toEqual({
      action: "identity.linked",
      summary: '{"provider":"cloudflare_access","newUser":true}',
    });
  });
});
