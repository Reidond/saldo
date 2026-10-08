import type { ActorApp } from "../context";
import { json, notFound } from "../responses";

export function meRoutes(app: ActorApp) {
  app.get("/api/me", ({ scope, actor }) =>
    json({ user: scope.services.identity.describe(actor) }),
  );
  // Elysia would answer HEAD with the GET handler; the API never has.
  app.head("/api/me", notFound);
}
