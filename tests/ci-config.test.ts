import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vite-plus/test";
import {
  parseSettings,
  releaseSettings,
  databaseIdOf,
  validateApi,
  validateWeb,
  validateLegacy,
  validatePrivateEndpoints,
  assertPreserved,
  validateBridge,
  assertLatestMain,
  assertAccessDenied,
  readBuildOutput,
  validateBuildOutput,
  expectedBindings,
  assertNoSecretValues,
  canonical,
  contentHash,
  dockerContextFiles,
  summarize,
  type ReleaseSettings,
  type Settings,
} from "../scripts/ci/deployment";

const id = "00000000-0000-4000-8000-000000000001";
const audience = "a".repeat(64);
const env = {
  SALDO_APP_ORIGIN: "https://example.test",
  SALDO_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  SALDO_ACCESS_AUD: audience,
  SALDO_OWNER_SUB: "synthetic-owner",
  SALDO_D1_DATABASE_ID: id,
};
const release: ReleaseSettings = releaseSettings(env);
const settings: Settings = {
  bindings: [
    { name: "APP_ORIGIN", type: "plain_text", text: "https://example.test" },
    {
      name: "ACCESS_TEAM_DOMAIN",
      type: "plain_text",
      text: "example.cloudflareaccess.com",
    },
    { name: "ACCESS_AUD", type: "plain_text", text: audience },
    { name: "OWNER_SUB", type: "plain_text", text: "synthetic-owner" },
    { name: "DB", type: "d1", id },
    { name: "FILES", type: "r2_bucket", bucket_name: "saldo-private" },
    {
      name: "AI",
      type: "service",
      service: "saldo-ai-bridge",
      environment: "production",
    },
    { name: "AI_BRIDGE_SECRET", type: "secret_text" },
  ],
};

describe("release settings from the protected Environment", () => {
  it("accepts well-formed identifiers", () => {
    expect(release).toEqual({
      appOrigin: "https://example.test",
      teamDomain: "example.cloudflareaccess.com",
      audience,
      ownerSubject: "synthetic-owner",
      databaseId: id,
    });
    expect(databaseIdOf(env)).toBe(id);
  });
  it("refuses missing or malformed values without echoing them", () => {
    for (const name of Object.keys(env))
      expect(() => releaseSettings({ ...env, [name]: " " })).toThrow(name);
    for (const patch of [
      { SALDO_APP_ORIGIN: "http://example.test" },
      { SALDO_APP_ORIGIN: "https://example.test/" },
      { SALDO_APP_ORIGIN: "not a url" },
      { SALDO_ACCESS_TEAM_DOMAIN: "example.com" },
      { SALDO_ACCESS_AUD: "short" },
      { SALDO_OWNER_SUB: "two words" },
      { SALDO_D1_DATABASE_ID: "saldo" },
      { SALDO_D1_DATABASE_ID: "00000000-0000-0000-0000-000000000000" },
    ]) {
      const value = Object.values(patch)[0];
      expect(() => releaseSettings({ ...env, ...patch })).toThrow();
      try {
        releaseSettings({ ...env, ...patch });
      } catch (error) {
        expect((error as Error).message).not.toContain(value);
      }
    }
  });
});

