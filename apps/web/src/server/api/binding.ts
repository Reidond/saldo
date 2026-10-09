import "server-only";
import { proposalSchema, subscriptionSchema } from "@saldo/domain";
import { z, type ZodType } from "zod";
import {
  ApiError,
  type ApiClient,
  type ApiErrorCode,
  type ChatInput,
  type Me,
  type ReviewInput,
  type SubscriptionInput,
} from "./client";

/** A Worker service binding (`env.API`): only `fetch` is used. */
export interface ServiceFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface BindingClientOptions {
  api: ServiceFetcher;
  /** The verified Cloudflare Access JWT of the current request. */
  assertion: string;
  /** Sent as `Origin` on writes, which the API requires. */
  origin: string;
  requestId: string;
  timeoutMs?: number;
}

const statusSchema = z.object({
  authenticated: z.boolean(),
  aiConnected: z.boolean(),
});
// GET /api/me, added by the backend layer (apps/api README).
const meSchema = z
  .object({
    user: z.object({
      id: z.string().min(1),
      email: z.string().nullable(),
      displayName: z.string().nullable(),
      role: z.string().min(1),
    }),
  })
  .transform((v): Me => v.user);
const listSchema = z.object({ subscriptions: z.array(subscriptionSchema) });
const oneSchema = z.object({ subscription: subscriptionSchema });
const deletedSchema = z.object({ deleted: z.literal(true) });
const reviewSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
  alreadySaved: z.boolean().optional(),
});
const chatSchema = z.object({
  reply: z.string(),
  proposals: z.array(proposalSchema),
});
const errorBodySchema = z.object({ error: z.string().max(500) });

const CHAT_TIMEOUT_MS = 185_000;

/**
 * The production ApiClient: calls the API Worker over its service binding,
 * forwarding the verified Access assertion. It never forwards the browser's
 * cookies, and validates every response body before returning it.
 */
export function createBindingApiClient(
  options: BindingClientOptions,
): ApiClient {
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function call<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    schema: ZodType<T>,
    body?: unknown,
    init: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const headers = new Headers({
      Accept: "application/json",
      "Cf-Access-Jwt-Assertion": options.assertion,
      "X-Request-Id": options.requestId,
    });
    if (method !== "GET") headers.set("Origin", options.origin);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const signals = [AbortSignal.timeout(init.timeoutMs ?? timeoutMs)];
    if (init.signal) signals.push(init.signal);
    let response: Response;
    try {
      response = await options.api.fetch(
        new Request(`https://saldo-api.internal${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.any(signals),
        }),
      );
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new ApiError("unavailable");
    }
    const json: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw toApiError(path, response.status, json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError("bad_response", undefined, 502);
    return parsed.data;
  }

  return {
    status: () => call("GET", "/api/status", statusSchema),
    me: () => call("GET", "/api/me", meSchema),
    listSubscriptions: async () =>
      (await call("GET", "/api/subscriptions", listSchema)).subscriptions,
    createSubscription: async (input: SubscriptionInput) =>
      (await call("POST", "/api/subscriptions", oneSchema, input)).subscription,
    updateSubscription: async (id: string, input: SubscriptionInput) =>
      (
        await call(
          "PATCH",
          `/api/subscriptions/${encodeURIComponent(id)}`,
          oneSchema,
          input,
        )
      ).subscription,
    deleteSubscription: async (id: string) => {
      await call(
        "DELETE",
        `/api/subscriptions/${encodeURIComponent(id)}`,
        deletedSchema,
      );
    },
    saveReview: async (review: ReviewInput) => {
      const result = await call("POST", "/api/review", reviewSchema, review);
      return {
        subscriptions: result.subscriptions,
        alreadySaved: result.alreadySaved ?? false,
      };
    },
    chat: (input: ChatInput, signal?: AbortSignal) =>
      call("POST", "/api/chat", chatSchema, input, {
        signal,
        timeoutMs: CHAT_TIMEOUT_MS,
      }),
  };
}

function toApiError(path: string, status: number, body: unknown) {
  const apiMessage = errorBodySchema.safeParse(body).data?.error;
  const code: ApiErrorCode =
    status === 401
      ? "unauthenticated"
      : status === 403
        ? "forbidden"
        : status === 404
          ? "not_found"
          : status === 413
            ? "too_large"
            : status === 429
              ? "rate_limited"
              : status === 503 && path === "/api/chat"
                ? "ai_unavailable"
                : status === 400 || status === 422
                  ? "invalid"
                  : "unavailable";
  // The API writes 400 messages for people (for example duplicate warnings).
  return new ApiError(
    code,
    code === "invalid" && apiMessage ? apiMessage : undefined,
    status,
  );
}
