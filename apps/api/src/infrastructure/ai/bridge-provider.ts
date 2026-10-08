import { proposalSchema } from "@saldo/domain";
import { AiRequestFailedError } from "../../services/errors";
import type { AiProvider } from "../../services/ports";

/**
 * AI through the private saldo-ai-bridge Worker, reached only by service
 * binding (never a URL from the browser). The host name is ignored by the
 * binding; the bridge authenticates the shared bearer secret.
 */
export function createBridgeAiProvider(
  bridge: Pick<Fetcher, "fetch">,
  secret: string | undefined,
): AiProvider {
  const authorization = `Bearer ${secret ?? ""}`;
  return {
    enabled: true,
    async status() {
      try {
        const response = await bridge.fetch(
          new Request("http://bridge/status", {
            headers: { Authorization: authorization },
            signal: AbortSignal.timeout(25_000),
          }),
        );
        if (!response.ok) return { connected: false };
        const data = (await response.json()) as { connected?: unknown } | null;
        return { connected: data?.connected === true };
      } catch {
        return { connected: false };
      }
    },
    async extract(input, signal) {
      const response = await bridge.fetch(
        new Request("http://bridge/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authorization,
          },
          body: JSON.stringify(input),
          signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
        }),
      );
      if (!response.ok) throw new AiRequestFailedError(response.status === 429);
      const data = (await response.json()) as {
        reply?: unknown;
        proposals?: unknown[];
      };
      return {
        reply: typeof data.reply === "string" ? data.reply : null,
        proposals: (data.proposals ?? []).map((p) => proposalSchema.parse(p)),
      };
    },
  };
}
