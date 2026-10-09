import {
  duplicateKey,
  subscriptionSchema,
  validateReview,
  type Subscription,
} from "@saldo/domain";
import type { Repositories } from "../repositories";
import { SubscriptionNotFoundError } from "./errors";
import type { Actor } from "./identity-service";
import type { Database, IdGenerator } from "./ports";

export interface SubscriptionServiceDeps {
  db: Database;
  repos: Pick<
    Repositories,
    | "deleteSubscription"
    | "listSubscriptionsByAccount"
    | "upsertSubscriptionStatement"
  >;
  ids: IdGenerator;
}

/** Manual subscription management. Never depends on AI. */
export class SubscriptionService {
  readonly #deps: SubscriptionServiceDeps;

  constructor(deps: SubscriptionServiceDeps) {
    this.#deps = deps;
  }

  list(actor: Actor): Promise<Subscription[]> {
    return this.#deps.repos.listSubscriptionsByAccount(
      this.#deps.db,
      actor.accountId,
    );
  }

  async find(actor: Actor, id: string): Promise<Subscription | null> {
    return (await this.list(actor)).find((s) => s.id === id) ?? null;
  }

  /** Adds a subscription, generating an id when none is given. */
  async create(
    actor: Actor,
    fields: Record<string, unknown>,
  ): Promise<Subscription> {
    const subscription = subscriptionSchema.parse({
      ...fields,
      id: fields.id ?? this.#deps.ids.uuid(),
    });
    validateReview(
      [{ ...subscription, operation: "add" }],
      await this.list(actor),
    );
    await this.#save(actor, subscription).run();
    return subscription;
  }

  /** Merges the changes into the stored subscription; the id cannot change. */
  async update(
    actor: Actor,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<Subscription> {
    const existing = await this.list(actor);
    const current = existing.find((s) => s.id === id);
    if (!current) throw new SubscriptionNotFoundError();
    const subscription = subscriptionSchema.parse({
      ...current,
      ...changes,
      id,
    });
    validateReview(
      [{ ...subscription, operation: "update", targetId: id }],
      existing,
    );
    await this.#save(actor, subscription).run();
    return subscription;
  }

  async remove(actor: Actor, id: string): Promise<void> {
    if (!(await this.find(actor, id))) throw new SubscriptionNotFoundError();
    await this.#deps.repos.deleteSubscription(
      this.#deps.db,
      actor.accountId,
      id,
    );
  }

  #save(actor: Actor, subscription: Subscription) {
    return this.#deps.repos.upsertSubscriptionStatement(this.#deps.db, {
      accountId: actor.accountId,
      subscription,
      duplicateKey: duplicateKey(subscription),
    });
  }
}
