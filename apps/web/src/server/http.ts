import "server-only";

/** Content Security Policy for HTML; inline scripts need the request nonce. */
export function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function baseHeaders(contentType: string) {
  return new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
}

/** Built client files and public files, served from the ASSETS binding. */
export function isAssetPath(pathname: string) {
  return pathname.startsWith("/assets/") || pathname === "/favicon.svg";
}

export async function serveAsset(
  assets: { fetch(r: Request): Promise<Response> },
  request: Request,
) {
  const response = await assets.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  // Hashed build output never changes; it holds code, not private data.
  headers.set(
    "Cache-Control",
    response.ok && new URL(request.url).pathname.startsWith("/assets/")
      ? "private, max-age=31536000, immutable"
      : "private, no-store",
  );
  return new Response(response.body, { status: response.status, headers });
}

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: baseHeaders("application/json; charset=utf-8"),
  });
}

/** Same-origin check for every state-changing request. */
export function sameOrigin(request: Request, origin: string) {
  return request.headers.get("Origin") === origin;
}

export function contentLength(request: Request) {
  const value = request.headers.get("Content-Length");
  return value === null ? null : Number(value);
}

export function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
