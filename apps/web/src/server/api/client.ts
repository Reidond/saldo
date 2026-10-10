import type { Proposal, Subscription } from "@saldo/domain";

/**
 * Everything the web app may ask of the API Worker. Server components, server
 * actions and route handlers reach data only through this interface; the
 * implementation is chosen once per request in src/server/api/index.ts.
 */
export interface ApiClient {
  status(): Promise<ApiStatus>;
  /** The signed-in user (GET /api/me). */
  me(): Promise<Me>;
  /**
   * Ends the owner's Saldo sessions at once (POST /api/session/sign-out):
   * every Access token issued so far is refused from now on.
   */
  signOut(): Promise<void>;
  listSubscriptions(): Promise<Subscription[]>;
  createSubscription(input: SubscriptionInput): Promise<Subscription>;
  updateSubscription(
    id: string,
    input: SubscriptionInput,
  ): Promise<Subscription>;
  deleteSubscription(id: string): Promise<void>;
  /** Atomic and idempotent per `requestId`: a retry never saves twice. */
  saveReview(review: ReviewInput): Promise<ReviewResult>;
  chat(input: ChatInput, signal?: AbortSignal): Promise<ChatResult>;
}

export interface ApiStatus {
  authenticated: boolean;
  aiConnected: boolean;
}

export interface Me {
  id: string;
  email: string | null;
  displayName: string | null;
  /** "owner" today; Saldo has no other roles yet. */
  role: string;
}

export type SubscriptionInput = Omit<Subscription, "id">;

export interface ReviewInput {
  requestId: string;
  proposals: Proposal[];
}

export interface ReviewResult {
  subscriptions: Subscription[];
  alreadySaved: boolean;
}

export interface ChatAttachment {
  name: string;
  type: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
}

export interface ChatInput {
  message: string;
  attachments: ChatAttachment[];
  history: { role: "user" | "assistant"; content: string }[];
}

export interface ChatResult {
  reply: string;
  proposals: Proposal[];
}

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "too_large"
  | "rate_limited"
  | "ai_unavailable"
  | "unavailable"
  | "bad_response";

const defaultMessages: Record<ApiErrorCode, string> = {
  unauthenticated: "Your session expired. Reload to sign in again.",
  forbidden: "This request was refused.",
  not_found: "That record no longer exists.",
  invalid: "Saldo could not accept those details. Nothing was saved.",
  too_large: "That request is too large. Try fewer or smaller images.",
  rate_limited:
    "ChatGPT's usage limit was reached. Try again later; manual entry still works.",
  ai_unavailable:
    "AI is unavailable right now. Nothing was sent or saved; manual entry still works.",
  unavailable:
    "Saldo's data service is unavailable right now. Nothing was changed. Try again shortly.",
  bad_response:
    "Saldo received an unexpected response. Nothing was changed. Try again shortly.",
};

/** A failed API call. `message` is always safe to show to the owner. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string = defaultMessages[code],
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A message for any thrown value, without leaking internals. */
export function errorMessage(error: unknown) {
  return isApiError(error) ? error.message : defaultMessages.unavailable;
}
