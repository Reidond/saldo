// Composition root of the API Worker: the only module that reads bindings
// and wires adapters, repositories and services into the HTTP layer.
import { createApp } from "./http/app";
import type { RequestScope } from "./http/context";
import { createAccessTokenVerifier } from "./infrastructure/access-verifier";
import { createBridgeAiProvider } from "./infrastructure/ai/bridge-provider";
import { disabledAiProvider } from "./infrastructure/ai/disabled-provider";
import { randomIds, systemClock } from "./infrastructure/system";
import { repositories } from "./repositories";
import { createServices } from "./services";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Private AI bridge service binding; without it AI is unavailable. */
  AI?: Fetcher;
  AI_BRIDGE_SECRET?: string;
  APP_ORIGIN: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_SUB?: string;
}

const verifier = createAccessTokenVerifier();

export function createScope(env: Env): RequestScope {
  return {
    services: createServices({
      db: env.DB,
      repos: repositories,
      verifier,
      ai: env.AI
        ? createBridgeAiProvider(env.AI, env.AI_BRIDGE_SECRET)
        : disabledAiProvider,
      clock: systemClock,
      ids: randomIds,
      identity: {
        teamDomain: env.ACCESS_TEAM_DOMAIN,
        audience: env.ACCESS_AUD,
        ownerSubject: env.OWNER_SUB,
      },
    }),
    appOrigin: env.APP_ORIGIN,
  };
}

// Bindings arrive per request, while the Elysia app is compiled once at
// startup, so each request carries its scope to the app through this map.
const scopes = new WeakMap<Request, RequestScope>();
const app = createApp((request) => {
  const scope = scopes.get(request);
  if (!scope) throw new Error("Request scope missing");
  return scope;
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    scopes.set(request, createScope(env));
    return Promise.resolve(app.fetch(request));
  },
};
