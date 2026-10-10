// End-to-end HTTP contract of the API Worker: real local D1, synthetic Access
// keys and a fake AI binding. The web client depends on every
// status code, message and header asserted here; change them deliberately.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import worker, { type Env } from "../src/worker";
import {
  accessSettings,
  createAccessKeys,
  serveAccessCerts,
  type AccessKeys,
} from "./support/access";
import { startLocalD1, type LocalD1 } from "./support/d1";

const origin = "https://saldo.test";
const privateMessage =
  "Private Saldo instance. Configure Cloudflare Access and sign in as the owner.";
const genericMessage =
  "Invalid data or unavailable storage. No unreviewed changes were saved.";
const streaming = {
  name: "Example Streaming",
  amount: 9.99,
  currency: "USD",
  cadence: "monthly",
  renewalDate: "2026-11-01",
  status: "active",
  category: "Entertainment",
  source: "manual entry",
  lastVerified: null,
};
const music = { ...streaming, name: "Example Music", amount: 4.5 };

let d1: LocalD1;
let keys: AccessKeys;
let owner: string;
let bridge: ReturnType<typeof fakeFetcher>;

function fakeFetcher(
  handler: (request: Request) => Response | Promise<Response>,
) {
  const calls: Request[] = [];
  return {
    calls,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      calls.push(request.clone() as Request);
      return handler(request);
    }),
  };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: d1.db,
    FILES: {} as R2Bucket,
    APP_ORIGIN: origin,
    ACCESS_TEAM_DOMAIN: accessSettings.teamDomain,
    ACCESS_AUD: accessSettings.audience,
    OWNER_SUB: accessSettings.ownerSubject,
    ...overrides,
  };
}

const withAi = () =>
  env({
    AI: bridge as unknown as Fetcher,
    AI_BRIDGE_SECRET: "synthetic-bridge-secret",
  });

interface Call extends RequestInit {
  token?: string | null;
  json?: unknown;
  env?: Env;
}

