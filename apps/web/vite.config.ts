import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";

const stub = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: lazyPlugins(async () => {
    const { default: react } = await import("@vitejs/plugin-react");
    // Vitest renders client components in jsdom and calls server modules
    // directly, so it needs neither the RSC environments nor workerd.
    if (process.env.VITEST) return [react()];
    const [{ default: rsc }, { cloudflare }, { default: tailwindcss }] =
      await Promise.all([
        import("@vitejs/plugin-rsc"),
        import("@cloudflare/vite-plugin"),
        import("@tailwindcss/vite"),
      ]);
    const text = (value: string) => ({ type: "text" as const, value });
    return [
      tailwindcss(),
      rsc(),
      react(),
      // Reads the Worker from cloudflare.config.ts.
      cloudflare({
        // `ssr` runs inside the same Worker as `rsc`.
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        // `vp dev` and `cf dev` only: serve synthetic data without an API
        // Worker or Access, and let Vite answer its own module requests
        // before the Worker. Builds never get these settings, and the runtime
        // refuses synthetic data outside a Vite dev server (see
        // src/server/config.ts). Merged over cloudflare.config.ts.
        config:
          command === "serve"
            ? {
                assets: { runWorkerFirst: false },
                env: {
                  SALDO_DATA_SOURCE: text("synthetic"),
                  SALDO_SYNTHETIC_AI: text(
                    process.env.SALDO_SYNTHETIC_AI ?? "available",
                  ),
                  SALDO_SYNTHETIC_SCENARIO: text(
                    process.env.SALDO_SYNTHETIC_SCENARIO ?? "sample",
                  ),
                },
              }
            : undefined,
      }),
    ];
  }),
  environments: {
    ssr: {
      // The Cloudflare plugin writes it next to the rsc bundle, inside the
      // Worker's Build Output (.cloudflare/output/v0/workers/default/bundle).
      build: {
        rollupOptions: { input: { index: "./src/framework/entry.ssr.tsx" } },
      },
      optimizeDeps: { entries: ["./src/framework/entry.ssr.tsx"] },
    },
    client: {
      build: {
        rollupOptions: {
          input: { index: "./src/framework/entry.browser.tsx" },
        },
      },
    },
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  test: {
    alias: { "server-only": stub("./tests/support/server-only.ts") },
  },
}));
