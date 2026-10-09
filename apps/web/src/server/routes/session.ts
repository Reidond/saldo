import "server-only";
import { isApiError } from "../api";
import { getRequestContext } from "../context";
import { json, sameOrigin } from "../http";

/**
 * POST /session/sign-out: ends the owner's Saldo sessions through the API,
 * so tokens Access already issued stop working at once. The browser then
 * goes to the Cloudflare Access logout whatever this answers, which is why
 * sign-out is a route handler rather than a server action: it must never
 * wait for a session that has already ended.
 */
export async function handleSignOut(request: Request, origin: string) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!sameOrigin(request, origin))
    return json({ error: "Changes are only accepted from Saldo itself." }, 403);
  try {
    await getRequestContext().api.signOut();
    return json({ signedOut: true });
  } catch (error) {
    const expired = isApiError(error) && error.code === "unauthenticated";
    return json(
      {
        signedOut: expired,
        code: isApiError(error) ? error.code : "unavailable",
      },
      expired ? 401 : 502,
    );
  }
}
