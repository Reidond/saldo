import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  // `cf dev` and `cf build` run Vite with the Cloudflare plugin, which reads
  // cloudflare.config.ts. Vitest calls the modules directly and needs neither.
  plugins: lazyPlugins(async () => {
    if (process.env.VITEST) return [];
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    return [cloudflare()];
  }),
  server: { host: "127.0.0.1", port: 8787, strictPort: true },
  test: {
    // Suites that use a real local D1 start workerd in beforeAll.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
