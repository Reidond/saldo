import { createServer } from "node:http";
import { z } from "zod";
import { secretMatches } from "./crypto.js";
import { BridgeError, bridgeRequestSchema, infer } from "./inference.js";
const payloadSchema = z
  .object({
    input: bridgeRequestSchema,
    accessToken: z.string().min(1).max(100_000),
    model: z.string().min(1).max(200).optional(),
  })
  .strict();
const bridgeSecret = process.env.AI_BRIDGE_SECRET;
if (!bridgeSecret || !/^[A-Za-z0-9_-]{43,128}$/.test(bridgeSecret))
  throw new Error("A strong AI_BRIDGE_SECRET is required.");
let busy = false;
const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  if (
    !(await secretMatches(
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : null,
      bridgeSecret,
    ))
  ) {
    send(401, { error: "UNAUTHORIZED" });
    return;
  }
  if (req.method !== "POST" || req.url !== "/infer") {
    send(404, { error: "NOT_FOUND" });
    return;
  }
  if (busy) {
    send(429, { error: "AI_BUSY" });
    return;
  }
  busy = true;
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once("aborted", abort);
  res.once("close", abort);
  try {
    if (!req.headers["content-type"]?.includes("application/json")) {
      send(415, { error: "INVALID_CONTENT_TYPE" });
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 12_000_000) {
        send(413, { error: "INPUT_TOO_LARGE" });
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    let input: z.infer<typeof payloadSchema>;
    try {
      input = payloadSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
    } catch {
      send(400, { error: "INVALID_INPUT" });
      return;
    }
    chunks.length = 0; // Release the raw request buffer before waiting on inference.
    send(
      200,
      await infer(
        input.input,
        input.accessToken,
        input.model,
        fetch,
        controller.signal,
      ),
    );
  } catch (error) {
    send(error instanceof BridgeError ? error.status : 502, {
      error: error instanceof BridgeError ? error.code : "INFERENCE_FAILED",
    });
  } finally {
    req.off("aborted", abort);
    res.off("close", abort);
    busy = false;
  }
});
server.requestTimeout = 180_000;
server.headersTimeout = 10_000;
server.listen(8080, "0.0.0.0");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
