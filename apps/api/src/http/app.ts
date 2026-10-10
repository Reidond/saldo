import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { WebStandardAdapter } from "elysia/adapter/web-standard";
import { actorApp, ownerApp, publicApp, type ScopeResolver } from "./context";
import { errorResponse } from "./errors";
import { isAllowedOrigin } from "./origin";
import { json, notFound } from "./responses";
import { chatRoutes } from "./routes/chat";
import { meRoutes } from "./routes/me";
import { reviewRoutes } from "./routes/review";
import { sessionRoutes } from "./routes/session";
import { statusRoutes } from "./routes/status";
import { subscriptionRoutes } from "./routes/subscriptions";

/**
 * Workers allow code generation only while the script starts, which is when a
 * deployed Worker compiles this app. `cf dev` (the Cloudflare Vite plugin)
 * evaluates modules later, inside a runner object, where `new Function`
 * throws. There the app uses Elysia's dynamic handlers and the web-standard
 * adapter, because the Cloudflare adapter generates code even without AOT.
 */
function codeGenerationAllowed() {
  try {
    // oxlint-disable-next-line typescript/no-implied-eval -- a probe, never called
    new Function("");
    return true;
  } catch {
    return false;
  }
}

/**
 * The app Worker's HTTP surface. Compiled once per isolate (Elysia generates
 * its handlers at startup, which Workers allow only outside requests).
 */
export function createApp(scopeOf: ScopeResolver) {
  const open = publicApp(scopeOf);
  statusRoutes(open);

  const api = actorApp(scopeOf);
  meRoutes(api);
  sessionRoutes(api);
  subscriptionRoutes(api);
  reviewRoutes(api);
  chatRoutes(api);
  api.all("/api/*", notFound);

  // Nothing else exists here, "/api" itself included: the web Worker serves
  // the pages and assets and calls this Worker only over its service binding.
  // The owner check still runs first, so anonymous requests get 401.
  const rest = ownerApp(scopeOf);
  rest.all("/*", notFound);

  const aot = codeGenerationAllowed();
  return new Elysia({
    adapter: aot ? CloudflareAdapter : WebStandardAdapter,
    aot,
    strictPath: true,
  })
    .onRequest(({ request }) =>
      isAllowedOrigin(request, scopeOf(request).appOrigin)
        ? undefined
        : json({ error: "Origin not allowed" }, 403),
    )
    .onError(({ error }) => errorResponse(error))
    .use(open)
    .use(api)
    .use(rest)
    .compile();
}
