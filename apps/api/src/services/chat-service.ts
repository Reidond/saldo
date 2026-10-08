import type { Proposal } from "@saldo/domain";
import type { Repositories } from "../repositories";
import { AiNotConnectedError } from "./errors";
import type { Actor } from "./identity-service";
import type { AiProvider, ChatInput, Database } from "./ports";

const defaultReply = "Review these proposed changes before saving.";

export interface ChatReply {
  reply: string;
  /** Unsaved; the owner reviews them through ReviewService. */
  proposals: Proposal[];
}

export interface ChatServiceDeps {
  db: Database;
  repos: Pick<Repositories, "listSubscriptionsByAccount">;
  ai: AiProvider;
}

/** AI extraction of subscription proposals from chat messages. */
export class ChatService {
  readonly #deps: ChatServiceDeps;

  constructor(deps: ChatServiceDeps) {
    this.#deps = deps;
  }

  status(): Promise<{ connected: boolean }> {
    return this.#deps.ai.status();
  }

  /**
   * Sends the message with the current ledger as context. Nothing is sent
   * when no provider is configured, and nothing is ever saved here.
   */
  async send(
    actor: Actor,
    input: ChatInput,
    signal: AbortSignal,
  ): Promise<ChatReply> {
    const { db, repos, ai } = this.#deps;
    if (!ai.enabled) throw new AiNotConnectedError();
    const subscriptions = await repos.listSubscriptionsByAccount(
      db,
      actor.accountId,
    );
    const result = await ai.extract({ ...input, subscriptions }, signal);
    return { reply: result.reply ?? defaultReply, proposals: result.proposals };
  }
}
