import { describe, it, expect, vi } from "vitest";
import { stateKey, seal, unseal, secretMatches, type Envelope } from "./crypto";
import { emptyVault, type Account } from "./auth";
import { SessionVault, type EncryptedStorage } from "./vault";
import { transferSecrets, readTransfer } from "./transfer";
import {
  completedResponse,
  parseResult,
  responseBody,
  bridgeRequestSchema,
  infer,
} from "./inference";
const account = (expires = Date.now() + 3_600_000): Account => ({
  client_id: "oaiapp_test_fixture",
  subject: "test-only",
  issuer: "https://auth.openai.com",
  label: "Test",
  tokens: {
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    id_token: "synthetic-id",
    token_type: "Bearer",
    scopes: ["chatgpt.tokens.use.direct"],
    expires_at: expires,
    saved_at: new Date().toISOString(),
  },
});
function storage() {
  let saved: Envelope | undefined;
  return {
    get: async () => saved,
    put: async (value: Envelope) => {
      saved = structuredClone(value);
    },
  } satisfies EncryptedStorage;
}
function sse(events: unknown[], truncate = false) {
  const text =
    events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join("") +
    (truncate ? "data: {" : "");
  return new ReadableStream<Uint8Array>({
    start(c) {
      const data = new TextEncoder().encode(text);
      for (let i = 0; i < data.length; i += 7) c.enqueue(data.slice(i, i + 7));
      c.close();
    },
  });
}
const call = {
  type: "function_call",
  namespace: "saldo",
  name: "present_result",
  arguments: JSON.stringify({ reply: "Review ready", proposals: [] }),
};
describe("encrypted OAuth state", () => {
  it("chunks encrypted transfer below Worker secret limits and fails closed on missing parts", () => {
    const original = "a".repeat(10001);
    const parts = transferSecrets(original);
    expect(parts.SIWC_BOOTSTRAP_PARTS).toBe("3");
    expect(
      Math.max(...Object.values(parts).map((s) => s.length)),
    ).toBeLessThanOrEqual(4000);
    expect(readTransfer(parts)).toBe(original);
    delete parts.SIWC_BOOTSTRAP_BUNDLE_01;
    expect(() => readTransfer(parts)).toThrow("MISSING_TRANSFER_PART");
    expect(readTransfer({})).toBeUndefined();
  });
  it("authenticates encryption and refuses corruption/wrong keys", async () => {
    const key = await stateKey("11".repeat(32));
    const value = await seal({ secret: "synthetic" }, key);
    expect(JSON.stringify(value)).not.toContain("synthetic");
    expect(await unseal(value, key)).toEqual({ secret: "synthetic" });
    const tampered = {
      ...value,
      ciphertext:
        (value.ciphertext[0] === "A" ? "B" : "A") + value.ciphertext.slice(1),
    };
    await expect(unseal(tampered, key)).rejects.toThrow();
    await expect(
      unseal(value, await stateKey("22".repeat(32))),
    ).rejects.toThrow();
  });
  it("fails closed on missing/weak or incorrect bridge secret", async () => {
    expect(
      await secretMatches("Bearer " + "x".repeat(43), "x".repeat(43)),
    ).toBe(true);
    expect(
      await secretMatches("Bearer " + "y".repeat(43), "x".repeat(43)),
    ).toBe(false);
    expect(await secretMatches("Bearer short", "short")).toBe(false);
    expect(await secretMatches(null, undefined)).toBe(false);
  });
  it("serializes refresh and keeps rotated credentials after restart", async () => {
    const key = await stateKey("11".repeat(32)),
      store = storage(),
      v = emptyVault();
    v.accounts = [account(1)];
    v.active_client_id = v.accounts[0].client_id;
    await store.put(await seal(v, key));
    const renew = vi.fn(async (a: Account) => {
      await new Promise((r) => setTimeout(r, 15));
      return {
        ...a,
        tokens: {
          ...a.tokens!,
          access_token: "rotated",
          refresh_token: "rotated-refresh",
          expires_at: Date.now() + 3_600_000,
        },
      };
    });
    const vault = new SessionVault(store, key, undefined, renew);
    expect(
      await Promise.all(Array.from({ length: 8 }, () => vault.accessToken())),
    ).toEqual(Array(8).fill("rotated"));
    expect(renew).toHaveBeenCalledTimes(1);
    expect(await new SessionVault(store, key).accessToken()).toBe("rotated");
    const saved = (await unseal((await store.get())!, key)) as typeof v;
    expect(saved.host_id).toBe(v.host_id);
    expect(saved.accounts[0].tokens!.refresh_token).toBe("rotated-refresh");
  });
  it("never retries a refresh with an uncertain outcome", async () => {
    const key = await stateKey("11".repeat(32)),
      store = storage(),
      v = emptyVault();
    v.accounts = [account(1)];
    v.active_client_id = v.accounts[0].client_id;
    await store.put(await seal(v, key));
    const renew = vi.fn(async () => {
      throw new Error("network lost after token rotated");
    });
    const vault = new SessionVault(store, key, undefined, renew);
    await expect(vault.accessToken()).rejects.toThrow("RECONNECT_REQUIRED");
    await expect(vault.accessToken()).rejects.toThrow("RECONNECT_REQUIRED");
    expect(renew).toHaveBeenCalledTimes(1);
  });
  it("detects a crash marker across instances", async () => {
    const key = await stateKey("11".repeat(32)),
      store = storage(),
      v = emptyVault();
    v.accounts = [account(1)];
    v.active_client_id = v.accounts[0].client_id;
    v.refreshing_client_id = v.active_client_id;
    await store.put(await seal(v, key));
    const renew = vi.fn();
    await expect(
      new SessionVault(store, key, undefined, renew).accessToken(),
    ).rejects.toThrow("RECONNECT_REQUIRED");
    expect(renew).not.toHaveBeenCalled();
  });
  it("imports once, preserves runtime identity, and never resurrects revoked credentials", async () => {
    const key = await stateKey("11".repeat(32)),
      store = storage(),
      v = emptyVault();
    await store.put(await seal(v, key));
    const bundle = JSON.stringify(
      await seal(
        {
          version: 1,
          bundle_id: crypto.randomUUID(),
          created_at: Date.now(),
          account: account(),
        },
        key,
      ),
    );
    const verify = vi.fn(async () => {});
    const vault = new SessionVault(store, key, bundle, undefined, verify);
    expect(await vault.accessToken()).toBe("synthetic-access");
    await vault.disconnected();
    await expect(
      new SessionVault(store, key, bundle, undefined, verify).accessToken(),
    ).rejects.toThrow("RECONNECT_REQUIRED");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(
      ((await unseal((await store.get())!, key)) as typeof v).host_id,
    ).toBe(v.host_id);
  });
});
describe("completed Responses streams", () => {
  it("parses chunked CRLF events only after response.completed", async () => {
    expect(
      await completedResponse(
        sse([
          { type: "response.output_text.delta", delta: "partial" },
          {
            type: "response.completed",
            response: { status: "completed", output: [call] },
          },
        ]),
      ),
    ).toEqual([call]);
  });
  it("rejects clean EOF without completion", async () => {
    await expect(
      completedResponse(
        sse([{ type: "response.output_text.delta", delta: "looks finished" }]),
      ),
    ).rejects.toThrow("INTERRUPTED");
  });
  it.each(["response.failed", "response.incomplete", "error"])(
    "rejects terminal %s",
    async (type) => {
      await expect(completedResponse(sse([{ type }]))).rejects.toThrow(
        "INTERRUPTED",
      );
    },
  );
  it("rejects truncated JSON and a stream failing after completion", async () => {
    await expect(
      completedResponse(
        sse(
          [
            {
              type: "response.completed",
              response: { status: "completed", output: [call] },
            },
          ],
          true,
        ),
      ),
    ).rejects.toThrow();
  });
  it("accepts only bounded, valid review proposals", () => {
    expect(parseResult([call], [])).toEqual({
      reply: "Review ready",
      proposals: [],
    });
    expect(() =>
      parseResult([{ ...call, name: "execute_payment" }], []),
    ).toThrow();
    expect(() =>
      parseResult(
        [
          {
            ...call,
            arguments: '{"reply":"bad","proposals":[{"name":"fake"}]}',
          },
        ],
        [],
      ),
    ).toThrow();
  });
  it("preserves bounded history and never enables persistence or hosted tools", () => {
    const input = bridgeRequestSchema.parse({
      message: "Next",
      attachments: [],
      subscriptions: [],
      history: [{ role: "user", content: "Earlier" }],
    });
    const request = responseBody(input, "allowed-model");
    expect(request.store).toBe(false);
    expect(request.stream).toBe(true);
    expect(request.input[0]).toEqual({ role: "user", content: "Earlier" });
    expect(request.tools[0].type).toBe("namespace");
    expect(() =>
      bridgeRequestSchema.parse({
        ...input,
        history: Array.from({ length: 6 }, () => ({
          role: "user",
          content: "x".repeat(12000),
        })),
      }),
    ).toThrow();
  });
  it("propagates cancellation to inference without returning partial success", async () => {
    const controller = new AbortController();
    let started: () => void = () => {};
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/models"))
        return Response.json({
          models: [{ slug: "allowed", visibility: "list" }],
        });
      started();
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        else
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
      });
    });
    const work = infer(
      bridgeRequestSchema.parse({ message: "Hi", subscriptions: [] }),
      "synthetic",
      undefined,
      f,
      controller.signal,
    );
    await began;
    controller.abort();
    await expect(work).rejects.toThrow("Aborted");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("enumerates permitted models and will not use a disallowed configured slug", async () => {
    const f = vi.fn(async () =>
      Response.json({ models: [{ slug: "allowed", visibility: "list" }] }),
    );
    await expect(
      infer(
        bridgeRequestSchema.parse({ message: "Hi", subscriptions: [] }),
        "synthetic",
        "forbidden",
        f,
      ),
    ).rejects.toThrow("MODEL_NOT_AVAILABLE");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
