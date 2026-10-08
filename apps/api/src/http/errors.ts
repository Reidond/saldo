import {
  AccessDeniedError,
  AiNotConnectedError,
  AiRequestFailedError,
  SessionEndedError,
  SubscriptionNotFoundError,
} from "../services/errors";
import { PayloadTooLarge } from "./body";
import { json } from "./responses";

/** No valid owner Access token was presented. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated");
  }
}

export const privateInstanceMessage =
  "Private Saldo instance. Configure Cloudflare Access and sign in as the owner.";

const invalidMessage =
  "Invalid data or unavailable storage. No unreviewed changes were saved.";

/** Maps anything a route throws to the JSON error contract. */
export function errorResponse(error: unknown): Response {
  if (
    error instanceof UnauthenticatedError ||
    error instanceof SessionEndedError
  )
    return json({ error: privateInstanceMessage }, 401);
  if (error instanceof AccessDeniedError)
    return json({ error: "This Saldo instance is private." }, 403);
  if (error instanceof SubscriptionNotFoundError)
    return json({ error: "Subscription not found" }, 404);
  if (error instanceof PayloadTooLarge)
    return json({ error: "Request exceeds upload limit" }, 413);
  if (error instanceof AiNotConnectedError)
    return json(
      {
        error:
          "ChatGPT is not connected. Your message and screenshots have not been sent to an AI provider.",
      },
      503,
    );
  if (error instanceof AiRequestFailedError)
    return json(
      {
        error:
          "ChatGPT could not complete this request. Nothing was saved. Check your private connection and try again.",
      },
      error.rateLimited ? 429 : 503,
    );
  // Review conflicts from @saldo/domain explain themselves; every other
  // failure (validation, malformed JSON, storage) gets the generic message.
  const message = error instanceof Error ? error.message : "Invalid request";
  return json(
    {
      error:
        message.includes("duplicate") ||
        message.includes("Duplicate") ||
        message.includes("target")
          ? message
          : invalidMessage,
    },
    400,
  );
}
