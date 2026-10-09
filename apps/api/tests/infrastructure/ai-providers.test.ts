import { describe, expect, it } from "vite-plus/test";
import { createBridgeAiProvider } from "../../src/infrastructure/ai/bridge-provider";
import { disabledAiProvider } from "../../src/infrastructure/ai/disabled-provider";
import { AiNotConnectedError } from "../../src/services/errors";

const input = {
  message: "hello",
  attachments: [],
  history: [],
  subscriptions: [],
};

const bridge = (respond: (request: Request) => Response) => {
  const requests: Request[] = [];
  return {
    requests,
    fetch: async (info: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(info, init);
      requests.push(request);
      return respond(request);
    },
  } as Pick<Fetcher, "fetch"> & { requests: Request[] };
};

describe("bridge AI provider", () => {
  it("reports connected only for an explicit true", async () => {
    for (const [body, connected] of [
      [{ connected: true }, true],
      [{ connected: "yes" }, false],
      [null, false],
    ] as const)
      expect(
        await createBridgeAiProvider(
          bridge(() => Response.json(body)),
          "s",
        ).status(),
      ).toEqual({ connected });
  });

  it("aborts with the caller's signal", async () => {
    const fake = bridge(() => Response.json({}));
    const controller = new AbortController();
    await createBridgeAiProvider(fake, "s").extract(input, controller.signal);
    controller.abort();
    expect(fake.requests[0].signal.aborted).toBe(true);
  });

  it("flags rate limiting and rejects malformed proposals", async () => {
    await expect(
      createBridgeAiProvider(
        bridge(() => new Response(null, { status: 429 })),
        "s",
      ).extract(input, new AbortController().signal),
    ).rejects.toMatchObject({ rateLimited: true });
    await expect(
      createBridgeAiProvider(
        bridge(() => Response.json({ proposals: [{ name: "x" }] })),
        "s",
      ).extract(input, new AbortController().signal),
    ).rejects.toThrow();
  });
});

describe("disabled AI provider", () => {
  it("is never connected and refuses requests", async () => {
    expect(disabledAiProvider.enabled).toBe(false);
    expect(await disabledAiProvider.status()).toEqual({ connected: false });
    await expect(
      disabledAiProvider.extract(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(AiNotConnectedError);
  });
});
