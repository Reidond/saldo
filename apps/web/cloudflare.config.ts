// The web Worker: React Server Components + SSR and the protected static
// assets. It holds no data; it calls the API Worker over the `API` service
// binding. Built by `cf build` (Vite and the Cloudflare Vite plugin, see
// vite.config.ts) and deployed separately from apps/api.
import { bindings, defineConfig } from "cf/config";

// Only the deploy job sets SALDO_RELEASE=production. A release build takes the
// account's identifiers from the protected GitHub Environment and refuses to
// build without them, because `cf deploy` replaces every var a version does not
// declare. Any other build gets the dev origin and no Access settings, so it
// answers 503 to everything (see src/server/config.ts).
function setting(name: string, local: string) {
  if (process.env.SALDO_RELEASE !== "production") return local;
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a release build.`);
  return value;
}

export default defineConfig(({ isPreview }) => {
  if (isPreview)
    throw new Error("Saldo has no Worker previews. Deploy a reviewed release.");
  const release = process.env.SALDO_RELEASE === "production";
  return {
    worker: {
      name: "saldo-web",
      entrypoint: "./src/framework/entry.rsc.tsx",
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      workersDev: false,
      previewUrls: false,
      observability: { enabled: false },
      // Every request, assets included, reaches the Worker first so nothing
      // is served without a verified Access token. The Vite plugin supplies
      // the assets (dist/client).
      assets: { runWorkerFirst: true },
      env: {
        ASSETS: bindings.assets(),
        API: bindings.worker({ worker: "saldo-api" }),
        APP_ORIGIN: bindings.text(
          setting("SALDO_APP_ORIGIN", "http://127.0.0.1:5173"),
        ),
        ...(release && {
          ACCESS_TEAM_DOMAIN: bindings.text(
            setting("SALDO_ACCESS_TEAM_DOMAIN", ""),
          ),
          ACCESS_AUD: bindings.text(setting("SALDO_ACCESS_AUD", "")),
        }),
      },
    },
  };
});