async function call(path: string, options: Call = {}) {
  const { token = owner, json, env: bindings = env(), ...init } = options;
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("Origin"))
    headers.set("Origin", origin);
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(json);
  }
  return worker.fetch(
    new Request(`${origin}${path}`, { ...init, method, headers }),
    bindings,
  );
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function expectJsonHeaders(response: Response) {
  expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

async function create(subscription: Record<string, unknown> = streaming) {
  const response = await call("/api/subscriptions", {
    method: "POST",
    json: subscription,
  });
  expect(response.status).toBe(201);
  return (await body(response)).subscription as Record<string, unknown>;
}

async function stored() {
  const { results } = await d1.db
    .prepare("SELECT account_id, id, data FROM subscriptions ORDER BY id")
    .all<{ account_id: string; id: string; data: string }>();
  return results.map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

beforeAll(async () => {
  d1 = await startLocalD1();
  keys = await createAccessKeys();
  serveAccessCerts(keys.jwks);
  owner = await keys.sign({ email: "owner@example.test" });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await d1?.dispose();
});
beforeEach(async () => {
  await d1.reset();
  bridge = fakeFetcher(() => Response.json({ connected: true }));
});
afterEach(() => vi.clearAllMocks());

describe("cross-origin protection", () => {
  it("rejects state changes from another origin before authentication", async () => {
    for (const [method, path] of [
      ["POST", "/api/review"],
      ["POST", "/api/status"],
      ["PATCH", "/api/subscriptions/x"],
      ["DELETE", "/"],
    ]) {
      for (const headers of [{ Origin: "https://evil.test" }, undefined]) {
        const response = await worker.fetch(
          new Request(`${origin}${path}`, { method, headers }),
          env(),
        );
        expect(response.status).toBe(403);
        expectJsonHeaders(response);
        expect(await body(response)).toEqual({ error: "Origin not allowed" });
      }
    }
  });

  it("lets safe methods through without an Origin header", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"])
      expect((await call("/api/status", { method, token: null })).status).toBe(
        200,
      );
  });
});

describe("GET /api/status", () => {
  it("is honest when signed out and never calls the AI bridge", async () => {
    const response = await call("/api/status", {
      token: null,
      env: withAi(),
    });
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({
      authenticated: false,
      aiConnected: false,
    });
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it("reports the owner without an AI binding as not connected", async () =>
    expect(await body(await call("/api/status"))).toEqual({
      authenticated: true,
      aiConnected: false,
    }));

  it("asks the private bridge whether ChatGPT is connected", async () => {
    expect(await body(await call("/api/status", { env: withAi() }))).toEqual({
      authenticated: true,
      aiConnected: true,
    });
    const [request] = bridge.calls;
    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://bridge/status");
    expect(request.headers.get("Authorization")).toBe(
      "Bearer synthetic-bridge-secret",
    );
  });

  it("treats bridge errors as not connected", async () => {
    for (const failure of [
      () => new Response("down", { status: 502 }),
      () => Promise.reject(new Error("network")),
    ]) {
      bridge = fakeFetcher(failure);
      expect(await body(await call("/api/status", { env: withAi() }))).toEqual({
        authenticated: true,
        aiConnected: false,
      });
    }
  });

  it("answers any method on the exact path", async () =>
    expect(
      await body(await call("/api/status", { method: "POST", token: null })),
    ).toEqual({ authenticated: false, aiConnected: false }));
});

describe("owner authentication", () => {
  it("fails closed for every path without a valid owner token", async () => {
    const tokens = [
      null,
      "forged",
      await keys.sign({ sub: "someone-else" }),
      await keys.sign({ aud: "another-app" }),
      await keys.sign({ iss: "https://evil.cloudflareaccess.com" }),
      await keys.sign({ exp: Math.floor(Date.now() / 1000) - 60 }),
      await (await createAccessKeys()).sign(),
    ];
    for (const token of tokens)
      for (const path of [
        "/",
        "/index.html",
        "/api/subscriptions",
        "/api/chat",
        "/api/unknown",
      ]) {
        const response = await call(path, {
          token,
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.test",
          },
        });
        expect(response.status).toBe(401);
        expectJsonHeaders(response);
        expect(await body(response)).toEqual({ error: privateMessage });
      }
    expect(await stored()).toEqual([]);
  });

  it("fails closed when Access is not configured", async () => {
    for (const missing of [
      { ACCESS_TEAM_DOMAIN: undefined },
      { ACCESS_AUD: undefined },
      { OWNER_SUB: undefined },
      { ACCESS_TEAM_DOMAIN: "example.com" },
    ]) {
      const response = await call("/api/subscriptions", {
        env: env(missing),
      });
      expect(response.status).toBe(401);
    }
  });
});

describe("no pages or static assets", () => {
  it("answers 404 to the owner for every path outside /api/", async () => {
    for (const path of ["/", "/settings?tab=ai", "/index.html", "/api"]) {
      const response = await call(path);
      expect(response.status).toBe(404);
      expectJsonHeaders(response);
      expect(await body(response)).toEqual({ error: "Not found" });
    }
  });
});

describe("subscriptions", () => {
  it("lists nothing for a new owner", async () => {
    const response = await call("/api/subscriptions");
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({ subscriptions: [] });
  });

  it("creates with a generated id and stores it under the owner's account", async () => {
    const subscription = await create();
    expect(subscription).toEqual({
      ...streaming,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      notes: "",
    });
    expect(await stored()).toEqual([
      {
        account_id: accessSettings.ownerSubject,
        id: subscription.id,
        data: subscription,
      },
    ]);
    expect(await body(await call("/api/subscriptions"))).toEqual({
      subscriptions: [subscription],
    });
  });

  it("keeps a client-chosen id", async () =>
    expect((await create({ ...streaming, id: "client-id" })).id).toBe(
      "client-id",
    ));

  it("rejects duplicates with an explanation", async () => {
    await create({ ...streaming, id: "one" });
    let response = await call("/api/subscriptions", {
      method: "POST",
      json: { ...streaming, name: "example streaming!", id: "two" },
    });
    expect(response.status).toBe(400);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({
      error:
        "Possible duplicate: example streaming!. Review as an update instead.",
    });
    response = await call("/api/subscriptions", {
      method: "POST",
      json: { ...music, id: "one" },
    });
    expect(await body(response)).toEqual({
      error: "Duplicate subscription ID",
    });
  });

  it("hides validation details behind the generic message", async () => {
    for (const init of [
      { json: { ...streaming, name: "" } },
      { json: null },
      { body: "{not json" },
      {},
    ]) {
      const response = await call("/api/subscriptions", {
        method: "POST",
        ...init,
      });
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ error: genericMessage });
    }
    expect(await stored()).toEqual([]);
  });

  it("enforces the upload limit by declared and streamed size", async () => {
    let response = await call("/api/subscriptions", {
      method: "POST",
      body: "{}",
      headers: { "Content-Length": "12000001" },
    });
    expect(response.status).toBe(413);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({
      error: "Request exceeds upload limit",
    });
    const chunk = new Uint8Array(1_000_000).fill(32);
    let sent = 0;
    response = await call("/api/chat", {
      method: "POST",
      body: new ReadableStream({
        pull(controller) {
          if (sent++ < 13) controller.enqueue(chunk);
          else controller.close();
        },
      }),
      duplex: "half",
    } as Call);
    expect(response.status).toBe(413);
  });

  it("updates by id and keeps the id from the path", async () => {
    await create({ ...streaming, id: "one" });
    const response = await call("/api/subscriptions/one", {
      method: "PATCH",
      json: { amount: 12, id: "ignored" },
    });
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({
      subscription: { ...streaming, id: "one", amount: 12, notes: "" },
    });
    expect((await stored())[0].data.amount).toBe(12);
  });

  it("rejects an update that duplicates another subscription", async () => {
    await create({ ...streaming, id: "one" });
    await create({ ...music, id: "two" });
    const response = await call("/api/subscriptions/two", {
      method: "PATCH",
      json: { name: streaming.name },
    });
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      error: `Possible duplicate: ${streaming.name}. Review as an update instead.`,
    });
  });

  it("returns 404 for an unknown id before reading the body", async () => {
    for (const method of ["PATCH", "DELETE", "GET", "PUT"]) {
      const response = await call("/api/subscriptions/missing", {
        method,
        body: method === "GET" ? undefined : "{not json",
      });
      expect(response.status).toBe(404);
      expectJsonHeaders(response);
      expect(await body(response)).toEqual({
        error: "Subscription not found",
      });
    }
  });

  it("deletes by id, including ids with encoded characters", async () => {
    await create({ ...streaming, id: "a/b c" });
    const response = await call("/api/subscriptions/a%2Fb%20c", {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({ deleted: true });
    expect(await stored()).toEqual([]);
  });

  it("answers unsupported methods and paths with Not found", async () => {
    await create({ ...streaming, id: "one" });
    for (const [method, path] of [
      ["GET", "/api/subscriptions/one"],
      ["POST", "/api/subscriptions/one"],
      ["PUT", "/api/subscriptions"],
      ["DELETE", "/api/subscriptions"],
      ["GET", "/api/subscriptions/"],
      ["GET", "/api/subscriptions/one/extra"],
      ["GET", "/api/"],
      ["GET", "/api/unknown"],
      ["GET", "/api/status/"],
      ["OPTIONS", "/api/subscriptions"],
    ]) {
      const response = await call(path, { method });
      expect([method, path, response.status]).toEqual([method, path, 404]);
      expectJsonHeaders(response);
      expect(await body(response)).toEqual({ error: "Not found" });
    }
    for (const path of ["/api/subscriptions", "/api/subscriptions/one"])
      expect((await call(path, { method: "HEAD" })).status).toBe(404);
  });

  it("maps a malformed id escape to the generic error", async () => {
    const response = await call("/api/subscriptions/%E0%A4%A", {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: genericMessage });
  });

  it("keeps each account's rows isolated and existing owner rows visible", async () => {
    await d1.db.batch([
      d1.db
        .prepare("INSERT INTO accounts(id) VALUES (?), (?)")
        .bind(accessSettings.ownerSubject, "another-account"),
      d1.db
        .prepare(
          "INSERT INTO subscriptions(account_id,id,data,duplicate_key) VALUES (?,?,?,?), (?,?,?,?)",
        )
        .bind(
          accessSettings.ownerSubject,
          "legacy",
          JSON.stringify({ ...streaming, id: "legacy", notes: "" }),
          "examplestreaming|USD",
          "another-account",
          "foreign",
          JSON.stringify({ ...music, id: "foreign", notes: "" }),
          "examplemusic|USD",
        ),
    ]);
    expect(await body(await call("/api/subscriptions"))).toEqual({
      subscriptions: [{ ...streaming, id: "legacy", notes: "" }],
    });
    expect(
      (await call("/api/subscriptions/foreign", { method: "DELETE" })).status,
    ).toBe(404);
    expect(await stored()).toHaveLength(2);
  });
});

