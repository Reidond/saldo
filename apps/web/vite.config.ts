import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: lazyPlugins(() => [react()]),
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  build: { outDir: "dist" },
});
