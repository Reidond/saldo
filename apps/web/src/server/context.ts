import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Subscription } from "@saldo/domain";
import type { Preferences } from "../lib/preferences";
import type { ApiClient, ApiStatus, Me } from "./api/client";

/**
 * Per-request state for server components and server actions. Created by the
 * rsc entry after authentication, so nothing below it can run without one.
 */
export interface RequestContext {
  url: URL;
  api: ApiClient;
  dataSource: "api" | "synthetic";
  preferences: Preferences;
  /** Cookies and other headers that actions add to the response. */
  responseHeaders: Headers;
  secureCookies: boolean;
  /** Memoized reads, shared by the shell and the page within one request. */
  load: {
    status: () => Promise<ApiStatus>;
    me: () => Promise<Me>;
    subscriptions: () => Promise<Subscription[]>;
  };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(
  init: Omit<RequestContext, "load" | "responseHeaders">,
): RequestContext {
  const once = <T>(load: () => Promise<T>) => {
    let promise: Promise<T> | undefined;
    return () => (promise ??= load());
  };
  return {
    ...init,
    responseHeaders: new Headers(),
    load: {
      status: once(() => init.api.status()),
      me: once(() => init.api.me()),
      subscriptions: once(() => init.api.listSubscriptions()),
    },
  };
}

export function runWithContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work);
}

export function getRequestContext(): RequestContext {
  const context = storage.getStore();
  if (!context) throw new Error("No request context: call within a request.");
  return context;
}

/** Drop memoized reads after a write, so the re-render shows fresh data. */
export function invalidate(context: RequestContext) {
  const fresh = createRequestContext(context);
  context.load = fresh.load;
}
