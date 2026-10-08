import { describe, it, expect } from "vite-plus/test";
import {
  parseSettings,
  validateApp,
  validatePrivateEndpoints,
  assertPreserved,
  makeAppConfig,
  validateBridge,
  assertLatestMain,
  type Settings,
} from "../scripts/ci/deployment";
const id = "00000000-0000-0000-0000-000000000001";
const settings: Settings = {
  bindings: [
    { name: "APP_ORIGIN", type: "plain_text", text: "https://example.test" },
    {
      name: "ACCESS_TEAM_DOMAIN",
      type: "plain_text",
      text: "example.cloudflareaccess.com",
    },
    { name: "ACCESS_AUD", type: "plain_text", text: "synthetic-audience" },
    { name: "OWNER_SUB", type: "plain_text", text: "synthetic-owner" },
    { name: "DB", type: "d1", id },
    { name: "FILES", type: "r2_bucket", bucket_name: "saldo-private" },
    { name: "ASSETS", type: "assets" },
    { name: "AI_BRIDGE_SECRET", type: "secret_text" },
  ],
};
describe("CI live configuration preservation", () => {
  it("creates deterministic private app config without copying token values", () => {
    const c = makeAppConfig(settings, id, "/repo");
    expect(c.workers_dev).toBe(false);
    expect(c.preview_urls).toBe(false);
    expect(c.assets.run_worker_first).toBe(true);
    expect(c).not.toHaveProperty("vars");
    expect(c.services).toEqual([{ binding: "AI", service: "saldo-ai-bridge" }]);
    expect(JSON.stringify(c)).not.toContain("AI_BRIDGE_SECRET");
    expect(c).not.toHaveProperty("routes");
  });
  it("rejects missing or mismatched live access/storage configuration", () => {
    expect(() =>
      validateApp(
        {
          ...settings,
          bindings: settings.bindings.filter((b) => b.name !== "OWNER_SUB"),
        },
        id,
      ),
    ).toThrow();
    expect(() => validateApp(settings, "another")).toThrow();
    expect(() =>
      validateApp(
        {
          ...settings,
          bindings: [...settings.bindings, { name: "OTHER", type: "queue" }],
        },
        id,
      ),
    ).toThrow();
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

it("preserves service entrypoint/environment and bucket jurisdiction before upload", () => {
  const withRouting = {
    bindings: [
      ...settings.bindings.map((b) =>
        b.name === "FILES" ? { ...b, jurisdiction: "eu" } : b,
      ),
      {
        name: "AI",
        type: "service",
        service: "saldo-ai-bridge",
        environment: "production",
        entrypoint: "PrivateBridge",
      },
    ],
  };
  const c = makeAppConfig(withRouting, id, "/repo");
  expect(c.services[0]).toMatchObject({
    environment: "production",
    entrypoint: "PrivateBridge",
  });
  expect(c.r2_buckets[0].jurisdiction).toBe("eu");
  expect(() =>
    makeAppConfig(
      {
        bindings: [
          ...settings.bindings,
          {
            name: "AI",
            type: "service",
            service: "saldo-ai-bridge",
            unrecognizedRouting: "other",
          },
        ],
      },
      id,
      "/repo",
    ),
  ).toThrow();
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
