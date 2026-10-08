/** Shared WebCrypto envelope, usable in Workers and Node. Keys never belong in source. */
export interface Envelope {
  version: 1;
  iv: string;
  ciphertext: string;
}
const aad = new TextEncoder().encode("saldo-siwc-v1");
function encode(bytes: Uint8Array) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
function decode(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function stateKey(hex: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("STATE_KEY_REQUIRED");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(hex.match(/../g)!, (v) => parseInt(v, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(value: unknown, key: CryptoKey): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    data,
  );
  return {
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  };
}
export async function unseal(
  envelope: Envelope,
  key: CryptoKey,
): Promise<unknown> {
  if (
    envelope.version !== 1 ||
    typeof envelope.iv !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length > 2_000_000
  )
    throw new Error("INVALID_VAULT");
  const iv = decode(envelope.iv);
  if (iv.length !== 12) throw new Error("INVALID_VAULT");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    decode(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}
export async function secretMatches(
  header: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (
    !expected ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(expected) ||
    !header?.startsWith("Bearer ")
  )
    return false;
  const candidate = header.slice(7);
  if (candidate.length !== expected.length) return false;
  const [a, b] = await Promise.all(
    [candidate, expected].map((v) =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
  );
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
