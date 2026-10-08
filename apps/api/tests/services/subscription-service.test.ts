import { beforeEach, describe, expect, it } from "vite-plus/test";
import { SubscriptionNotFoundError } from "../../src/services/errors";
import { SubscriptionService } from "../../src/services/subscription-service";
import {
  FakeDatabase,
  fakeRepositories,
  ownerActor,
  sequentialIds,
} from "../support/fakes";
import { synthetic } from "../support/fixtures";

const { streaming, music } = synthetic;
const otherActor = { ...ownerActor, userId: "u2", accountId: "account-other" };

let db: FakeDatabase;
let subscriptions: SubscriptionService;

beforeEach(() => {
  db = new FakeDatabase();
  subscriptions = new SubscriptionService({
    db: db.d1,
    repos: fakeRepositories(db),
    ids: sequentialIds("sub"),
  });
});

describe("SubscriptionService", () => {
  it("creates with a generated id inside the actor's account only", async () => {
    const created = await subscriptions.create(ownerActor, {
      ...streaming,
      id: undefined,
    });
    expect(created).toEqual({ ...streaming, id: "sub-1" });
    expect(await subscriptions.list(ownerActor)).toEqual([created]);
    expect(await subscriptions.list(otherActor)).toEqual([]);
  });

  it("refuses a likely duplicate and saves nothing", async () => {
    await subscriptions.create(ownerActor, streaming);
    await expect(
      subscriptions.create(ownerActor, {
        ...streaming,
        id: "other",
        name: "EXAMPLE streaming",
      }),
    ).rejects.toThrow("Possible duplicate: EXAMPLE streaming.");
    expect(db.subscriptionsOf(ownerActor.accountId)).toHaveLength(1);
  });

  it("rejects invalid fields through the domain schema", async () => {
    await expect(
      subscriptions.create(ownerActor, { ...streaming, currency: "usd" }),
    ).rejects.toThrow();
    expect(db.batches).toEqual([]);
  });

  it("merges updates and keeps the id", async () => {
    await subscriptions.create(ownerActor, streaming);
    expect(
      await subscriptions.update(ownerActor, "streaming", {
        amount: 11,
        id: "renamed",
      }),
    ).toEqual({ ...streaming, amount: 11 });
    expect(db.subscriptionsOf(ownerActor.accountId)).toEqual([
      { ...streaming, amount: 11 },
    ]);
  });

  it("reports unknown or foreign subscriptions as not found", async () => {
    await subscriptions.create(otherActor, music);
    await expect(
      subscriptions.update(ownerActor, "music", { amount: 1 }),
    ).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    await expect(
      subscriptions.remove(ownerActor, "music"),
    ).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    expect(await subscriptions.find(ownerActor, "music")).toBeNull();
    expect(db.subscriptionsOf(otherActor.accountId)).toHaveLength(1);
  });

  it("removes a subscription", async () => {
    await subscriptions.create(ownerActor, streaming);
    await subscriptions.remove(ownerActor, "streaming");
    expect(await subscriptions.list(ownerActor)).toEqual([]);
  });
});
