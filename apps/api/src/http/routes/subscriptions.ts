import { SubscriptionNotFoundError } from "../../services/errors";
import { objectFields, readBody } from "../body";
import type { ActorApp } from "../context";
import { json, notFound } from "../responses";

const itemPrefix = "/api/subscriptions/";

/**
 * Decodes the id from the raw path rather than Elysia's params, so a
 * malformed escape is rejected as invalid input instead of becoming null.
 */
const subscriptionId = (path: string) =>
  decodeURIComponent(path.slice(itemPrefix.length));

export function subscriptionRoutes(app: ActorApp) {
  app.get("/api/subscriptions", async ({ scope, actor }) =>
    json({ subscriptions: await scope.services.subscriptions.list(actor) }),
  );
  app.head("/api/subscriptions", notFound);

  app.post("/api/subscriptions", async ({ request, scope, actor }) => {
    const fields = objectFields(await readBody(request));
    return json(
      {
        subscription: await scope.services.subscriptions.create(actor, fields),
      },
      201,
    );
  });

  app.patch(
    "/api/subscriptions/:id",
    async ({ request, path, scope, actor }) => {
      const id = subscriptionId(path);
      const { subscriptions } = scope.services;
      // An unknown id is answered before the body is read.
      if (!(await subscriptions.find(actor, id)))
        throw new SubscriptionNotFoundError();
      const changes = objectFields(await readBody(request));
      return json({
        subscription: await subscriptions.update(actor, id, changes),
      });
    },
  );

  app.delete("/api/subscriptions/:id", async ({ path, scope, actor }) => {
    await scope.services.subscriptions.remove(actor, subscriptionId(path));
    return json({ deleted: true });
  });

  // Other methods: 404 that says whether the subscription exists.
  app.all("/api/subscriptions/:id", async ({ path, scope, actor }) => {
    if (!(await scope.services.subscriptions.find(actor, subscriptionId(path))))
      throw new SubscriptionNotFoundError();
    return notFound();
  });
}
