import { beforeEach, describe, expect, it } from "vite-plus/test";
import { ReviewService } from "../../src/services/review-service";
import { FakeDatabase, fakeRepositories, ownerActor } from "../support/fakes";
import { synthetic } from "../support/fixtures";

const { streaming, music } = synthetic;
const requestId = "6f0c2c1e-8a8f-4a63-9a43-0d5a8c3f9b10";

let db: FakeDatabase;
let reviews: ReviewService;

beforeEach(async () => {
  db = new FakeDatabase();
  const repos = fakeRepositories(db);
  await repos
    .upsertSubscriptionStatement(db.d1, {
      accountId: ownerActor.accountId,
      subscription: streaming,
      duplicateKey: "examplestreaming|USD",
    })
    .run();
  db.batches = [];
  reviews = new ReviewService({ db: db.d1, repos });
});

describe("ReviewService", () => {
  it("records the review and every changed subscription in one batch", async () => {
    const outcome = await reviews.apply(ownerActor, {
      requestId,
      proposals: [
        { ...music, operation: "add" },
        {
          ...streaming,
          id: "ignored",
          amount: 20,
          operation: "update",
          targetId: "streaming",
        },
      ],
    });
    const ledger = [{ ...streaming, amount: 20 }, music];
    expect(outcome).toEqual({ subscriptions: ledger });
    expect(db.batches).toEqual([3]);
    expect(db.subscriptionsOf(ownerActor.accountId)).toEqual(ledger);
  });

  it("returns the current ledger for a request id it has already saved", async () => {
    const review = {
      requestId,
      proposals: [{ ...music, operation: "add" as const }],
    };
    await reviews.apply(ownerActor, review);
    expect(await reviews.apply(ownerActor, review)).toEqual({
      subscriptions: [streaming, music],
      alreadySaved: true,
    });
    expect(db.batches).toEqual([2]);
  });

  it("saves nothing when a proposal conflicts with the ledger", async () => {
    await expect(
      reviews.apply(ownerActor, {
        requestId,
        proposals: [
          { ...music, operation: "add" },
          { ...music, id: "x", operation: "update", targetId: "missing" },
        ],
      }),
    ).rejects.toThrow("Update target not found");
    expect(db.batches).toEqual([]);
    expect(db.state.reviews.size).toBe(0);
  });

  it("leaves no partial write when the batch fails", async () => {
    db.failNextBatch = new Error("storage unavailable");
    await expect(
      reviews.apply(ownerActor, {
        requestId,
        proposals: [{ ...music, operation: "add" }],
      }),
    ).rejects.toThrow("storage unavailable");
    expect(db.subscriptionsOf(ownerActor.accountId)).toEqual([streaming]);
    expect(db.state.reviews.size).toBe(0);
  });
});
