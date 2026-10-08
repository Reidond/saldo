import { Elysia } from "elysia";
import type { Services } from "../services";
import { UnauthenticatedError } from "./errors";

/** Everything a route may use for one request. */
export interface RequestScope {
  services: Services;
  appOrigin: string;
  /** The protected web build. */
  assets: Pick<Fetcher, "fetch">;
}

/** Supplied by the composition root; tests pass fakes. */
export type ScopeResolver = (request: Request) => RequestScope;

export const accessTokenOf = (request: Request) =>
  request.headers.get("Cf-Access-Jwt-Assertion");

/** Routes that answer without a signed-in owner (only /api/status). */
export function publicApp(scopeOf: ScopeResolver) {
  return new Elysia().resolve(({ request }) => ({ scope: scopeOf(request) }));
}

/**
 * Every route registered on this instance requires a verified owner Access
 * token, and fails with 401 before the handler (or body reading) runs.
 */
export function ownerApp(scopeOf: ScopeResolver) {
  return new Elysia().resolve(async ({ request }) => {
    const scope = scopeOf(request);
    const principal = await scope.services.identity.authenticate(
      accessTokenOf(request),
    );
    if (!principal) throw new UnauthenticatedError();
    return { scope, principal };
  });
}

/**
 * Owner routes that act on account data: the signed-in user is resolved
 * (and provisioned on first use) before the handler runs.
 */
export function actorApp(scopeOf: ScopeResolver) {
  return ownerApp(scopeOf).resolve(async ({ scope, principal }) => ({
    actor: await scope.services.identity.resolveActor(principal),
  }));
}

export type PublicApp = ReturnType<typeof publicApp>;
export type OwnerApp = ReturnType<typeof ownerApp>;
export type ActorApp = ReturnType<typeof actorApp>;
