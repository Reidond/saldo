import { defineWranglerConfig } from "wrangler/experimental-config";
export default defineWranglerConfig(({ mode }) => ({
  types: { generate: false },
  sendMetrics: false,
  tsconfig:
    mode === "app"
      ? "../apps/api/tsconfig.json"
      : "../apps/bridge/tsconfig.json",
  ...(mode === "app" ? { assetsDirectory: "../apps/web/dist" } : {}),
}));
