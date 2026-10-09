const jsonHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Every API response, success or error, goes through this. */
export const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: jsonHeaders });

export const notFound = () => json({ error: "Not found" }, 404);

const assetHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
};

/** Adds the private-workspace security headers to a web build response. */
export function protectedAsset(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(assetHeaders))
    headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}
