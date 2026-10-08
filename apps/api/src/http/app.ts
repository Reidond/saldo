import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { actorApp, ownerApp, publicApp, type ScopeResolver } from "./context";
import { errorResponse } from "./errors";
import { isAllowedOrigin } from "./origin";
import { json, notFound } from "./responses";
import { assetRoutes } from "./routes/assets";
import { chatRoutes } from "./routes/chat";
import { meRoutes } from "./routes/me";
import { reviewRoutes } from "./routes/review";
import { statusRoutes } from "./routes/status";
import { subscriptionRoutes } from "./routes/subscriptions";

/**
 * The app Worker's HTTP surface. Compiled once per isolate (Elysia generates
 * its handlers at startup, which Workers allow only outside requests).
 */
export function createApp(scopeOf: ScopeResolver) {
  const open = publicApp(scopeOf);
  statusRoutes(open);

  const api = actorApp(scopeOf);
  meRoutes(api);
  subscriptionRoutes(api);
  reviewRoutes(api);
  chatRoutes(api);
  api.all("/api/*", notFound);

  // Everything else is the protected web build, including "/api" itself.
  const web = ownerApp(scopeOf);
  assetRoutes(web);

  return new Elysia({ adapter: CloudflareAdapter, strictPath: true })
    .onRequest(({ request }) =>
      isAllowedOrigin(request, scopeOf(request).appOrigin)
        ? undefined
        : json({ error: "Origin not allowed" }, 403),
    )
    .onError(({ error }) => errorResponse(error))
    .use(open)
    .use(api)
    .use(web)
    .compile();
}
