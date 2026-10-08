// HTTP handlers against fake services: routing, guards, input handling and
// the error mapping. No storage, Access keys or bindings are involved.
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "../../src/http/app";
import type { RequestScope } from "../../src/http/context";
import type { Services } from "../../src/services";
import {
  AccessDeniedError,
  AiNotConnectedError,
  AiRequestFailedError,
  SessionEndedError,
  SubscriptionNotFoundError,
} from "../../src/services/errors";
import type { Principal } from "../../src/services/identity-service";
import { ownerActor } from "../support/fakes";
import { synthetic } from "../support/fixtures";

const origin = "https://saldo.test";
const principal: Principal = {
  issuer: "https://example.cloudflareaccess.com",
  subject: "owner-subject",
  issuedAt: 1_800_000_000,
  email: "owner@example.test",
  name: null,
};

function fakeServices() {
  return {
    identity: {
      authenticate: vi.fn(async (token: string | null) =>
        token === "owner-token" ? principal : null,
      ),
      resolveActor: vi.fn(async () => ownerActor),
      describe: vi.fn(() => ({
        id: ownerActor.userId,
        email: ownerActor.email,
        displayName: ownerActor.displayName,
        role: ownerActor.role,
      })),
    },
    subscriptions: {
      list: vi.fn(async () => [synthetic.streaming]),
      find: vi.fn(async (_actor: unknown, id: string) =>
        id === "streaming" ? synthetic.streaming : null,
      ),
      create: vi.fn(
        async (_actor: unknown, fields: Record<string, unknown>) => ({
          ...synthetic.music,
          ...fields,
        }),
      ),
      update: vi.fn(async () => ({ ...synthetic.streaming, amount: 1 })),
      remove: vi.fn(async () => undefined),
    },
    reviews: {
      apply: vi.fn(async () => ({ subscriptions: [synthetic.streaming] })),
    },
    chat: {
      status: vi.fn(async () => ({ connected: true })),
      send: vi.fn(async () => ({ reply: "Hi", proposals: [] })),
    },
  };
}

let services: ReturnType<typeof fakeServices>;
let assets: { fetch: ReturnType<typeof vi.fn> };
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  services = fakeServices();
  assets = { fetch: vi.fn(async () => new Response("asset")) };
  const scope = {
    services: services as unknown as Services,
    appOrigin: origin,
    assets,
  } as RequestScope;
  app = createApp(() => scope);
});

