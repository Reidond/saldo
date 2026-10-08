import { z } from "zod";
import { proposalSchema, type Subscription } from "@saldo/domain";
/** Fetcher is a private Worker service binding, never a URL supplied by the browser. */
export interface SIWCEnv {
  AI?: Pick<Fetcher, "fetch">;
  AI_BRIDGE_SECRET?: string;
}
export const aiReplySchema = z
  .object({
    reply: z.string().min(1).max(24_000),
    proposals: z.array(proposalSchema).max(100),
  })
  .strict();
export async function aiStatus(env: SIWCEnv): Promise<{ connected: boolean }> {
  if (!env.AI || !env.AI_BRIDGE_SECRET) return { connected: false };
  try {
    const r = await env.AI.fetch(
      new Request("http://bridge/status", {
        headers: { Authorization: `Bearer ${env.AI_BRIDGE_SECRET}` },
        signal: AbortSignal.timeout(25_000),
      }),
    );
    if (!r.ok) return { connected: false };
    const data = z.object({ connected: z.boolean() }).parse(await r.json());
    return { connected: data.connected };
  } catch {
    return { connected: false };
  }
}
export async function aiChat(
  env: SIWCEnv,
  input: {
    message: string;
    attachments: unknown[];
    subscriptions: Subscription[];
    history?: { role: "user" | "assistant"; content: string }[];
  },
  signal?: AbortSignal,
) {
  if (!env.AI || !env.AI_BRIDGE_SECRET) throw new Error("AI_NOT_CONNECTED");
  const r = await env.AI.fetch(
    new Request("http://bridge/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.AI_BRIDGE_SECRET}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.any([
        AbortSignal.timeout(180_000),
        ...(signal ? [signal] : []),
      ]),
    }),
  );
  if (!r.ok)
    throw new Error(
      r.status === 401 ? "AI_RECONNECT_REQUIRED" : "AI_REQUEST_FAILED",
    );
  return aiReplySchema.parse(await r.json());
}
