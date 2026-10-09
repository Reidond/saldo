import "server-only";
import type { JWTVerifyGetKey } from "jose";
import { SIGN_OUT_HREF } from "../app/routes";
import { readPreferences } from "../lib/preferences";
import { verifyAccess } from "./access";
import { apiClientFor, isApiError } from "./api";
import { resolveConfig, type WebEnv } from "./config";
import {
  createRequestContext,
  runWithContext,
  type RequestContext,
} from "./context";
import { isAssetPath, serveAsset } from "./http";
import { handleChat } from "./routes/chat";
import { handleExport } from "./routes/export";
import { handleSignOut } from "./routes/session";
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
  // In production Cloudflare answers /cdn-cgi/ itself; the dev server shows
  // what a signed-out visitor would see.
  if (config.mode === "synthetic" && url.pathname === SIGN_OUT_HREF)
    return { kind: "response", response: staticPage("signed-out", 401) };
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
  if (url.pathname === "/session/sign-out")
    return {
      kind: "response",
      response: await runWithContext(context, () =>
        handleSignOut(request, origin),
      ),
    };
  const refused = await refusedSession(context);
  if (refused) return { kind: "response", response: refused };
  return { kind: "render", context, origin };
}

/**
 * Pages and server actions run only for a session the API accepts. A token
 * that verifies here can still be refused there (signed out, disabled): that
 * gets one static page instead of a shell rendered around failed reads, and
 * a server action never runs. Other failures (the API is down) render, and
 * each page shows its own error state.
 */
async function refusedSession(context: RequestContext) {
  try {
    await context.load.me();
    return null;
  } catch (error) {
    if (!isApiError(error)) return null;
    if (error.code === "unauthenticated")
      return staticPage("session-ended", 401);
    if (error.code === "forbidden") return staticPage("denied", 403);
    return null;
  }
}
