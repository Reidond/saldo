export class PayloadTooLarge extends Error {}

/**
 * Reads a JSON request body, enforcing the upload limit on the declared and
 * the actually streamed size. Route handlers read bodies only through this;
 * Elysia's own body parsing is never used.
 */
export async function readBody(
  request: Request,
  maximum = 12_000_000,
): Promise<unknown> {
  if (Number(request.headers.get("Content-Length")) > maximum)
    throw new PayloadTooLarge("Request too large");
  if (!request.body) throw new Error("Body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new PayloadTooLarge("Request too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/**
 * Fields of a JSON object body. Other JSON values contribute no fields, which
 * keeps the original contract: they are judged by the domain schema after
 * merging, exactly like an empty object.
 */
export function objectFields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
