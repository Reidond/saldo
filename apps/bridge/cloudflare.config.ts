// The private AI bridge: a Worker with no public route that forwards
// owner-authenticated requests to one lite Container behind the SQLite-backed
// `SaldoAI` Durable Object. Converted from wrangler.jsonc by hand along cf's
// documented field mapping; the Worker is built with Vite (vite.config.ts) and
// the Container image from ./Dockerfile with the repository root as context.
import { bindings, defineConfig, defineContainer, exports } from "cf/config";

// The name of the Container application that Wrangler created for SaldoAI;
// keep it so deploys update that application instead of creating another.
export const inference = defineContainer({
  name: "saldo-ai-bridge-saldoai",
  image: { dockerfile: "./Dockerfile", buildContext: "../.." },
  instanceType: "lite",
  maxInstances: 1,
});

export default defineConfig(({ isPreview }) => {
  // Worker previews cannot run Durable Object-managed Containers anyway.
  if (isPreview)
    throw new Error("Saldo has no Worker previews. Deploy a reviewed release.");
  return {
    worker: {
      name: "saldo-ai-bridge",
      entrypoint: "./cloudflare.ts",
      compatibilityDate: "2026-10-08",
      compatibilityFlags: ["nodejs_compat"],
      workersDev: false,
      previewUrls: false,
      observability: { enabled: false },
      // Replaces the Wrangler migration history (v1: new_sqlite_classes
      // SaldoAI). The namespace is live, so it is declared, never recreated.
      exports: {
        SaldoAI: exports.durableObject({
          storage: "sqlite",
          container: inference,
        }),
      },
      // AI_BRIDGE_SECRET, SIWC_STATE_KEY and the SIWC_BOOTSTRAP_* import
      // chunks are Worker secrets (docs/SIWC.md), kept across deploys.
      env: {
        SALDO_AI: bindings.durableObject({
          worker: "saldo-ai-bridge",
          exportName: "SaldoAI",
        }),
      },
    },
    containers: [inference],
  };
});
