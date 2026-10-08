import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  // `cf build` builds the Worker (cloudflare.ts) with the Cloudflare plugin,
  // which reads cloudflare.config.ts. Vitest and `vp pack` do not load it.
  plugins: lazyPlugins(async () => {
    if (process.env.VITEST) return [];
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    return [cloudflare()];
  }),
  // The Node container image runs one self-contained ESM bundle. Workspace
  // domain code and zod are inlined so the runtime image needs no node_modules.
  pack: {
    entry: { container: "container.ts" },
    platform: "node",
    target: "node24",
    format: "esm",
    outDir: "dist",
    dts: false,
    deps: {
      alwaysBundle: ["@saldo/domain", "zod"],
      onlyBundle: ["zod"],
    },
  },
});
