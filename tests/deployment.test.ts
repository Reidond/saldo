import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
function legacyConfig(path: string) {
  return JSON.parse(
    readFileSync(path, "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1"),
  );
}
describe("deployment privacy invariants retained during cf migration", () => {
  it("routes all app assets through owner authentication and has no public alternate endpoint", () => {
    const c = legacyConfig("apps/api/wrangler.jsonc");
    expect(c.main).toBe("src/worker.ts");
    expect(c.assets.directory).toBe("../web/dist");
    expect(c.d1_databases[0].migrations_dir).toBe("migrations");
    expect(c.assets.run_worker_first).toBe(true);
    expect(c.assets.binding).toBe("ASSETS");
    expect(c.workers_dev).toBe(false);
    expect(c.preview_urls).toBe(false);
    expect(c.observability.enabled).toBe(false);
    expect(c.d1_databases[0].binding).toBe("DB");
    expect(c.r2_buckets[0].binding).toBe("FILES");
  });
  it("keeps the AI bridge private and preserves its SQLite namespace and single Container", () => {
    const c = legacyConfig("apps/bridge/wrangler.jsonc");
    expect(c.workers_dev).toBe(false);
    expect(c.preview_urls).toBe(false);
    expect(c.routes ?? []).toHaveLength(0);
    expect(c.observability.enabled).toBe(false);
    expect(c.containers).toHaveLength(1);
    expect(c.containers[0]).toMatchObject({
      class_name: "SaldoAI",
      instance_type: "lite",
      max_instances: 1,
      image_build_context: "../..",
    });
    expect(c.durable_objects.bindings).toEqual([
      { name: "SALDO_AI", class_name: "SaldoAI" },
    ]);
    expect(c.migrations[0].new_sqlite_classes).toEqual(["SaldoAI"]);
  });
});

import config, {
  appWorker,
  bridgeWorker,
  inference,
} from "../deployment/cloudflare.config";
it("cf definitions preserve protected assets and resource identities", () => {
  const old = legacyConfig("apps/api/wrangler.jsonc");
  expect(appWorker.name).toBe(old.name);
  expect(appWorker.entrypoint).toBe("../apps/api/" + old.main);
  expect(appWorker.workersDev).toBe(false);
  expect(appWorker.previewUrls).toBe(false);
  expect(appWorker.assets.runWorkerFirst).toBe(true);
  expect(appWorker.env.DB).toMatchObject({
    name: "saldo",
    id: old.d1_databases[0].database_id,
  });
  expect(appWorker.env.FILES).toMatchObject({ name: "saldo-private" });
});
it("cf bridge preserves class name, private endpoints and bounded Container", () => {
  expect(bridgeWorker.name).toBe("saldo-ai-bridge");
  expect(bridgeWorker.workersDev).toBe(false);
  expect(bridgeWorker.previewUrls).toBe(false);
  expect(bridgeWorker.exports.SaldoAI).toMatchObject({ storage: "sqlite" });
  expect(bridgeWorker.exports.SaldoAI).toMatchObject({ container: inference });
  expect(inference).toMatchObject({
    instanceType: "lite",
    maxInstances: 1,
    image: { dockerfile: "../apps/bridge/Dockerfile", buildContext: ".." },
  });
});
it("cf selection requires explicit mode and rejects public previews", () => {
  expect(() => config({ mode: undefined, isPreview: false })).toThrow("Choose");
  expect(() => config({ mode: "bridge", isPreview: true })).toThrow("previews");
  expect(config({ mode: "app", isPreview: false })).toEqual({
    worker: appWorker,
  });
  expect(config({ mode: "bridge", isPreview: false })).toEqual({
    worker: bridgeWorker,
    containers: [inference],
  });
});
