import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { verifyAccess } from "../src/server/access";
import { ApiError } from "../src/server/api";
import {
  createBindingApiClient,
  type ServiceFetcher,
} from "../src/server/api/binding";
import { resolveConfig, type WebEnv } from "../src/server/config";
import { gate } from "../src/server/gate";

const team = "saldo-test.cloudflareaccess.com";
const audience = "synthetic-audience";
const access = { teamDomain: team, audience };

let keys: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

function token(
  claims: Record<string, unknown> = {},
  options: { aud?: string; iss?: string; exp?: string } = {},
) {
  return new SignJWT({
    type: "app",
    email: "owner@example.com",
    sub: "synthetic-owner-sub",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(options.iss ?? `https://${team}`)
    .setAudience(options.aud ?? audience)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "5m")
    .sign(privateKey);
}

const withAssertion = (assertion?: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (assertion) headers.set("Cf-Access-Jwt-Assertion", assertion);
  return new Request("https://saldo.example/", { ...init, headers });
};

describe("resolveConfig fails closed", () => {
  const complete: WebEnv = {
    API: { fetch: async () => new Response() },
    ACCESS_TEAM_DOMAIN: team,
    ACCESS_AUD: audience,
    APP_ORIGIN: "https://saldo.example",
  };
  it("requires the API binding and Access settings in production", () => {
    expect(resolveConfig(complete, { allowSynthetic: false }).ok).toBe(true);
    for (const missing of [
      "API",
      "ACCESS_TEAM_DOMAIN",
      "ACCESS_AUD",
      "APP_ORIGIN",
    ] as const)
      expect(
        resolveConfig(
          { ...complete, [missing]: undefined },
          { allowSynthetic: false },
        ).ok,
      ).toBe(false);
    expect(
      resolveConfig(
        { ...complete, ACCESS_TEAM_DOMAIN: "evil.example" },
        { allowSynthetic: false },
      ).ok,
    ).toBe(false);
  });
  it("only selects synthetic data when explicitly configured outside production", () => {
    expect(
      resolveConfig(
        { SALDO_DATA_SOURCE: "synthetic" },
        { allowSynthetic: false },
      ).ok,
    ).toBe(false);
    expect(
      resolveConfig(
        { ...complete, SALDO_DATA_SOURCE: "synthetic" },
        { allowSynthetic: false },
      ).ok,
    ).toBe(false);
    const dev = resolveConfig(
      { SALDO_DATA_SOURCE: "synthetic" },
      { allowSynthetic: true },
    );
    expect(dev.ok && dev.config.mode).toBe("synthetic");
    expect(resolveConfig({}, { allowSynthetic: true }).ok).toBe(false);
  });
});

describe("Access verification", () => {
  it("accepts a valid owner application token", async () => {
    const identity = await verifyAccess(
      withAssertion(await token()),
      access,
      keys,
    );
    expect(identity).toMatchObject({
      sub: "synthetic-owner-sub",
      email: "owner@example.com",
    });
  });
  it("rejects missing, foreign, expired, service and non-app tokens", async () => {
    const cases = [
      undefined,
      await token({}, { aud: "other" }),
      await token({}, { iss: "https://other.cloudflareaccess.com" }),
      await token({}, { exp: "-1m" }),
      await token({ type: "org" }),
      await token({ sub: "" }),
      "not-a-jwt",
    ];
    for (const assertion of cases)
      expect(
        await verifyAccess(withAssertion(assertion), access, keys),
      ).toBeNull();
  });
});

function recordingApi(
  respond: (request: Request) => Response | Promise<Response>,
) {
  const calls: Request[] = [];
  const api: ServiceFetcher = {
    fetch: async (request) => {
      calls.push(request);
      return respond(request);
    },
  };
  return { api, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const sample = {
  id: "syn-1",
  name: "Synthetic Music",
  amount: 5,
  currency: "USD",
  cadence: "monthly",
  renewalDate: null,
  status: "active",
  category: "Other",
  source: "Test",
  lastVerified: null,
  notes: "",
};

describe("service binding ApiClient", () => {
  const client = (api: ServiceFetcher) =>
    createBindingApiClient({
      api,
      assertion: "verified.jwt",
      origin: "https://saldo.example",
      requestId: "req-1",
    });

  it("forwards the assertion and request ID, never cookies, and sends Origin on writes", async () => {
    const { api, calls } = recordingApi((r) =>
      r.method === "GET"
        ? json({ subscriptions: [sample] })
        : json({ subscription: sample }, 201),
    );
    const c = client(api);
    expect(await c.listSubscriptions()).toEqual([sample]);
    const { id, ...input } = sample;
    expect(id).toBe("syn-1");
    await c.createSubscription(input as never);
    expect(calls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /api/subscriptions",
      "POST /api/subscriptions",
    ]);
    for (const r of calls) {
      expect(r.headers.get("Cf-Access-Jwt-Assertion")).toBe("verified.jwt");
      expect(r.headers.get("X-Request-Id")).toBe("req-1");
      expect(r.headers.get("Cookie")).toBeNull();
    }
    expect(calls[0].headers.get("Origin")).toBeNull();
    expect(calls[1].headers.get("Origin")).toBe("https://saldo.example");
    expect(await calls[1].json()).toEqual(input);
  });

  it("validates bodies and maps statuses to safe errors", async () => {
    const reply = (body: unknown, status: number) =>
      client(recordingApi(() => json(body, status)).api);
    await expect(
      reply({ subscriptions: [{ nope: 1 }] }, 200).listSubscriptions(),
    ).rejects.toMatchObject({ code: "bad_response" });
    await expect(reply({ error: "x" }, 401).status()).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      reply(
        {
          error:
            "Possible duplicate: Synthetic Music. Review as an update instead.",
        },
        400,
      ).saveReview({ requestId: crypto.randomUUID(), proposals: [] }),
    ).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("Possible duplicate"),
    });
    await expect(
      reply({ error: "internal detail" }, 503).chat({
        message: "hi",
        attachments: [],
        history: [],
      }),
    ).rejects.toMatchObject({ code: "ai_unavailable" });
    await expect(
      reply({ error: "slow down" }, 429).chat({
        message: "hi",
        attachments: [],
        history: [],
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    const failing = client({
      fetch: async () => {
        throw new TypeError("network");
      },
    });
    await expect(failing.listSubscriptions()).rejects.toBeInstanceOf(ApiError);
  });

  it("reads GET /api/me and rejects other shapes", async () => {
    const user = {
      id: "6f1c2b8e-0000-4000-8000-000000000001",
      email: "owner@example.com",
      displayName: null,
      role: "owner",
    };
    const ok = client(recordingApi(() => json({ user })).api);
    expect(await ok.me()).toEqual(user);
    const bare = client(recordingApi(() => json(user)).api);
    await expect(bare.me()).rejects.toMatchObject({ code: "bad_response" });
    const disabled = client(
      recordingApi(() =>
        json({ error: "This Saldo instance is private." }, 403),
      ).api,
    );
    await expect(disabled.me()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("signs out with POST /api/session/sign-out and checks the answer", async () => {
    const { api, calls } = recordingApi(() => json({ signedOut: true }));
    await client(api).signOut();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(new URL(calls[0].url).pathname).toBe("/api/session/sign-out");
    expect(calls[0].headers.get("Origin")).toBe("https://saldo.example");
    expect(calls[0].headers.get("Cf-Access-Jwt-Assertion")).toBe(
      "verified.jwt",
    );
    await expect(
      client(recordingApi(() => json({ ok: true })).api).signOut(),
    ).rejects.toMatchObject({ code: "bad_response" });
    await expect(
      client(recordingApi(() => json({ error: "x" }, 401)).api).signOut(),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("request gate", () => {
  const owner = {
    id: "6f1c2b8e-0000-4000-8000-000000000001",
    email: "owner@example.com",
    displayName: null,
    role: "owner",
  };

  function productionEnv(
    session: () => Response = () => json({ user: owner }),
  ) {
    const { api, calls } = recordingApi((r) => {
      const path = new URL(r.url).pathname;
      if (path === "/api/me") return session();
      if (path === "/api/session/sign-out") return json({ signedOut: true });
      return path === "/api/subscriptions"
        ? json({ subscriptions: [sample] })
        : json({ reply: "ok", proposals: [] });
    });
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("asset", {
            headers: { "Content-Type": "text/javascript" },
          }),
      ),
    };
    const env: WebEnv = {
      API: api,
      ASSETS: assets,
      ACCESS_TEAM_DOMAIN: team,
      ACCESS_AUD: audience,
      APP_ORIGIN: "https://saldo.example",
    };
    return { env, calls, assets };
  }

  it("answers without a valid JWT with a static 401 and never calls the API or assets", async () => {
    const { env, calls, assets } = productionEnv();
    for (const path of [
      "/",
      "/assets/index.js",
      "/chat/messages",
      "/settings/export.csv",
    ]) {
      const result = await gate(
        new Request(`https://saldo.example${path}`),
        env,
        { allowSynthetic: false },
      );
      expect(result.kind).toBe("response");
      if (result.kind !== "response") continue;
      expect(result.response.status).toBe(401);
      const html = await result.response.text();
      expect(html).not.toContain("Synthetic Music");
    }
    expect(calls).toHaveLength(0);
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the binding is missing", async () => {
    const { env } = productionEnv();
    const result = await gate(
      new Request("https://saldo.example/"),
      { ...env, API: undefined },
      { allowSynthetic: false },
    );
    expect(result.kind === "response" && result.response.status).toBe(503);
  });

  it("serves assets and route handlers only after verification, forwarding the same assertion", async () => {
    const { env, calls, assets } = productionEnv();
    const assertion = await token();
    const options = { allowSynthetic: false, accessKeys: keys };
    const asset = await gate(
      new Request("https://saldo.example/assets/index.js", {
        headers: { "Cf-Access-Jwt-Assertion": assertion },
      }),
      env,
      options,
    );
    expect(
      asset.kind === "response" && asset.response.headers.get("Cache-Control"),
    ).toContain("immutable");
    expect(assets.fetch).toHaveBeenCalledOnce();

    const exported = await gate(
      new Request("https://saldo.example/settings/export.csv", {
        headers: {
          "Cf-Access-Jwt-Assertion": assertion,
          Cookie: "CF_Authorization=secret",
        },
      }),
      env,
      options,
    );
    expect(
      exported.kind === "response" && (await exported.response.text()),
    ).toContain("Synthetic Music");
    expect(calls.at(-1)?.headers.get("Cf-Access-Jwt-Assertion")).toBe(
      assertion,
    );
    expect(calls.at(-1)?.headers.get("Cookie")).toBeNull();

    const chatBody = JSON.stringify({
      message: "Synthetic",
      attachments: [],
      history: [],
    });
    const foreign = await gate(
      new Request("https://saldo.example/chat/messages", {
        method: "POST",
        body: chatBody,
        headers: {
          "Cf-Access-Jwt-Assertion": assertion,
          Origin: "https://evil.example",
          "Content-Type": "application/json",
          "Content-Length": String(chatBody.length),
        },
      }),
      env,
      options,
    );
    expect(foreign.kind === "response" && foreign.response.status).toBe(403);
    const callsBefore = calls.length;
    const chat = await gate(
      new Request("https://saldo.example/chat/messages", {
        method: "POST",
        body: chatBody,
        headers: {
          "Cf-Access-Jwt-Assertion": assertion,
          Origin: "https://saldo.example",
          "Content-Type": "application/json",
          "Content-Length": String(chatBody.length),
        },
      }),
      env,
      options,
    );
    expect(chat.kind === "response" && (await chat.response.json())).toEqual({
      reply: "ok",
      proposals: [],
    });
    expect(calls).toHaveLength(callsBefore + 1);
    expect(new URL(calls.at(-1)!.url).pathname).toBe("/api/chat");

    const page = await gate(
      new Request("https://saldo.example/subscriptions", {
        headers: { "Cf-Access-Jwt-Assertion": assertion },
      }),
      env,
      options,
    );
    expect(page.kind).toBe("render");
    expect(page.kind === "render" && page.context.dataSource).toBe("api");
  });
});

describe("ended or refused sessions", () => {
  const options = () => ({ allowSynthetic: false, accessKeys: keys });
  function envWith(session: () => Response) {
    const { api, calls } = recordingApi((r) =>
      new URL(r.url).pathname === "/api/me"
        ? session()
        : json({ subscriptions: [sample] }),
    );
    const env: WebEnv = {
      API: api,
      ACCESS_TEAM_DOMAIN: team,
      ACCESS_AUD: audience,
      APP_ORIGIN: "https://saldo.example",
    };
    return { env, calls };
  }
  const requests = async () => {
    const assertion = await token();
    const headers = { "Cf-Access-Jwt-Assertion": assertion };
    return [
      new Request("https://saldo.example/subscriptions", { headers }),
      new Request("https://saldo.example/subscriptions_.rsc", {
        headers: { ...headers, "X-Requested-With": "XMLHttpRequest" },
      }),
      new Request("https://saldo.example/settings_.rsc", {
        method: "POST",
        body: "[]",
        headers: {
          ...headers,
          Origin: "https://saldo.example",
          "x-rsc-action": "synthetic#saveSubscription",
          "Content-Length": "2",
        },
      }),
    ];
  };

  it("answers a session the API ended with one static 401 page, before any render or action", async () => {
    const { env, calls } = envWith(() =>
      json(
        {
          error:
            "Private Saldo instance. Configure Cloudflare Access and sign in as the owner.",
        },
        401,
      ),
    );
    for (const request of await requests()) {
      const result = await gate(request, env, options());
      expect(result.kind).toBe("response");
      if (result.kind !== "response") continue;
      expect(result.response.status).toBe(401);
      expect(result.response.headers.get("Cache-Control")).toBe(
        "private, no-store",
      );
      const html = await result.response.text();
      expect(html).toContain("Your Saldo session has ended.");
      expect(html).toContain('href="/cdn-cgi/access/logout"');
      expect(html).not.toContain("Synthetic Music");
    }
    expect(calls.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/me",
      "/api/me",
      "/api/me",
    ]);
  });

  it("answers a refused (disabled) user with a static 403 page that offers no reload loop", async () => {
    const { env, calls } = envWith(() =>
      json({ error: "This Saldo instance is private." }, 403),
    );
    const [page] = await requests();
    const result = await gate(page, env, options());
    expect(result.kind === "response" && result.response.status).toBe(403);
    const html = result.kind === "response" ? await result.response.text() : "";
    expect(html).toContain("This account can’t open this Saldo workspace.");
    expect(html).not.toContain('href="/"');
    expect(calls).toHaveLength(1);
  });

  it("still renders when the API is only unavailable, so pages show their own errors", async () => {
    const { env } = envWith(() => json({ error: "down" }, 503));
    const [page] = await requests();
    const result = await gate(page, env, options());
    expect(result.kind).toBe("render");
  });

  it("maps an ended session on /chat/messages to 401 JSON", async () => {
    const { api } = recordingApi(() => json({ error: "x" }, 401));
    const body = JSON.stringify({
      message: "Hi",
      attachments: [],
      history: [],
    });
    const result = await gate(
      new Request("https://saldo.example/chat/messages", {
        method: "POST",
        body,
        headers: {
          "Cf-Access-Jwt-Assertion": await token(),
          Origin: "https://saldo.example",
          "Content-Type": "application/json",
          "Content-Length": String(body.length),
        },
      }),
      {
        API: api,
        ACCESS_TEAM_DOMAIN: team,
        ACCESS_AUD: audience,
        APP_ORIGIN: "https://saldo.example",
      },
      options(),
    );
    expect(result.kind === "response" && result.response.status).toBe(401);
    expect(
      result.kind === "response" && (await result.response.json()),
    ).toMatchObject({ code: "unauthenticated" });
  });
});

describe("POST /session/sign-out", () => {
  const options = () => ({ allowSynthetic: false, accessKeys: keys });
  function envWith(signOut: () => Response) {
    const { api, calls } = recordingApi(() => signOut());
    const env: WebEnv = {
      API: api,
      ACCESS_TEAM_DOMAIN: team,
      ACCESS_AUD: audience,
      APP_ORIGIN: "https://saldo.example",
    };
    return { env, calls };
  }
  const signOutRequest = async ({
    method = "POST",
    origin = "https://saldo.example",
  } = {}) =>
    new Request("https://saldo.example/session/sign-out", {
      method,
      headers: {
        "Cf-Access-Jwt-Assertion": await token(),
        Origin: origin,
      },
    });

  it("ends the Saldo session through the API with the verified assertion", async () => {
    const { env, calls } = envWith(() => json({ signedOut: true }));
    const result = await gate(await signOutRequest(), env, options());
    expect(result.kind === "response" && result.response.status).toBe(200);
    expect(
      result.kind === "response" && (await result.response.json()),
    ).toEqual({ signedOut: true });
    expect(calls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /api/session/sign-out",
    ]);
    expect(calls[0].headers.get("Origin")).toBe("https://saldo.example");
    expect(calls[0].headers.get("Cookie")).toBeNull();
  });

  it("refuses other origins and methods without calling the API", async () => {
    const { env, calls } = envWith(() => json({ signedOut: true }));
    const foreign = await gate(
      await signOutRequest({ origin: "https://evil.example" }),
      env,
      options(),
    );
    expect(foreign.kind === "response" && foreign.response.status).toBe(403);
    const get = await gate(
      await signOutRequest({ method: "GET" }),
      env,
      options(),
    );
    expect(get.kind === "response" && get.response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("reports an already ended session so the browser still continues to the Access logout", async () => {
    const { env } = envWith(() => json({ error: "x" }, 401));
    const result = await gate(await signOutRequest(), env, options());
    expect(result.kind === "response" && result.response.status).toBe(401);
    expect(
      result.kind === "response" && (await result.response.json()),
    ).toEqual({ signedOut: true, code: "unauthenticated" });
  });

  it("needs a verified Access token", async () => {
    const { env, calls } = envWith(() => json({ signedOut: true }));
    const result = await gate(
      new Request("https://saldo.example/session/sign-out", {
        method: "POST",
        headers: { Origin: "https://saldo.example" },
      }),
      env,
      options(),
    );
    expect(result.kind === "response" && result.response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("synthetic development sessions", () => {
  it("shows the signed-out page for the Access logout and the signed-out scenario", async () => {
    const logout = await gate(
      new Request("http://127.0.0.1:5173/cdn-cgi/access/logout"),
      { SALDO_DATA_SOURCE: "synthetic" },
      { allowSynthetic: true },
    );
    expect(logout.kind === "response" && logout.response.status).toBe(401);
    // The synthetic client is created once per process; this is its first use
    // in this file.
    const ended = await gate(
      new Request("http://127.0.0.1:5173/subscriptions"),
      {
        SALDO_DATA_SOURCE: "synthetic",
        SALDO_SYNTHETIC_SCENARIO: "signed-out",
      },
      { allowSynthetic: true },
    );
    expect(ended.kind === "response" && ended.response.status).toBe(401);
    expect(
      ended.kind === "response" && (await ended.response.text()),
    ).toContain("Your Saldo session has ended.");
  });
});
