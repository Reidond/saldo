import type { ActorApp } from "../context";
import { json } from "../responses";

export function sessionRoutes(app: ActorApp) {
  // Ends the owner's Saldo sessions at once; the web then sends the browser
  // to the Cloudflare Access logout, which ends the Access session itself.
  app.post("/api/session/sign-out", async ({ scope, actor }) => {
    await scope.services.identity.signOut(actor);
    return json({ signedOut: true });
  });
}
