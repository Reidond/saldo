import {
  duplicateKey,
  validateReview,
  type reviewSchema,
  type Subscription,
} from "@saldo/domain";
import type { z } from "zod";
import type { Repositories } from "../repositories";
import type { Actor } from "./identity-service";
import type { Database } from "./ports";

export type Review = z.infer<typeof reviewSchema>;

export interface ReviewOutcome {
  /** The whole ledger after the review. */
  subscriptions: Subscription[];
  /** Set when this request id was saved before; nothing changed. */
  alreadySaved?: true;
}

export interface ReviewServiceDeps {
  db: Database;
  repos: Pick<
    Repositories,
    | "insertReviewStatement"
    | "listSubscriptionsByAccount"
    | "reviewExists"
    | "upsertSubscriptionStatement"
  >;
}

/** Saves owner-reviewed proposals (from AI or import) in one transaction. */
export class ReviewService {
  readonly #deps: ReviewServiceDeps;

  constructor(deps: ReviewServiceDeps) {
    this.#deps = deps;
  }

  async apply(actor: Actor, review: Review): Promise<ReviewOutcome> {
    const { db, repos } = this.#deps;
    if (await repos.reviewExists(db, actor.accountId, review.requestId))
      return {
        subscriptions: await repos.listSubscriptionsByAccount(
          db,
          actor.accountId,
        ),
        alreadySaved: true,
      };
    const updated = validateReview(
      review.proposals,
      await repos.listSubscriptionsByAccount(db, actor.accountId),
    );
    const changed = new Set(
      review.proposals.map((p) =>
        p.operation === "update" ? p.targetId : p.id,
      ),
    );
    await db.batch([
      repos.insertReviewStatement(db, actor.accountId, review.requestId),
      ...updated
        .filter((s) => changed.has(s.id))
        .map((subscription) =>
          repos.upsertSubscriptionStatement(db, {
            accountId: actor.accountId,
            subscription,
            duplicateKey: duplicateKey(subscription),
          }),
        ),
    ]);
    return { subscriptions: updated };
  }
}
