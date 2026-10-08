import { defineWranglerConfig } from "wrangler/experimental-config";
export default defineWranglerConfig(({ mode }) => ({
  types: { generate: false },
  sendMetrics: false,
  tsconfig: "../tsconfig.json",
  ...(mode === "app" ? { assetsDirectory: "../dist" } : {}),
}));
