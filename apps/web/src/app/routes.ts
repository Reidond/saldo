export type Route =
  | { name: "overview" }
  | { name: "subscriptions" }
  | { name: "new-subscription" }
  | { name: "subscription"; id: string }
  | { name: "edit-subscription"; id: string }
  | { name: "chat" }
  | { name: "review" }
  | { name: "settings" }
  | { name: "not-found" };

export type Section =
  | "overview"
  | "subscriptions"
  | "chat"
  | "review"
  | "settings";

export function matchRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "overview" };
  if (path === "/subscriptions") return { name: "subscriptions" };
  if (path === "/subscriptions/new") return { name: "new-subscription" };
  if (path === "/chat") return { name: "chat" };
  if (path === "/review") return { name: "review" };
  if (path === "/settings") return { name: "settings" };
  const match = path.match(/^\/subscriptions\/([^/]+)(\/edit)?$/);
  if (match) {
    let id: string;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return { name: "not-found" };
    }
    return match[2]
      ? { name: "edit-subscription", id }
      : { name: "subscription", id };
  }
  return { name: "not-found" };
}

export function sectionOf(route: Route): Section | null {
  switch (route.name) {
    case "overview":
      return "overview";
    case "subscriptions":
    case "new-subscription":
    case "subscription":
    case "edit-subscription":
      return "subscriptions";
    case "chat":
      return "chat";
    case "review":
      return "review";
    case "settings":
      return "settings";
    default:
      return null;
  }
}

export const subscriptionHref = (id: string) =>
  `/subscriptions/${encodeURIComponent(id)}`;

/** Cloudflare Access logout: ends the session for every Access app. */
export const SIGN_OUT_HREF = "/cdn-cgi/access/logout";
