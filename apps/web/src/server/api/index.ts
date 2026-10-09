import "server-only";
import type { WebConfig } from "../config";
import { createBindingApiClient } from "./binding";
import type { ApiClient } from "./client";

export * from "./client";

let syntheticClient: Promise<ApiClient> | undefined;

/**
 * The ApiClient for one authenticated request. Synthetic data is compiled into
 * development builds only: production bundles do not contain that module.
 */
export async function apiClientFor(
  config: WebConfig,
  request: { assertion: string; requestId: string },
): Promise<ApiClient> {
  if (config.mode === "api")
    return createBindingApiClient({
      api: config.api,
      assertion: request.assertion,
      origin: config.appOrigin,
      requestId: request.requestId,
    });
  if (!import.meta.env.DEV)
    throw new Error("Synthetic data is not available in production builds.");
  // One store per dev server, so edits survive navigation and reloads.
  syntheticClient ??= import("./synthetic").then((m) =>
    m.createSyntheticApiClient({
      ai: config.ai,
      seed: config.scenario === "empty" ? [] : undefined,
      down: config.scenario === "api-down",
    }),
  );
  return syntheticClient;
}
