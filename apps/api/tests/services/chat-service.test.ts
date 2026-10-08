import { beforeEach, describe, expect, it } from "vite-plus/test";
import { disabledAiProvider } from "../../src/infrastructure/ai/disabled-provider";
import { ChatService } from "../../src/services/chat-service";
import {
  AiNotConnectedError,
  AiRequestFailedError,
} from "../../src/services/errors";
import type { Repositories } from "../../src/repositories";
import {
  fakeAiProvider,
  FakeDatabase,
  fakeRepositories,
  ownerActor,
} from "../support/fakes";
import { synthetic } from "../support/fixtures";

const input = { message: "I pay 4.50 for music", attachments: [], history: [] };
const proposal = { ...synthetic.music, operation: "add" as const };

let db: FakeDatabase;
let repos: Repositories;

beforeEach(async () => {
  db = new FakeDatabase();
  repos = fakeRepositories(db);
  await repos
    .upsertSubscriptionStatement(db.d1, {
      accountId: ownerActor.accountId,
      subscription: synthetic.streaming,
      duplicateKey: "examplestreaming|USD",
    })
    .run();
});

describe("ChatService", () => {
  it("refuses before reading the ledger when no AI provider is configured", async () => {
    let reads = 0;
    const chat = new ChatService({
      db: db.d1,
      repos: {
        listSubscriptionsByAccount: async (...args) => {
          reads++;
          return repos.listSubscriptionsByAccount(...args);
        },
      },
      ai: disabledAiProvider,
    });
    await expect(
      chat.send(ownerActor, input, new AbortController().signal),
    ).rejects.toBeInstanceOf(AiNotConnectedError);
    expect(reads).toBe(0);
    expect(await chat.status()).toEqual({ connected: false });
  });

  it("sends the message with the actor's ledger and returns unsaved proposals", async () => {
    const ai = fakeAiProvider({ reply: "Found one.", proposals: [proposal] });
    const chat = new ChatService({ db: db.d1, repos, ai });
    const signal = new AbortController().signal;
    expect(await chat.send(ownerActor, input, signal)).toEqual({
      reply: "Found one.",
      proposals: [proposal],
    });
    expect(ai.inputs).toEqual([
      { ...input, subscriptions: [synthetic.streaming] },
    ]);
    expect(ai.signals).toEqual([signal]);
    expect(db.subscriptionsOf(ownerActor.accountId)).toEqual([
      synthetic.streaming,
    ]);
  });

  it("explains proposals when the provider gives no reply", async () => {
    const chat = new ChatService({
      db: db.d1,
      repos,
      ai: fakeAiProvider({ reply: null, proposals: [] }),
    });
    expect(
      (await chat.send(ownerActor, input, new AbortController().signal)).reply,
    ).toBe("Review these proposed changes before saving.");
  });

  it("passes provider failures through", async () => {
    const chat = new ChatService({
      db: db.d1,
      repos,
      ai: fakeAiProvider(() => {
        throw new AiRequestFailedError(true);
      }),
    });
    await expect(
      chat.send(ownerActor, input, new AbortController().signal),
    ).rejects.toMatchObject({ rateLimited: true });
  });
});
