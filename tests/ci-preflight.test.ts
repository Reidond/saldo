import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  contentMessage,
  preflight,
  releaseSettings,
  type Settings,
} from "../scripts/ci/deployment";

// preflight() against a fake, read-only Cloudflare API. No network,
// credentials or Workers; every value is synthetic.
const id = "00000000-0000-4000-8000-000000000001";
const audience = "a".repeat(64);
const release = releaseSettings({
  SALDO_APP_ORIGIN: "https://example.test",
  SALDO_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  SALDO_ACCESS_AUD: audience,
  SALDO_OWNER_SUB: "synthetic-owner",
  SALDO_D1_DATABASE_ID: id,
});
const access: Settings["bindings"] = [
  { name: "APP_ORIGIN", type: "plain_text", text: "https://example.test" },
  {
    name: "ACCESS_TEAM_DOMAIN",
    type: "plain_text",
    text: "example.cloudflareaccess.com",
  },
  { name: "ACCESS_AUD", type: "plain_text", text: audience },
];
const owner = {
  name: "OWNER_SUB",
  type: "plain_text",
  text: "synthetic-owner",
};
const database = { name: "DB", type: "d1", id };
const deployed = {
  "saldo-ai-bridge": [
    {
      name: "SALDO_AI",
      type: "durable_object_namespace",
      class_name: "SaldoAI",
      namespace_id: "synthetic-namespace",
    },
  ],
  "saldo-api": [
    ...access,
    owner,
    database,
    { name: "FILES", type: "r2_bucket", bucket_name: "saldo-private" },
    { name: "AI", type: "service", service: "saldo-ai-bridge" },
  ],
  "saldo-web": [
    ...access,
    { name: "ASSETS", type: "assets" },
    { name: "API", type: "service", service: "saldo-api" },
  ],
  saldo: [...access, owner, database, { name: "ASSETS", type: "assets" }],
};
const closed = { enabled: false, previews_enabled: false };

interface Worker {
  bindings: Settings["bindings"];
  endpoints?: Record<string, boolean>;
  message?: string;
}
let workers: Record<string, Worker | undefined>;
let holder: string;
let serviceDomains: Record<string, string[]>;
let denied: string[];
let requests: string[];

function respond(path: string): Response {
  const ok = (result: unknown) => Response.json({ success: true, result });
  if (denied.some((fragment) => path.includes(fragment)))
    return new Response("denied", { status: 403 });
  if (path === "workers/subdomain") return ok({ subdomain: "synthetic" });
  if (path.startsWith("workers/domains?service="))
    return ok(serviceDomains[path.split("=")[1]] ?? []);
  if (path.startsWith("workers/domains?hostname="))
    return ok([{ service: holder, hostname: "example.test" }]);
  if (path.startsWith("d1/database/"))
    return ok({ bookmark: "synthetic-bookmark" });
  const [, kind, name, resource] = path.split("/");
  const worker = workers[name];
  if (!worker) return new Response("", { status: 404 });
  if (kind === "scripts" && resource === "settings")
    return ok({ bindings: worker.bindings });
  if (kind === "scripts" && resource === "subdomain")
    return ok(worker.endpoints ?? closed);
  if (kind === "scripts" && resource === "deployments")
    return ok({
      deployments: [
        { versions: [{ version_id: `${name}-v1`, percentage: 100 }] },
      ],
    });
  if (kind === "workers" && resource === "versions")
    return ok({ annotations: { "workers/message": worker.message } });
  return new Response("unexpected", { status: 500 });
}

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic-token-never-valid");
  vi.stubEnv("RUNNER_TEMP", "/tmp/synthetic-ci-test");
  workers = Object.fromEntries(
    Object.entries(deployed).map(([name, bindings]) => [
      name,
      { bindings, message: contentMessage("1".repeat(64)) },
    ]),
  );
  workers.saldo!.message = undefined;
  holder = "saldo-web";
  serviceDomains = {};
  denied = [];
  requests = [];
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = url.slice(prefix.length);
      requests.push(path);
      return respond(path);
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pre-deployment preflight", () => {
  it("accepts deployed Workers that match the release", async () => {
    const result = await preflight(release);
    expect(result).toMatchObject({
      placeholders: [],
      publicEndpoints: [],
      bookmark: "synthetic-bookmark",
    });
    expect(result.live.api?.bindings).toEqual(deployed["saldo-api"]);
  });

  it("treats binding-less API and web Workers as placeholders, not deployments", async () => {
    // Created by the owner for the per-Worker token; a secret set ahead of
    // the first deploy is allowed and must survive it.
    const secret = { name: "AI_BRIDGE_SECRET", type: "secret_text" };
    workers["saldo-api"] = { bindings: [secret], message: "Hello World" };
    workers["saldo-web"] = { bindings: [] };
    const result = await preflight(release);
    expect(result.placeholders).toEqual(["api", "web"]);
    expect(result.live.api?.bindings).toEqual([secret]);
  });

  it("refuses a binding-less Worker whose active version a release uploaded", async () => {
    workers["saldo-web"] = {
      bindings: [],
      message: contentMessage("2".repeat(64)),
    };
    await expect(preflight(release)).rejects.toThrow(
      "Live APP_ORIGIN differs from the protected environment",
    );
  });

  it("still refuses a live Worker whose identifiers differ", async () => {
    workers["saldo-api"] = {
      bindings: [
        { name: "APP_ORIGIN", type: "plain_text", text: "https://other.test" },
      ],
    };
    await expect(preflight(release)).rejects.toThrow("Live APP_ORIGIN differs");
  });

  it("refuses a missing Worker, which the per-Worker token cannot create", async () => {
    workers["saldo-web"] = undefined;
    await expect(preflight(release)).rejects.toThrow(
      "saldo-web does not exist",
    );
  });

  it("reports public endpoints for the deploy step to close, except on the legacy Worker", async () => {
    workers["saldo-web"]!.endpoints = { enabled: true, previews_enabled: true };
    expect((await preflight(release)).publicEndpoints).toEqual(["web"]);
    workers.saldo!.endpoints = { enabled: false, previews_enabled: true };
    await expect(preflight(release)).rejects.toThrow(
      "Public Worker alternate endpoint is enabled",
    );
  });

  it.each([
    ["workers/subdomain", "workers.dev subdomain read failed (HTTP 403)"],
    ["workers/domains", "Worker custom-domain read failed (HTTP 403)"],
  ])(
    "stops on a missing account permission (%s) before any Worker read",
    async (path, message) => {
      denied = [path];
      await expect(preflight(release)).rejects.toThrow(message);
      expect(requests.some((r) => r.startsWith("workers/scripts/"))).toBe(
        false,
      );
    },
  );

  it("stops when a Worker is not on the token", async () => {
    denied = ["workers/scripts/saldo-api/"];
    await expect(preflight(release)).rejects.toThrow(
      "Worker settings read failed (HTTP 403)",
    );
  });

  it("refuses a custom domain on the API or the app hostname on another Worker", async () => {
    serviceDomains = { "saldo-api": ["example.test"] };
    await expect(preflight(release)).rejects.toThrow(
      "saldo-api has a custom domain",
    );
    serviceDomains = {};
    holder = "saldo";
    await expect(preflight(release)).resolves.toBeDefined();
    holder = "someone-else";
    await expect(preflight(release)).rejects.toThrow(
      "The app hostname is not served by the web Worker",
    );
  });
});
