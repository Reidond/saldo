import { Container, getContainer } from "@cloudflare/containers";
import { stateKey, secretMatches, type Envelope } from "./crypto.js";
import { SessionVault } from "./vault.js";
import { readTransfer } from "./transfer.js";
import { bridgeRequestSchema } from "./inference.js";
interface Env {
  SALDO_AI: DurableObjectNamespace<SaldoAI>;
  AI_BRIDGE_SECRET: string;
  SIWC_STATE_KEY: string;
  SIWC_BOOTSTRAP_PARTS?: string;
  [key: string]: unknown;
  SIWC_MODEL?: string;
}
class BodyTooLarge extends Error {}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export class SaldoAI extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = true;
  envVars = { AI_BRIDGE_SECRET: this.env.AI_BRIDGE_SECRET };
  private vault?: Promise<SessionVault>;
  private busy = false;
  private session() {
    return (this.vault ??= stateKey(this.env.SIWC_STATE_KEY).then(
      (key) =>
        new SessionVault(
          {
            get: () => this.ctx.storage.get<Envelope>("oauth-vault-v1"),
            put: (value) => this.ctx.storage.put("oauth-vault-v1", value),
          },
          key,
          readTransfer(this.env),
        ),
    ));
  }
  override async fetch(request: Request): Promise<Response> {
    if (
      !(await secretMatches(
        request.headers.get("authorization"),
        this.env.AI_BRIDGE_SECRET,
      ))
    )
      return json({ error: "UNAUTHORIZED" }, 401);
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/status") {
      try {
        await (await this.session()).accessToken();
        return json({ connected: true });
      } catch {
        return json({ connected: false });
      }
    }
    if (request.method !== "POST" || path !== "/chat")
      return json({ error: "NOT_FOUND" }, 404);
    if (this.busy) return json({ error: "AI_BUSY" }, 429);
    this.busy = true;
    try {
      if (!request.headers.get("content-type")?.includes("application/json"))
        return json({ error: "INVALID_CONTENT_TYPE" }, 415);
      // Bound actual bytes, not just the client-controlled Content-Length header.
      const body = await boundedBody(request, 12_000_000);
      const input = bridgeRequestSchema.safeParse(JSON.parse(body));
      if (!input.success) return json({ error: "INVALID_INPUT" }, 400);
      const session = await this.session();
      const accessToken = await session.accessToken();
      const result = await this.containerFetch("http://container/infer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.AI_BRIDGE_SECRET}`,
        },
        body: JSON.stringify({
          input: input.data,
          accessToken,
          model: this.env.SIWC_MODEL,
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(170_000)]),
      });
      if (result.status === 401) {
        await session.disconnected();
        return json({ error: "RECONNECT_REQUIRED" }, 401);
      }
      return new Response(result.body, {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof BodyTooLarge)
        return json({ error: "INPUT_TOO_LARGE" }, 413);
      if (error instanceof SyntaxError)
        return json({ error: "INVALID_INPUT" }, 400);
      return json({ error: "AI_UNAVAILABLE_OR_RECONNECT_REQUIRED" }, 503);
    } finally {
      this.busy = false;
    }
  }
}
export async function boundedBody(
  request: Request,
  maximum: number,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new BodyTooLarge("BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(joined);
}
// No public routes/workers.dev. Service binding from the owner-authenticated application only.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (
      !(await secretMatches(
        request.headers.get("authorization"),
        env.AI_BRIDGE_SECRET,
      ))
    )
      return json({ error: "UNAUTHORIZED" }, 401);
    return getContainer(env.SALDO_AI, "saldo-single-owner").fetch(request);
  },
};
