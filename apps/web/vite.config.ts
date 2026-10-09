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
    return [
      tailwindcss(),
      rsc(),
      react(),
      cloudflare({
        // `ssr` runs inside the same Worker as `rsc`.
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        // `vp dev` only: serve synthetic data without an API Worker or Access,
        // and let Vite answer its own module requests before the Worker.
        // Builds never get these settings, and the runtime refuses synthetic
        // data outside a Vite dev server (see src/server/config.ts).
        config:
          command === "serve"
            ? {
                assets: { binding: "ASSETS", run_worker_first: false },
                vars: {
                  SALDO_DATA_SOURCE: "synthetic",
                  SALDO_SYNTHETIC_AI:
                    process.env.SALDO_SYNTHETIC_AI ?? "available",
                  SALDO_SYNTHETIC_SCENARIO:
                    process.env.SALDO_SYNTHETIC_SCENARIO ?? "sample",
                },
              }
            : undefined,
      }),
    ];
  }),
  environments: {
    ssr: {
      build: {
        // Inside dist/rsc so the deployable Worker directory is self-contained.
        outDir: "./dist/rsc/ssr",
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
