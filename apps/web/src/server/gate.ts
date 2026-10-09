import "server-only";
import type { JWTVerifyGetKey } from "jose";
import { readPreferences } from "../lib/preferences";
import { verifyAccess } from "./access";
import { apiClientFor } from "./api";
import { resolveConfig, type WebEnv } from "./config";
import {
  createRequestContext,
  runWithContext,
  type RequestContext,
} from "./context";
import { isAssetPath, serveAsset } from "./http";
import { handleChat } from "./routes/chat";
import { handleExport } from "./routes/export";
import { staticPage } from "./static-pages";

export type GateResult =
  | { kind: "response"; response: Response }
  | { kind: "render"; context: RequestContext; origin: string };

/**
 * Everything that happens before React renders, for every request including
 * static assets: pick the data source (failing closed), verify the Access
 * identity, then answer assets and route handlers. Only an authenticated
 * request gets a RequestContext, so no page or action can run without one.
 */
export async function gate(
  request: Request,
  env: WebEnv,
  {
    allowSynthetic,
    accessKeys,
  }: {
    allowSynthetic: boolean;
    /** Tests only: verify tokens against local keys instead of the team's. */
    accessKeys?: JWTVerifyGetKey;
  },
): Promise<GateResult> {
  const resolved = resolveConfig(env, { allowSynthetic });
  if (!resolved.ok) {
    console.error(`saldo-web is not configured: ${resolved.reason}`);
    return { kind: "response", response: staticPage("unconfigured", 503) };
  }
  const { config } = resolved;
  let assertion = "synthetic-development-session";
  if (config.mode === "api") {
    const identity = await verifyAccess(request, config.access, accessKeys);
    if (!identity)
      return { kind: "response", response: staticPage("signed-out", 401) };
    assertion = identity.assertion;
  }
  const url = new URL(request.url);
  if (
    config.assets &&
    isAssetPath(url.pathname) &&
    (request.method === "GET" || request.method === "HEAD")
  )
    return {
      kind: "response",
      response: await serveAsset(config.assets, request),
    };

  const origin = config.mode === "api" ? config.appOrigin : url.origin;
  const context = createRequestContext({
    url,
    api: await apiClientFor(config, {
      assertion,
      requestId: crypto.randomUUID(),
    }),
    dataSource: config.mode,
    preferences: readPreferences(request.headers.get("Cookie")),
    secureCookies: url.protocol === "https:",
  });
  if (url.pathname === "/chat/messages")
    return {
      kind: "response",
      response: await runWithContext(context, () =>
        handleChat(request, origin),
      ),
    };
  if (url.pathname.startsWith("/settings/export."))
    return {
      kind: "response",
      response: await runWithContext(context, () => handleExport(request, url)),
    };
  return { kind: "render", context, origin };
}
