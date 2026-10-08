/** Cloudflare Worker secret values are limited to 5KB. Keep encrypted import chunks below that limit. */
const CHUNK_SIZE = 4000;
const MAX_PARTS = 32;
export function transferSecrets(bundle: string): Record<string, string> {
  if (!bundle || bundle.length > CHUNK_SIZE * MAX_PARTS)
    throw new Error("TRANSFER_BUNDLE_TOO_LARGE");
  const parts = Math.ceil(bundle.length / CHUNK_SIZE);
  const values: Record<string, string> = {
    SIWC_BOOTSTRAP_PARTS: String(parts),
  };
  for (let i = 0; i < parts; i++)
    values[`SIWC_BOOTSTRAP_BUNDLE_${String(i).padStart(2, "0")}`] =
      bundle.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
  return values;
}
export function readTransfer(env: Record<string, unknown>): string | undefined {
  if (env.SIWC_BOOTSTRAP_PARTS === undefined) return undefined;
  const raw = env.SIWC_BOOTSTRAP_PARTS;
  if (typeof raw !== "string" || !/^\d{1,2}$/.test(raw))
    throw new Error("INVALID_TRANSFER_PARTS");
  const count = Number(raw);
  if (count < 1 || count > MAX_PARTS) throw new Error("INVALID_TRANSFER_PARTS");
  let bundle = "";
  for (let i = 0; i < count; i++) {
    const part = env[`SIWC_BOOTSTRAP_BUNDLE_${String(i).padStart(2, "0")}`];
    if (typeof part !== "string" || !part.length || part.length > CHUNK_SIZE)
      throw new Error("MISSING_TRANSFER_PART");
    bundle += part;
  }
  return bundle;
}
