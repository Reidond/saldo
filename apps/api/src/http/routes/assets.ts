import type { OwnerApp } from "../context";
import { protectedAsset } from "../responses";

/** The web build, served only to the verified owner (run_worker_first). */
export function assetRoutes(app: OwnerApp) {
  app.all("/*", async ({ request, scope }) =>
    protectedAsset(await scope.assets.fetch(request)),
  );
}