function request(
  path: string,
  init: RequestInit & { token?: string | null; json?: unknown } = {},
) {
  const { token = "owner-token", json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (!["GET", "HEAD", "OPTIONS", undefined].includes(rest.method))
    headers.set("Origin", origin);
  return app.fetch(
    new Request(`${origin}${path}`, {
      ...rest,
      headers,
      body: json === undefined ? rest.body : JSON.stringify(json),
    }),
  );
}

const read = async (response: Response) => [
  response.status,
  await response.json(),
];

describe("guards", () => {
  it("checks the token before anything else and never reads the body of an unauthenticated request", async () => {
    const body = new ReadableStream({
      pull: () => {
        throw new Error("body was read");
      },
    });
    const response = await request("/api/subscriptions", {
      method: "POST",
      token: null,
      body,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(401);
    expect(services.identity.resolveActor).not.toHaveBeenCalled();
    expect(services.subscriptions.create).not.toHaveBeenCalled();
  });

  it("serves assets to the owner without touching account data", async () => {
    expect(await (await request("/")).text()).toBe("asset");
    expect(services.identity.resolveActor).not.toHaveBeenCalled();
    expect((await request("/", { token: null })).status).toBe(401);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it("maps identity outcomes to 401 and 403", async () => {
    services.identity.resolveActor.mockRejectedValueOnce(
      new SessionEndedError(),
    );
    expect((await request("/api/me")).status).toBe(401);
    services.identity.resolveActor.mockRejectedValueOnce(
      new AccessDeniedError(),
    );
    expect(await read(await request("/api/me"))).toEqual([
      403,
      { error: "This Saldo instance is private." },
    ]);
  });

  it("checks the Origin of state changes before authentication", async () => {
    const response = await app.fetch(
      new Request(`${origin}/api/review`, {
        method: "POST",
        headers: { Origin: "https://evil.test" },
      }),
    );
    expect(await read(response)).toEqual([
      403,
      { error: "Origin not allowed" },
    ]);
    expect(services.identity.authenticate).not.toHaveBeenCalled();
  });
});

describe("routes", () => {
  it("GET /api/me returns the signed-in user", async () => {
    expect(await read(await request("/api/me"))).toEqual([
      200,
      {
        user: {
          id: "user-owner",
          email: "owner@example.test",
          displayName: "Synthetic Owner",
          role: "owner",
        },
      },
    ]);
    expect(services.identity.describe).toHaveBeenCalledWith(ownerActor);
    expect((await request("/api/me", { method: "HEAD" })).status).toBe(404);
    expect((await request("/api/me", { method: "POST" })).status).toBe(404);
  });

  it("GET /api/status asks the AI provider only for the owner", async () => {
    expect(await read(await request("/api/status", { token: null }))).toEqual([
      200,
      { authenticated: false, aiConnected: false },
    ]);
    expect(services.chat.status).not.toHaveBeenCalled();
    expect(await read(await request("/api/status"))).toEqual([
      200,
      { authenticated: true, aiConnected: true },
    ]);
    expect(services.identity.resolveActor).not.toHaveBeenCalled();
  });

  it("passes the actor and object fields to subscription services", async () => {
    expect(
      await read(
        await request("/api/subscriptions", {
          method: "POST",
          json: { name: "Example Music" },
        }),
      ),
    ).toEqual([201, { subscription: synthetic.music }]);
    expect(services.subscriptions.create).toHaveBeenCalledWith(ownerActor, {
      name: "Example Music",
    });
    await request("/api/subscriptions", { method: "POST", json: [1] });
    await request("/api/subscriptions", { method: "POST", json: "text" });
    expect(services.subscriptions.create.mock.calls.slice(1)).toEqual([
      [ownerActor, [1]],
      [ownerActor, {}],
    ]);
  });

  it("decodes the id from the path", async () => {
    await request("/api/subscriptions/a%2Fb%20c", { method: "DELETE" });
    expect(services.subscriptions.remove).toHaveBeenCalledWith(
      ownerActor,
      "a/b c",
    );
  });

  it("PATCH answers 404 for an unknown id without reading the body", async () => {
    expect(
      await read(
        await request("/api/subscriptions/missing", {
          method: "PATCH",
          body: "{not json",
        }),
      ),
    ).toEqual([404, { error: "Subscription not found" }]);
    expect(services.subscriptions.update).not.toHaveBeenCalled();
    expect(
      await read(
        await request("/api/subscriptions/streaming", {
          method: "PATCH",
          json: { amount: 1 },
        }),
      ),
    ).toEqual([200, { subscription: { ...synthetic.streaming, amount: 1 } }]);
    expect(services.subscriptions.update).toHaveBeenCalledWith(
      ownerActor,
      "streaming",
      { amount: 1 },
    );
  });

  it("validates review and chat input before calling services", async () => {
    expect(
      (await request("/api/review", { method: "POST", json: {} })).status,
    ).toBe(400);
    expect(services.reviews.apply).not.toHaveBeenCalled();
    expect(
      (await request("/api/chat", { method: "POST", json: { message: "" } }))
        .status,
    ).toBe(400);
    expect(services.chat.send).not.toHaveBeenCalled();
    await request("/api/chat", { method: "POST", json: { message: "hi" } });
    expect(services.chat.send).toHaveBeenCalledWith(
      ownerActor,
      { message: "hi", attachments: [], history: [] },
      expect.any(AbortSignal),
    );
  });
});

describe("error mapping", () => {
  const cases: [Error, number, string][] = [
    [new SubscriptionNotFoundError(), 404, "Subscription not found"],
    [
      new AiNotConnectedError(),
      503,
      "ChatGPT is not connected. Your message and screenshots have not been sent to an AI provider.",
    ],
    [
      new AiRequestFailedError(true),
      429,
      "ChatGPT could not complete this request. Nothing was saved. Check your private connection and try again.",
    ],
    [
      new AiRequestFailedError(false),
      503,
      "ChatGPT could not complete this request. Nothing was saved. Check your private connection and try again.",
    ],
    [
      new Error("Possible duplicate: X. Review as an update instead."),
      400,
      "Possible duplicate: X. Review as an update instead.",
    ],
    [new Error("Update target not found"), 400, "Update target not found"],
    [
      new Error("D1_ERROR: no such table: secrets"),
      400,
      "Invalid data or unavailable storage. No unreviewed changes were saved.",
    ],
  ];
  it.each(cases)("maps %s", async (error, status, message) => {
    services.chat.send.mockRejectedValueOnce(error);
    const response = await request("/api/chat", {
      method: "POST",
      json: { message: "hi" },
    });
    expect(await read(response)).toEqual([status, { error: message }]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
