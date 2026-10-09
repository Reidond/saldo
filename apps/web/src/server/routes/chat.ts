import "server-only";
import { chatSchema } from "@saldo/domain";
import { isApiError, type ApiErrorCode } from "../api";
import { getRequestContext } from "../context";
import { contentLength, json, sameOrigin } from "../http";

export const CHAT_BODY_LIMIT = 12_000_000;

const statusFor: Partial<Record<ApiErrorCode, number>> = {
  unauthenticated: 401,
  invalid: 400,
  too_large: 413,
  rate_limited: 429,
  ai_unavailable: 503,
};

/**
 * POST /chat/messages: one AI turn. A route handler rather than a server
 * action so the browser can cancel it: aborting the fetch aborts the call to
 * the API Worker. It proposes changes only; nothing is saved here.
 */
export async function handleChat(request: Request, origin: string) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!sameOrigin(request, origin))
    return json({ error: "Changes are only accepted from Saldo itself." }, 403);
  if (
    !(request.headers.get("Content-Type") ?? "").startsWith("application/json")
  )
    return json({ error: "Send JSON." }, 415);
  const length = contentLength(request);
  if (length === null)
    return json({ error: "Content-Length is required." }, 411);
  if (length > CHAT_BODY_LIMIT)
    return json(
      { error: "That message is too large. Try fewer or smaller images." },
      413,
    );
  const parsed = chatSchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!parsed.success)
    return json(
      {
        error:
          parsed.error.issues[0]?.message ?? "That message could not be read.",
      },
      400,
    );
  try {
    const { api } = getRequestContext();
    const result = await api.chat(parsed.data, request.signal);
    return json(result);
  } catch (error) {
    if (request.signal.aborted) return json({ error: "Cancelled." }, 499);
    if (isApiError(error))
      return json(
        { error: error.message, code: error.code },
        statusFor[error.code] ?? 502,
      );
    return json(
      { error: "ChatGPT could not complete this request. Nothing was saved." },
      502,
    );
  }
}