describe("POST /api/review", () => {
  const requestId = "6f0c2c1e-8a8f-4a63-9a43-0d5a8c3f9b10";

  it("saves reviewed proposals atomically and returns the whole ledger", async () => {
    await create({ ...streaming, id: "one" });
    const response = await call("/api/review", {
      method: "POST",
      json: {
        requestId,
        proposals: [
          { ...music, id: "two", operation: "add" },
          {
            ...streaming,
            id: "ignored",
            amount: 15,
            operation: "update",
            targetId: "one",
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    const ledger = [
      { ...streaming, id: "one", amount: 15, notes: "" },
      { ...music, id: "two", notes: "" },
    ];
    expect(await body(response)).toEqual({ subscriptions: ledger });
    expect((await stored()).map((r) => r.data)).toEqual(ledger);
  });

  it("is idempotent by request id", async () => {
    const review = {
      requestId,
      proposals: [{ ...streaming, id: "one", operation: "add" }],
    };
    await call("/api/review", { method: "POST", json: review });
    const response = await call("/api/review", {
      method: "POST",
      json: {
        ...review,
        proposals: [{ ...music, id: "two", operation: "add" }],
      },
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      subscriptions: [{ ...streaming, id: "one", notes: "" }],
      alreadySaved: true,
    });
    expect(await stored()).toHaveLength(1);
  });

  it("saves nothing when any proposal conflicts", async () => {
    await create({ ...streaming, id: "one" });
    for (const [proposals, error] of [
      [
        [
          { ...music, id: "two", operation: "add" },
          { ...music, id: "three", operation: "update", targetId: "missing" },
        ],
        "Update target not found",
      ],
      [
        [
          { ...music, id: "two", operation: "add" },
          { ...streaming, id: "three", operation: "add" },
        ],
        `Possible duplicate: ${streaming.name}. Review as an update instead.`,
      ],
      [[], genericMessage],
    ] as const) {
      const response = await call("/api/review", {
        method: "POST",
        json: { requestId, proposals },
      });
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ error });
    }
    expect(await stored()).toHaveLength(1);
    const { results } = await d1.db.prepare("SELECT * FROM reviews").all();
    expect(results).toEqual([]);
  });
});

describe("POST /api/chat", () => {
  const proposal = { ...music, id: "proposal-1", operation: "add" };

  it("says plainly when ChatGPT is not connected", async () => {
    const response = await call("/api/chat", {
      method: "POST",
      json: { message: "I pay 4.50 for music" },
    });
    expect(response.status).toBe(503);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({
      error:
        "ChatGPT is not connected. Your message and screenshots have not been sent to an AI provider.",
    });
  });

  it("validates the message before checking the connection", async () => {
    const response = await call("/api/chat", {
      method: "POST",
      json: { message: " " },
    });
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: genericMessage });
  });

  it("sends the message and ledger to the bridge and returns unsaved proposals", async () => {
    await create({ ...streaming, id: "one" });
    bridge = fakeFetcher(() =>
      Response.json({ reply: "Found one.", proposals: [proposal] }),
    );
    const response = await call("/api/chat", {
      method: "POST",
      json: { message: "I pay 4.50 for music" },
      env: withAi(),
    });
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({
      reply: "Found one.",
      proposals: [{ ...proposal, notes: "" }],
    });
    const [request] = bridge.calls;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://bridge/chat");
    expect(request.headers.get("Authorization")).toBe(
      "Bearer synthetic-bridge-secret",
    );
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(await request.json()).toEqual({
      message: "I pay 4.50 for music",
      attachments: [],
      history: [],
      subscriptions: [{ ...streaming, id: "one", notes: "" }],
    });
    expect(await stored()).toHaveLength(1);
  });

  it("uses a default reply when the bridge omits one", async () => {
    bridge = fakeFetcher(() => Response.json({}));
    expect(
      await body(
        await call("/api/chat", {
          method: "POST",
          json: { message: "hello" },
          env: withAi(),
        }),
      ),
    ).toEqual({
      reply: "Review these proposed changes before saving.",
      proposals: [],
    });
  });

  it("maps bridge failures without saving anything", async () => {
    const failed =
      "ChatGPT could not complete this request. Nothing was saved. Check your private connection and try again.";
    for (const [status, expected] of [
      [429, 429],
      [401, 503],
      [500, 503],
    ]) {
      bridge = fakeFetcher(() => new Response("{}", { status }));
      const response = await call("/api/chat", {
        method: "POST",
        json: { message: "hello" },
        env: withAi(),
      });
      expect(response.status).toBe(expected);
      expect(await body(response)).toEqual({ error: failed });
    }
    bridge = fakeFetcher(() =>
      Response.json({ proposals: [{ ...proposal, currency: "dollars" }] }),
    );
    const response = await call("/api/chat", {
      method: "POST",
      json: { message: "hello" },
      env: withAi(),
    });
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: genericMessage });
  });
});

