import { accessTokenOf, type PublicApp } from "../context";
import { json } from "../responses";

export function statusRoutes(app: PublicApp) {
  // Any method on the exact path. It reveals no data and asks the AI
  // provider only for a signed-in owner. "Signed in" is what the /api/*
  // guards would decide, so a signed-out or disabled user is never told
  // otherwise; the check reads the database but never writes to it.
  app.all("/api/status", async ({ request, scope }) => {
    const { identity, chat } = scope.services;
    const authenticated = await identity.isSignedIn(accessTokenOf(request));
    return json({
      authenticated,
      aiConnected: authenticated ? (await chat.status()).connected : false,
    });
  });
}
