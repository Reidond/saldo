import { readBody, PayloadTooLarge } from "./body";
import { authenticate, validOrigin, type AuthEnv } from "./auth";
import {
  chatSchema,
  subscriptionSchema,
  reviewSchema,
  validateReview,
  type Subscription,
  proposalSchema,
  duplicateKey,
} from "../src/domain";
export interface Env extends AuthEnv {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  AI?: Fetcher;
  AI_BRIDGE_SECRET?: string;
  APP_ORIGIN: string;
}
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function list(env: Env, account: string) {
  const { results } = await env.DB.prepare(
    "SELECT data FROM subscriptions WHERE account_id=?",
  )
    .bind(account)
    .all<{ data: string }>();
  return results.map((r) => subscriptionSchema.parse(JSON.parse(r.data)));
}
function save(env: Env, account: string, s: Subscription) {
  return env.DB.prepare(
    "INSERT INTO subscriptions (account_id,id,data,duplicate_key) VALUES (?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET data=excluded.data,duplicate_key=excluded.duplicate_key,updated_at=CURRENT_TIMESTAMP",
  ).bind(account, s.id, JSON.stringify(s), duplicateKey(s));
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!validOrigin(request, env.APP_ORIGIN))
      return json({ error: "Origin not allowed" }, 403);
    const account = await authenticate(request, env);
    if (url.pathname === "/api/status")
      return json({
        authenticated: !!account,
        aiConnected:
          account && env.AI
            ? await env.AI.fetch(
                new Request("http://bridge/status", {
                  signal: AbortSignal.timeout(25000),
                  headers: {
                    Authorization: `Bearer ${env.AI_BRIDGE_SECRET ?? ""}`,
                  },
                }),
              )
                .then((r) =>
                  r.ok ? (r.json() as Promise<{ connected: boolean }>) : null,
                )
                .then((s) => s?.connected ?? false)
                .catch(() => false)
            : false,
      });
    // Fail closed for ALL production content, including static assets. Local Vite preview is a separate synthetic-only development server.
    if (!account)
      return json(
        {
          error:
            "Private Saldo instance. Configure Cloudflare Access and sign in as the owner.",
        },
        401,
      );
    if (!url.pathname.startsWith("/api/")) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("Cache-Control", "private, no-store");
      return new Response(response.body, { status: response.status, headers });
    }
    try {
      await env.DB.prepare("INSERT OR IGNORE INTO accounts(id) VALUES (?)")
        .bind(account)
        .run();
      if (url.pathname === "/api/subscriptions" && request.method === "GET")
        return json({ subscriptions: await list(env, account) });
      if (url.pathname === "/api/subscriptions" && request.method === "POST") {
        const raw = (await readBody(request)) as Record<string, unknown>;
        const s = subscriptionSchema.parse({
          ...raw,
          id: raw.id ?? crypto.randomUUID(),
        });
        validateReview([{ ...s, operation: "add" }], await list(env, account));
        await save(env, account, s).run();
        return json({ subscription: s }, 201);
      }
      const match = url.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const existing = await list(env, account);
        const old = existing.find((s) => s.id === id);
        if (!old) return json({ error: "Subscription not found" }, 404);
        if (request.method === "PATCH") {
          const s = subscriptionSchema.parse({
            ...old,
            ...((await readBody(request)) as Record<string, unknown>),
            id,
          });
          validateReview(
            [{ ...s, operation: "update", targetId: id }],
            existing,
          );
          await save(env, account, s).run();
          return json({ subscription: s });
        }
        if (request.method === "DELETE") {
          await env.DB.prepare(
            "DELETE FROM subscriptions WHERE account_id=? AND id=?",
          )
            .bind(account, id)
            .run();
          return json({ deleted: true });
        }
      }
      if (url.pathname === "/api/review" && request.method === "POST") {
        const review = reviewSchema.parse(await readBody(request));
        const prior = await env.DB.prepare(
          "SELECT request_id FROM reviews WHERE account_id=? AND request_id=?",
        )
          .bind(account, review.requestId)
          .first();
        if (prior)
          return json({
            subscriptions: await list(env, account),
            alreadySaved: true,
          });
        const existing = await list(env, account);
        const updated = validateReview(review.proposals, existing);
        const changed = new Set(
          review.proposals.map((p) =>
            p.operation === "update" ? p.targetId : p.id,
          ),
        );
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO reviews(account_id,request_id) VALUES (?,?)",
          ).bind(account, review.requestId),
          ...updated
            .filter((s) => changed.has(s.id))
            .map((s) => save(env, account, s)),
        ]);
        return json({ subscriptions: updated });
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        const input = chatSchema.parse(await readBody(request));
        if (!env.AI)
          return json(
            {
              error:
                "ChatGPT is not connected. Your message and screenshots have not been sent to an AI provider.",
            },
            503,
          );
        const response = await env.AI.fetch(
          new Request("http://bridge/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.AI_BRIDGE_SECRET ?? ""}`,
            },
            body: JSON.stringify({
              ...input,
              subscriptions: await list(env, account),
            }),
            signal: AbortSignal.any([
              request.signal,
              AbortSignal.timeout(180000),
            ]),
          }),
        );
        if (!response.ok)
          return json(
            {
              error:
                "ChatGPT could not complete this request. Nothing was saved. Check your private connection and try again.",
            },
            response.status === 429 ? 429 : 503,
          );
        const data = (await response.json()) as {
          reply?: unknown;
          proposals?: unknown[];
        };
        const proposals = (data.proposals ?? []).map((p) =>
          proposalSchema.parse(p),
        );
        return json({
          reply:
            typeof data.reply === "string"
              ? data.reply
              : "Review these proposed changes before saving.",
          proposals,
        });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof PayloadTooLarge)
        return json({ error: "Request exceeds upload limit" }, 413);
      const message =
        error instanceof Error ? error.message : "Invalid request";
      return json(
        {
          error:
            message.includes("duplicate") ||
            message.includes("Duplicate") ||
            message.includes("target")
              ? message
              : "Invalid data or unavailable storage. No unreviewed changes were saved.",
        },
        400,
      );
    }
  },
};
