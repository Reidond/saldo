import { accessTokenOf, type PublicApp } from "../context";
import { json } from "../responses";

export function statusRoutes(app: PublicApp) {
  // Any method on the exact path. It reveals no data and asks the AI
  // provider only for a verified owner.
  app.all("/api/status", async ({ request, scope }) => {
    const { identity, chat } = scope.services;
    const principal = await identity.authenticate(accessTokenOf(request));
    return json({
      authenticated: principal !== null,
      aiConnected: principal ? (await chat.status()).connected : false,
    });
  });
}
