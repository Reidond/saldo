import {
  createFromFetch,
  createFromReadableStream,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "@vitejs/plugin-rsc/browser";
import {
  StrictMode,
  startTransition,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { rscStream } from "rsc-html-stream/client";
import type { RscPayload } from "./entry.rsc";
import { GlobalErrorBoundary } from "./error-boundary";
import {
  NavigationContext,
  type NavigateOptions,
  type Navigation,
} from "./navigation";
import { createRscRenderRequest, isRscResponse } from "./request";

const SESSION_EXPIRED = "Your session expired. Reload to sign in again.";

let showPayload: (
  next: Promise<RscPayload>,
  scroll: boolean,
) => void = () => {};

async function fetchPayload(href: string) {
  const response = await fetch(createRscRenderRequest(href));
  // Access answers an expired session with a redirect or 401, not RSC.
  if (!isRscResponse(response)) throw new Error(SESSION_EXPIRED);
  return createFromFetch<RscPayload>(Promise.resolve(response));
}

function load(href: string, scroll: boolean) {
  showPayload(
    fetchPayload(href).catch(() => {
      // A full page load lets Access show its sign-in page; stay pending.
      window.location.assign(href);
      return new Promise<never>(() => {});
    }),
    scroll,
  );
}

function navigate(href: string, options: NavigateOptions = {}) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url);
    return;
  }
  if (options.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  load(url.href, options.scroll ?? !options.replace);
}

function BrowserRoot({ initial }: { initial: RscPayload }) {
  const [payload, setPayload] = useState(initial);
  const [pending, startNavigation] = useTransition();
  useEffect(() => {
    showPayload = (next, scroll) =>
      startNavigation(async () => {
        const resolved = await next;
        startNavigation(() => setPayload(resolved));
        if (scroll) requestAnimationFrame(scrollToHashOrTop);
      });
    applyActionPayload = (next) => startTransition(() => setPayload(next));
  }, []);
  const navigation = useMemo<Navigation>(
    () => ({ pending, navigate }),
    [pending],
  );
  return (
    <NavigationContext value={navigation}>{payload.root}</NavigationContext>
  );
}

function scrollToHashOrTop() {
  const target = window.location.hash
    ? document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
    : null;
  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);
}

let applyActionPayload: (payload: RscPayload) => void = () => {};

setServerCallback(async (id, args) => {
  const temporaryReferences = createTemporaryReferenceSet();
  const response = await fetch(
    createRscRenderRequest(window.location.href, {
      id,
      body: await encodeReply(args, { temporaryReferences }),
    }),
  );
  if (!isRscResponse(response)) throw new Error(SESSION_EXPIRED);
  const payload = await createFromFetch<RscPayload>(Promise.resolve(response), {
    temporaryReferences,
  });
  applyActionPayload(payload);
  const result = payload.returnValue;
  if (!result) throw new Error("Saldo did not confirm this change.");
  if (!result.ok) throw new Error(result.message);
  return result.data;
});

function interceptLinks() {
  document.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest("a");
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      (link.target && link.target !== "_self") ||
      link.hasAttribute("download") ||
      link.hasAttribute("data-reload") ||
      link.origin !== window.location.origin ||
      link.pathname.startsWith("/cdn-cgi/")
    )
      return;
    event.preventDefault();
    if (link.href === window.location.href && !link.hash) return;
    navigate(link.href);
  });
  window.addEventListener("popstate", () => load(window.location.href, false));
}

/** Snap colors on a system theme switch instead of animating every element. */
function suppressThemeTransitions() {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      const style = document.createElement("style");
      style.append(
        document.createTextNode(
          "*,*::before,*::after{transition:none !important}",
        ),
      );
      document.head.append(style);
      void document.body.offsetHeight;
      requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
    });
}

async function main() {
  const initial = await createFromReadableStream<RscPayload>(rscStream);
  const root = (
    <StrictMode>
      <GlobalErrorBoundary>
        <BrowserRoot initial={initial} />
      </GlobalErrorBoundary>
    </StrictMode>
  );
  if ("__NO_HYDRATE" in globalThis) createRoot(document).render(root);
  else hydrateRoot(document, root, { formState: initial.formState });
  interceptLinks();
  suppressThemeTransitions();
  if (import.meta.hot)
    import.meta.hot.on("rsc:update", () => load(window.location.href, false));
}

void main();