const web: Settings = {
  bindings: [
    ...settings.bindings.filter((b) =>
      ["APP_ORIGIN", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"].includes(b.name),
    ),
    { name: "ASSETS", type: "assets" },
    { name: "API", type: "service", service: "saldo-api" },
  ],
};

describe("CI live configuration preservation", () => {
  it("accepts live Workers that already carry the release identifiers", () => {
    expect(() => validateApi(settings, release)).not.toThrow();
    expect(() => validateWeb(web, release)).not.toThrow();
    // The legacy app Worker also served assets; only its identity matters.
    expect(() =>
      validateLegacy(
        {
          bindings: [...settings.bindings, { name: "ASSETS", type: "assets" }],
        },
        release,
      ),
    ).not.toThrow();
  });
  it("refuses a web Worker that differs from the approved release", () => {
    const patched = (name: string, patch: Record<string, unknown>) => ({
      bindings: web.bindings.map((b) =>
        b.name === name ? { ...b, ...patch } : b,
      ),
    });
    for (const live of [
      patched("API", { service: "saldo" }),
      patched("API", { entrypoint: "Admin" }),
      patched("ACCESS_AUD", { text: "b".repeat(64) }),
      { bindings: web.bindings.filter((b) => b.name !== "ASSETS") },
      { bindings: [...web.bindings, { name: "DB", type: "d1", id }] },
    ])
      expect(() => validateWeb(live, release)).toThrow();
  });
  it("refuses a legacy Worker whose Access settings or database differ", () => {
    for (const name of ["OWNER_SUB", "DB"])
      expect(() =>
        validateLegacy(
          { bindings: settings.bindings.filter((b) => b.name !== name) },
          release,
        ),
      ).toThrow();
  });
  it("refuses to replace differing live Access or storage configuration", () => {
    const patched = (name: string, patch: Record<string, unknown>) => ({
      bindings: settings.bindings.map((b) =>
        b.name === name ? { ...b, ...patch } : b,
      ),
    });
    for (const live of [
      {
        bindings: settings.bindings.filter((b) => b.name !== "OWNER_SUB"),
      },
      patched("ACCESS_AUD", { text: "b".repeat(64) }),
      patched("APP_ORIGIN", { type: "secret_text" }),
      patched("DB", { id: "00000000-0000-4000-8000-000000000002" }),
      patched("FILES", { jurisdiction: "eu" }),
      patched("AI", { entrypoint: "Other" }),
      patched("AI", { service: "another-worker" }),
      { bindings: [...settings.bindings, { name: "ASSETS", type: "assets" }] },
      { bindings: [...settings.bindings, { name: "OTHER", type: "queue" }] },
    ])
      expect(() => validateApi(live, release)).toThrow();
  });
  it("requires both public alternates explicitly disabled", () => {
    expect(() =>
      validatePrivateEndpoints({ enabled: false, previews_enabled: false }),
    ).not.toThrow();
    for (const v of [
      { enabled: true, previews_enabled: false },
      { enabled: false, previews_enabled: true },
      { enabled: false },
    ])
      expect(() => validatePrivateEndpoints(v)).toThrow();
  });
  it("detects secret name, owner, and namespace loss after deployment", () => {
    assertPreserved(settings, settings);
    expect(() =>
      assertPreserved(settings, {
        bindings: settings.bindings.filter(
          (b) => b.name !== "AI_BRIDGE_SECRET",
        ),
      }),
    ).toThrow();
    expect(() =>
      assertPreserved(settings, {
        bindings: settings.bindings.map((b) =>
          b.name === "OWNER_SUB" ? { ...b, text: "changed" } : b,
        ),
      }),
    ).toThrow();
    expect(() =>
      assertPreserved(
        {
          bindings: [
            {
              name: "SALDO_AI",
              type: "durable_object_namespace",
              namespace_id: "original",
            },
          ],
        },
        {
          bindings: [
            {
              name: "SALDO_AI",
              type: "durable_object_namespace",
              namespace_id: "new",
            },
          ],
        },
      ),
    ).toThrow();
  });
  it("rejects duplicate bindings", () =>
    expect(() =>
      parseSettings({ bindings: [settings.bindings[0], settings.bindings[0]] }),
    ).toThrow());
});

it("requires the exact existing bridge namespace class and local Worker identity", () => {
  validateBridge({ bindings: [] });
  const binding = {
    name: "SALDO_AI",
    type: "durable_object_namespace",
    class_name: "SaldoAI",
    namespace_id: "synthetic",
  };
  validateBridge({ bindings: [binding] });
  for (const patch of [
    { class_name: "Other" },
    { type: "plain_text" },
    { type: "secret_text" },
    { script_name: "other-worker" },
    { namespace_id: undefined },
    { environment: "staging" },
  ])
    expect(() =>
      validateBridge({ bindings: [{ ...binding, ...patch }] }),
    ).toThrow();
});
it("rejects stale or unverified main commits before mutations", () => {
  const sha = "a".repeat(40);
  expect(() =>
    assertLatestMain(sha, sha + "\trefs/heads/main\n"),
  ).not.toThrow();
  expect(() => assertLatestMain(sha, "b".repeat(40))).toThrow();
  expect(() => assertLatestMain(sha, "")).toThrow();
});
it("accepts only an Access redirect to the team domain or 401 for anonymous requests", () => {
  for (const [status, location] of [
    [302, "https://example.cloudflareaccess.com/cdn-cgi/access/login/x"],
    [401, null],
  ] as const)
    expect(() => assertAccessDenied(status, location, release)).not.toThrow();
  for (const [status, location] of [
    [200, null],
    [404, null],
    [302, "https://evil.test/login"],
    [302, null],
  ] as const)
    expect(() => assertAccessDenied(status, location, release)).toThrow();
});

/** Writes a synthetic Build Output shaped like the Vite plugin's. */
function buildOutput(
  worker: Record<string, unknown>,
  {
    mode = "production",
    containers = {},
    files = {},
  }: {
    mode?: string;
    containers?: Record<string, unknown>;
    files?: Record<string, string>;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "saldo-build-output-"));
  const write = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  write(
    "config.json",
    JSON.stringify({ buildContext: { isPreview: false, mode } }),
  );
  write("workers/default/worker.config.json", JSON.stringify(worker));
  for (const [name, config] of Object.entries(containers))
    write(`containers/${name}/container.config.json`, JSON.stringify(config));
  write("workers/default/bundle/index.js", "export default {};");
  for (const [path, content] of Object.entries(files)) write(path, content);
  return root;
}
const api = {
  name: "saldo-api",
  compatibilityDate: "2026-10-01",
  workersDev: false,
  previewUrls: false,
  observability: { enabled: false },
  env: expectedBindings("api", release),
};
const webWorker = {
  name: "saldo-web",
  workersDev: false,
  previewUrls: false,
  assets: { runWorkerFirst: true },
  env: expectedBindings("web", release),
};
const bridge = {
  name: "saldo-ai-bridge",
  workersDev: false,
  previewUrls: false,
  env: expectedBindings("bridge", release),
  exports: {
    SaldoAI: {
      type: "durable-object",
      storage: "sqlite",
      container: "saldo-ai-bridge-saldoai",
    },
  },
};
const container = {
  "saldo-ai-bridge-saldoai": {
    name: "saldo-ai-bridge-saldoai",
    maxInstances: 1,
    instanceType: "lite",
    image: { localReference: "cloudflare-build/a/saldo-ai-bridge-saldoai:b" },
  },
};

