// Shared by the browser and the rsc entry: how a URL maps to an RSC payload
// request, and how a server action call is marked.
const RSC_SUFFIX = "_.rsc";
const ACTION_HEADER = "x-rsc-action";

export interface RenderRequest {
  /** The client wants the RSC payload, not HTML. */
  isRsc: boolean;
  /** A server action call (JS) or a progressive-enhancement form post. */
  isAction: boolean;
  actionId?: string;
  request: Request;
  url: URL;
}

export function createRscRenderRequest(
  href: string,
  action?: { id: string; body: BodyInit },
): Request {
  const url = new URL(href);
  url.pathname += RSC_SUFFIX;
  const headers = new Headers({
    // Makes Cloudflare Access answer an expired session with 401 instead of
    // redirecting the fetch to the login page.
    "X-Requested-With": "XMLHttpRequest",
  });
  if (action) headers.set(ACTION_HEADER, action.id);
  return new Request(url, {
    method: action ? "POST" : "GET",
    headers,
    body: action?.body,
    // A redirect here can only be Access sending an expired session to its
    // sign-in page; keep it visible (an opaque redirect) instead of following
    // it cross-origin.
    redirect: "manual",
  });
}

export function parseRenderRequest(request: Request): RenderRequest {
  const url = new URL(request.url);
  const isAction = request.method === "POST";
  if (!url.pathname.endsWith(RSC_SUFFIX))
    return { isRsc: false, isAction, request, url };
  url.pathname = url.pathname.slice(0, -RSC_SUFFIX.length);
  const actionId = request.headers.get(ACTION_HEADER) ?? undefined;
  if (isAction && !actionId) throw new Error("Missing server action id");
  return {
    isRsc: true,
    isAction,
    actionId,
    request: new Request(url, request),
    url,
  };
}

export function isRscResponse(response: Response) {
  return (
    response.ok &&
    (response.headers.get("content-type") ?? "").startsWith("text/x-component")
  );
}
