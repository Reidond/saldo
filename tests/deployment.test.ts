import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import api from "../apps/api/cloudflare.config";
import bridge, { inference } from "../apps/bridge/cloudflare.config";
import web from "../apps/web/cloudflare.config";
import {
  canonical,
  expectedBindings,
  releaseSettings,
} from "../scripts/ci/deployment";

type Config = {
  worker: Record<string, any>;
  containers?: unknown[];
};
const evaluate = (config: unknown, isPreview = false): Config =>
  (config as (ctx: { mode?: string; isPreview: boolean }) => Config)({
    mode: "production",
    isPreview,
  });
const release = {
  SALDO_RELEASE: "production",
  SALDO_APP_ORIGIN: "https://example.test",
  SALDO_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  SALDO_ACCESS_AUD: "a".repeat(64),
  SALDO_OWNER_SUB: "synthetic-owner",
  SALDO_D1_DATABASE_ID: "00000000-0000-4000-8000-000000000001",
};
function stubRelease() {
  for (const [name, value] of Object.entries(release)) vi.stubEnv(name, value);
}
afterEach(() => vi.unstubAllEnvs());

describe("cf is the only Cloudflare tool", () => {
  it("has no Wrangler configuration or dependency left", () => {
    for (const path of [
      "apps/api/wrangler.jsonc",
      "apps/web/wrangler.jsonc",
      "apps/bridge/wrangler.jsonc",
      "deployment/package.json",
    ])
      expect(existsSync(path), path).toBe(false);
    for (const manifest of [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "apps/bridge/package.json",
    ]) {
      const text = readFileSync(manifest, "utf8");
      expect(text, manifest).not.toMatch(/wrangler/);
      if (manifest !== "package.json")
        expect(JSON.parse(text).devDependencies.cf).toBe("catalog:");
    }
    expect(readFileSync("pnpm-workspace.yaml", "utf8")).not.toMatch(/wrangler/);
  });
  it("builds every Worker with the Vite plugin's own delegate, not a framework command", () => {
    // cf runs `npx vite build` (an unlocked download) when `vite` itself is a
    // declared dependency; without it, cf uses @cloudflare/vite-plugin's
    // cf-vite, which resolves the workspace's Vite+ core.
    for (const app of ["api", "web", "bridge"]) {
      const manifest = JSON.parse(
        readFileSync(`apps/${app}/package.json`, "utf8"),
      );
      expect(manifest.devDependencies["@cloudflare/vite-plugin"]).toBe(
        "catalog:",
      );
      expect(manifest.dependencies?.vite).toBeUndefined();
      expect(manifest.devDependencies.vite).toBeUndefined();
    }
  });
  it("keeps the repository root from becoming a cf project", async () => {
    await expect(import("../cloudflare.config")).rejects.toThrow(
      "not the repository root",
    );
  });
});

describe("deployment privacy invariants", () => {
  it("refuses Worker previews for every deployable", () => {
    for (const config of [api, web, bridge])
      expect(() => evaluate(config, true)).toThrow("no Worker previews");
  });
  it("keeps every Worker off workers.dev, Preview URLs, observability and routes", () => {
    for (const config of [api, web, bridge]) {
      const { worker } = evaluate(config);
      expect(worker.workersDev).toBe(false);
      expect(worker.previewUrls).toBe(false);
      expect(worker.observability).toEqual({ enabled: false });
      expect(worker.domains).toBeUndefined();
      expect(worker.triggers).toBeUndefined();
    }
  });
  it("gives the API no public entry point and no assets", () => {
    const { worker } = evaluate(api);
    expect(worker.name).toBe("saldo-api");
    expect(worker.entrypoint).toBe("./src/worker.ts");
    expect(worker.assets).toBeUndefined();
    expect(Object.keys(worker.env)).not.toContain("ASSETS");
  });
  it("routes all web assets through the Worker that verifies Access", () => {
    const { worker } = evaluate(web);
    expect(worker.name).toBe("saldo-web");
    expect(worker.entrypoint).toBe("./src/framework/entry.rsc.tsx");
    expect(worker.assets).toEqual({ runWorkerFirst: true });
    expect(worker.env.ASSETS).toEqual({ type: "assets" });
    expect(worker.env.API).toEqual({ type: "worker", worker: "saldo-api" });
  });
  it("keeps the AI bridge private with its SQLite namespace and single Container", () => {
    const { worker, containers } = evaluate(bridge);
    expect(worker.name).toBe("saldo-ai-bridge");
    expect(worker.exports).toEqual({
      SaldoAI: {
        type: "durable-object",
        storage: "sqlite",
        container: inference,
      },
    });
    expect(containers).toEqual([inference]);
    expect(inference).toMatchObject({
      name: "saldo-ai-bridge-saldoai",
      instanceType: "lite",
      maxInstances: 1,
      image: { dockerfile: "./Dockerfile", buildContext: "../.." },
    });
    expect(worker.env).toEqual({
      SALDO_AI: {
        type: "durable-object",
        worker: "saldo-ai-bridge",
        exportName: "SaldoAI",
      },
    });
  });
});

describe("release builds", () => {
  it("use local placeholders and no Access settings outside a release", () => {
    const { worker } = evaluate(api);
    expect(worker.env.APP_ORIGIN).toEqual({
      type: "text",
      value: "http://localhost:8787",
    });
    expect(worker.env.DB.id).toBe("00000000-0000-4000-8000-000000000000");
    for (const config of [api, web])
      expect(Object.keys(evaluate(config).worker.env)).not.toContain(
        "ACCESS_AUD",
      );
  });
  it("refuse to build a release without the protected settings", () => {
    stubRelease();
    for (const name of Object.keys(release).filter(
      (n) => n !== "SALDO_RELEASE",
    )) {
      vi.stubEnv(name, "");
      expect(() => evaluate(api)).toThrow(name);
      vi.stubEnv(name, release[name as keyof typeof release]);
    }
  });
  it("declare exactly the bindings the deploy job approves", () => {
    stubRelease();
    const settings = releaseSettings(release);
    expect(canonical(evaluate(api).worker.env)).toBe(
      canonical(expectedBindings("api", settings)),
    );
    expect(canonical(evaluate(bridge).worker.env)).toBe(
      canonical(expectedBindings("bridge", settings)),
    );
    expect(canonical(evaluate(web).worker.env)).toBe(
      canonical(expectedBindings("web", settings)),
    );
  });
});
