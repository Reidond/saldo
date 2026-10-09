import { defineConfig } from "vite-plus";

export default defineConfig({
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
