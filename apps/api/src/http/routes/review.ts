import { reviewSchema } from "@saldo/domain";
import { readBody } from "../body";
import type { ActorApp } from "../context";
import { json } from "../responses";

export function reviewRoutes(app: ActorApp) {
  app.post("/api/review", async ({ request, scope, actor }) => {
    const review = reviewSchema.parse(await readBody(request));
    return json(await scope.services.reviews.apply(actor, review));
  });
}