describe("release Build Output", () => {
  it("accepts exactly the approved API, web and bridge Workers", () => {
    expect(() =>
      validateBuildOutput(
        "web",
        readBuildOutput(buildOutput(webWorker)),
        release,
      ),
    ).not.toThrow();
    expect(() =>
      validateBuildOutput("api", readBuildOutput(buildOutput(api)), release),
    ).not.toThrow();
    expect(() =>
      validateBuildOutput(
        "bridge",
        readBuildOutput(buildOutput(bridge, { containers: container })),
        release,
      ),
    ).not.toThrow();
  });
  it("compares bindings regardless of key order", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonical({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
  it("refuses a web build that serves assets before verifying Access", () => {
    for (const worker of [
      { ...webWorker, assets: undefined },
      { ...webWorker, assets: { runWorkerFirst: false } },
      { ...webWorker, assets: { runWorkerFirst: ["/api/*"] } },
      {
        ...webWorker,
        env: { ...webWorker.env, API: { type: "worker", worker: "saldo" } },
      },
    ])
      expect(() =>
        validateBuildOutput(
          "web",
          readBuildOutput(buildOutput(worker)),
          release,
        ),
      ).toThrow();
  });
  it("refuses a missing, development or tampered API build", () => {
    expect(() => readBuildOutput(join(tmpdir(), "saldo-missing"))).toThrow(
      "Build Output is missing",
    );
    const env = expectedBindings("api", release);
    for (const [worker, options] of [
      [api, { mode: "development" }],
      [{ ...api, name: "saldo-web" }, {}],
      [{ ...api, workersDev: true }, {}],
      [{ ...api, previewUrls: undefined }, {}],
      [{ ...api, domains: ["example.test"] }, {}],
      [
        { ...api, triggers: [{ type: "fetch", pattern: "example.test/*" }] },
        {},
      ],
      [{ ...api, env: { ...env, EXTRA: { type: "text", value: "x" } } }, {}],
      [
        { ...api, env: { ...env, ACCESS_AUD: { type: "text", value: "" } } },
        {},
      ],
      [{ ...api, exports: { X: { type: "durable-object" } } }, {}],
      [api, { containers: container }],
    ] as const)
      expect(() =>
        validateBuildOutput(
          "api",
          readBuildOutput(buildOutput(worker, options)),
          release,
        ),
      ).toThrow();
  });
  it("refuses a bridge whose Durable Object or Container changed", () => {
    for (const [worker, containers] of [
      [{ ...bridge, exports: {} }, container],
      [bridge, {}],
      [
        bridge,
        {
          "saldo-ai-bridge-saldoai": {
            ...container["saldo-ai-bridge-saldoai"],
            maxInstances: 2,
          },
        },
      ],
    ] as const)
      expect(() =>
        validateBuildOutput(
          "bridge",
          readBuildOutput(buildOutput(worker, { containers })),
          release,
        ),
      ).toThrow();
  });
  it("finds secret values and private files in uploaded code and assets", () => {
    const token = "synthetic-token-never-valid";
    const clean = buildOutput(api);
    expect(() =>
      assertNoSecretValues(clean, [token, audience, "synthetic-owner"]),
    ).not.toThrow();
    const leaks: Record<string, string>[] = [
      { "workers/default/bundle/index.js": `const t = "${token}";` },
      { "workers/default/assets/app.js": `aud="${audience}"` },
      { "workers/default/bundle/.dev.vars": "X=1" },
      { "workers/default/assets/key.pem": "-----" },
    ];
    for (const files of leaks)
      expect(() =>
        assertNoSecretValues(buildOutput(api, { files }), [token, audience]),
      ).toThrow();
  });
});

describe("idempotent releases", () => {
  /** A synthetic repository with a bridge Build Output and image sources. */
  function repository(reference: string, container = "container v1") {
    const root = mkdtempSync(join(tmpdir(), "saldo-release-root-"));
    const output = buildOutput(bridge, {
      containers: {
        "saldo-ai-bridge-saldoai": {
          ...container_,
          image: { localReference: reference },
        },
      },
    });
    mkdirSync(join(root, "apps/bridge/.cloudflare/output"), {
      recursive: true,
    });
    cpSync(output, join(root, "apps/bridge/.cloudflare/output/v0"), {
      recursive: true,
    });
    mkdirSync(join(root, "packages/domain/src"), { recursive: true });
    writeFileSync(
      join(root, ".dockerignore"),
      "**\n!apps/bridge/container.ts\n!packages/domain/src/*.ts\n",
    );
    writeFileSync(join(root, "apps/bridge/container.ts"), container);
    writeFileSync(join(root, "packages/domain/src/index.ts"), "export {};");
    writeFileSync(join(root, "packages/domain/src/notes.md"), "ignored");
    return root;
  }
  const container_ = container["saldo-ai-bridge-saldoai"];
  it("lists exactly the files the bridge image is built from", () => {
    expect(dockerContextFiles(repository("a"))).toEqual([
      ".dockerignore",
      "apps/bridge/container.ts",
      "packages/domain/src/index.ts",
    ]);
  });
  it("hashes content, not the local image reference", () => {
    const first = contentHash("bridge", repository("cloudflare-build/a/x:1"));
    expect(contentHash("bridge", repository("cloudflare-build/b/x:2"))).toBe(
      first,
    );
    expect(
      contentHash("bridge", repository("cloudflare-build/a/x:1", "changed")),
    ).not.toBe(first);
  });
  it("reports a complete, partial or failed release", () => {
    const state = (bridge: string, apiOutcome: string, webOutcome: string) =>
      ({
        commit: "a".repeat(40),
        tag: `${"a".repeat(40)}-1-1`,
        components: {
          bridge: { hash: "h", outcome: bridge, version: "v1" },
          api: { hash: "h", outcome: apiOutcome, version: "v2" },
          web: { hash: "h", outcome: webOutcome },
        },
      }) as Parameters<typeof summarize>[0];
    expect(summarize(state("unchanged", "deployed", "deployed"))).toMatchObject(
      { ok: true, text: expect.stringContaining("Release complete") },
    );
    const partial = summarize(state("deployed", "failed", "not attempted"));
    expect(partial.ok).toBe(false);
    expect(partial.text).toContain("partial");
    expect(partial.text).toContain("| saldo-web | not attempted | - |");
    expect(
      summarize(state("failed", "not attempted", "not attempted")),
    ).toMatchObject({
      ok: false,
      text: expect.stringContaining("Release failed"),
    });
    expect(summarize(undefined).ok).toBe(false);
  });
});
