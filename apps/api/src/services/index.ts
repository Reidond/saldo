import type { Repositories } from "../repositories";
import { ChatService } from "./chat-service";
import { IdentityService, type IdentityConfig } from "./identity-service";
import type {
  AccessTokenVerifier,
  AiProvider,
  Clock,
  Database,
  IdGenerator,
} from "./ports";
import { ReviewService } from "./review-service";
import { SubscriptionService } from "./subscription-service";

export interface Services {
  identity: IdentityService;
  subscriptions: SubscriptionService;
  reviews: ReviewService;
  chat: ChatService;
}

export interface ServiceDependencies {
  db: Database;
  repos: Repositories;
  verifier: AccessTokenVerifier;
  ai: AiProvider;
  clock: Clock;
  ids: IdGenerator;
  identity: IdentityConfig;
}

export function createServices(deps: ServiceDependencies): Services {
  const { db, repos, verifier, ai, clock, ids, identity } = deps;
  return {
    identity: new IdentityService({
      db,
      repos,
      verifier,
      clock,
      ids,
      config: identity,
    }),
    subscriptions: new SubscriptionService({ db, repos, ids }),
    reviews: new ReviewService({ db, repos }),
    chat: new ChatService({ db, repos, ai }),
  };
}
