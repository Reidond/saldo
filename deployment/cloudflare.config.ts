import {
  bindings,
  defineConfig,
  defineContainer,
  defineWorker,
  exports,
} from "cf/config";
export const inference = defineContainer({
  name: "saldo-ai-bridge-saldoai",
  image: { dockerfile: "../bridge/Dockerfile", buildContext: ".." },
  instanceType: "lite",
  maxInstances: 1,
  observability: { enabled: false },
});
export const appWorker = defineWorker({
  name: "saldo",
  entrypoint: "../server/worker.ts",
  compatibilityDate: "2026-10-01",
  workersDev: false,
  previewUrls: false,
  observability: { enabled: false },
  assets: { runWorkerFirst: true },
  env: {
    APP_ORIGIN: bindings.text("http://localhost:8787"),
    DB: bindings.d1({
      name: "saldo",
      id: "00000000-0000-0000-0000-000000000000",
    }),
    FILES: bindings.r2({ name: "saldo-private" }),
    ASSETS: bindings.assets(),
  },
});
export const bridgeWorker = defineWorker({
  name: "saldo-ai-bridge",
  entrypoint: "../bridge/cloudflare.ts",
  compatibilityDate: "2026-10-08",
  compatibilityFlags: ["nodejs_compat"],
  workersDev: false,
  previewUrls: false,
  observability: { enabled: false },
  exports: {
    SaldoAI: exports.durableObject({ storage: "sqlite", container: inference }),
  },
  env: {
    SALDO_AI: bindings.durableObject({
      worker: "saldo-ai-bridge",
      exportName: "SaldoAI",
    }),
  },
});
export default defineConfig(({ mode, isPreview }) => {
  if (isPreview)
    throw new Error(
      "Saldo previews are disabled. Use an approved private deployment.",
    );
  if (mode === "app") return { worker: appWorker };
  if (mode === "bridge")
    return { worker: bridgeWorker, containers: [inference] };
  throw new Error("Choose --mode app or --mode bridge explicitly.");
});