describe("GET /api/me and Access login", () => {
  const users = () =>
    d1.db
      .prepare(
        "SELECT u.id, u.account_id, u.role, u.status, u.email, u.display_name, i.provider, i.issuer, i.subject FROM users u JOIN user_identities i ON i.user_id = u.id",
      )
      .all();

  it("provisions the owner on the first API request and returns them", async () => {
    const response = await call("/api/me");
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    const { user } = await body(response);
    expect(user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: "owner@example.test",
      displayName: null,
      role: "owner",
    });
    expect((await users()).results).toEqual([
      {
        id: user.id,
        account_id: accessSettings.ownerSubject,
        role: "owner",
        status: "active",
        email: "owner@example.test",
        display_name: null,
        provider: "cloudflare_access",
        issuer: accessSettings.issuer,
        subject: accessSettings.ownerSubject,
      },
    ]);
    const audit = await d1.db
      .prepare("SELECT action, actor_user_id FROM audit_events")
      .all();
    expect(audit.results).toEqual([
      { action: "identity.linked", actor_user_id: user.id },
    ]);
    expect(await body(await call("/api/me"))).toEqual({ user });
    expect((await users()).results).toHaveLength(1);
  });

  it("does not create users for status checks or paths outside the API", async () => {
    await call("/api/status");
    await call("/");
    expect((await users()).results).toEqual([]);
  });

  it("keeps the profile in step with the signed token", async () => {
    await call("/api/me");
    const renamed = await keys.sign({
      email: "renamed@example.test",
      name: "Synthetic Owner",
    });
    expect(
      (await body(await call("/api/me", { token: renamed }))).user,
    ).toMatchObject({
      email: "renamed@example.test",
      displayName: "Synthetic Owner",
    });
    expect((await users()).results).toMatchObject([
      { email: "renamed@example.test", display_name: "Synthetic Owner" },
    ]);
  });

  it("rejects disabled users and tokens issued before a sign-out", async () => {
    await call("/api/me");
    const now = Math.floor(Date.now() / 1000);
    await d1.db
      .prepare("UPDATE users SET sessions_valid_after = ?")
      .bind(now + 60)
      .run();
    let response = await call("/api/subscriptions");
    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({ error: privateMessage });
    await d1.db
      .prepare("UPDATE users SET sessions_valid_after = 0, status = 'disabled'")
      .run();
    response = await call("/api/subscriptions");
    expect(response.status).toBe(403);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({
      error: "This Saldo instance is private.",
    });
    // Status agrees with the guards, so a client cannot loop on it.
    expect(await body(await call("/api/status", { env: withAi() }))).toEqual({
      authenticated: false,
      aiConnected: false,
    });
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it("refuses a changed owner subject unless the owner opts in to a handover", async () => {
    const before = (await body(await call("/api/me"))).user;
    await create();
    const rotatedSubject = "owner-subject-0002";
    const rotated = await keys.sign({ sub: rotatedSubject });
    const changed = env({ OWNER_SUB: rotatedSubject });
    const refused = await call("/api/subscriptions", {
      token: rotated,
      env: changed,
    });
    expect(refused.status).toBe(403);
    expect(await body(refused)).toEqual({
      error: "This Saldo instance is private.",
    });
    expect(
      await body(await call("/api/status", { token: rotated, env: changed })),
    ).toEqual({ authenticated: false, aiConnected: false });

    const handover = env({
      OWNER_SUB: rotatedSubject,
      OWNER_HANDOVER_FROM: ` ${accessSettings.ownerSubject} `,
    });
    expect(
      await body(await call("/api/status", { token: rotated, env: handover })),
    ).toEqual({ authenticated: true, aiConnected: false });
    expect((await users()).results).toHaveLength(1);
    const me = await call("/api/me", { token: rotated, env: handover });
    expect(me.status).toBe(200);
    expect((await body(me)).user.id).toBe(before.id);
    const list = await call("/api/subscriptions", {
      token: rotated,
      env: handover,
    });
    expect((await body(list)).subscriptions).toHaveLength(1);
    const audit = await d1.db
      .prepare(
        "SELECT action, summary FROM audit_events WHERE action = 'identity.handover'",
      )
      .all();
    expect(audit.results).toEqual([
      {
        action: "identity.handover",
        summary:
          '{"provider":"cloudflare_access","issuerChanged":false,"subjectChanged":true}',
      },
    ]);
  });

  it("answers 401 without a token and 404 for other methods", async () => {
    expect((await call("/api/me", { token: null })).status).toBe(401);
    expect((await call("/api/me", { method: "POST" })).status).toBe(404);
    expect((await call("/api/me", { method: "HEAD" })).status).toBe(404);
  });
});

describe("POST /api/session/sign-out", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it("rejects the signed-out token at once, everywhere, and audits it", async () => {
    const token = await keys.sign({ iat: now() - 10 });
    expect((await call("/api/me", { token })).status).toBe(200);
    const response = await call("/api/session/sign-out", {
      method: "POST",
      token,
    });
    expect(response.status).toBe(200);
    expectJsonHeaders(response);
    expect(await body(response)).toEqual({ signedOut: true });

    for (const path of ["/api/me", "/api/subscriptions"]) {
      const replay = await call(path, { token });
      expect(replay.status).toBe(401);
      expect(await body(replay)).toEqual({ error: privateMessage });
    }
    expect(
      (await call("/api/session/sign-out", { method: "POST", token })).status,
    ).toBe(401);
    expect(
      await body(await call("/api/status", { token, env: withAi() })),
    ).toEqual({ authenticated: false, aiConnected: false });
    expect(bridge.fetch).not.toHaveBeenCalled();

    const audit = await d1.db
      .prepare("SELECT action FROM audit_events ORDER BY created_at, action")
      .all();
    expect(audit.results).toEqual([
      { action: "identity.linked" },
      { action: "session.signed_out" },
    ]);
    // Signing in again through Access issues a newer token, which works.
    const fresh = await keys.sign({ iat: now() + 5 });
    expect((await call("/api/me", { token: fresh })).status).toBe(200);
  });

  it("needs the app Origin and answers only POST", async () => {
    const token = await keys.sign({ iat: now() - 10 });
    const foreign = await call("/api/session/sign-out", {
      method: "POST",
      token,
      headers: { Origin: "https://evil.test" },
    });
    expect(foreign.status).toBe(403);
    expect(await body(foreign)).toEqual({ error: "Origin not allowed" });
    for (const method of ["GET", "HEAD", "PUT"])
      expect(
        (await call("/api/session/sign-out", { method, token })).status,
      ).toBe(404);
    expect((await call("/api/me", { token })).status).toBe(200);
  });
});
