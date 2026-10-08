// The app Worker (Elysia): owner authentication and /api. Converted from
// wrangler.jsonc by hand along cf's documented field mapping, and built with
// Vite and the Cloudflare Vite plugin (see vite.config.ts).
//
// D1 migrations live in ./migrations; apply them with
// `cf d1 migrations apply <DATABASE_ID> --dir migrations` (`pnpm db:migrate`
// applies them locally).
import { bindings, defineConfig } from "cf/config";

// Only the deploy job sets SALDO_RELEASE=production. A release build takes the
// account's identifiers from the protected GitHub Environment and refuses to
// build without them, because `cf deploy` replaces every var a version does not
// declare. Any other build uses local placeholders and no Access settings, so
// a stray deploy of it fails closed (every protected request gets 401).
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
      name: "saldo",
      entrypoint: "./src/worker.ts",
      compatibilityDate: "2026-10-01",
      workersDev: false,
      previewUrls: false,
      observability: { enabled: false },
      env: {
        APP_ORIGIN: bindings.text(
          setting("SALDO_APP_ORIGIN", "http://localhost:8787"),
        ),
        ...(release && {
          ACCESS_TEAM_DOMAIN: bindings.text(
            setting("SALDO_ACCESS_TEAM_DOMAIN", ""),
          ),
          ACCESS_AUD: bindings.text(setting("SALDO_ACCESS_AUD", "")),
          OWNER_SUB: bindings.text(setting("SALDO_OWNER_SUB", "")),
        }),
        DB: bindings.d1({
          name: "saldo",
          id: setting(
            "SALDO_D1_DATABASE_ID",
            "00000000-0000-4000-8000-000000000000",
          ),
        }),
        FILES: bindings.r2({ name: "saldo-private" }),
        // The private AI bridge; AI_BRIDGE_SECRET is a Worker secret.
        AI: bindings.worker({ worker: "saldo-ai-bridge" }),
      },
    },
  };
});
