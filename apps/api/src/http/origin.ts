/** Blocks cross-site state changes: unsafe methods need the app's Origin. */
export function isAllowedOrigin(request: Request, appOrigin: string) {
  return (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    request.headers.get("Origin") === appOrigin
  );
}
