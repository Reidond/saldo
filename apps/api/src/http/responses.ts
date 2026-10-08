const jsonHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Every API response, success or error, goes through this. */
export const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: jsonHeaders });

export const notFound = () => json({ error: "Not found" }, 404);
