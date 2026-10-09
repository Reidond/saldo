import {
  createTemporaryReferenceSet,
  decodeAction,
  decodeFormState,
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from "@vitejs/plugin-rsc/rsc/server";
import type { ReactNode } from "react";
import type { ReactFormState } from "react-dom/client";
import { Root } from "../app/root";
import { matchRoute } from "../app/routes";
import type { WebEnv } from "../server/config";
import { runWithContext, type RequestContext } from "../server/context";
import { gate } from "../server/gate";
import {
  baseHeaders,
  contentLength,
  contentSecurityPolicy,
  nonce as createNonce,
  sameOrigin,
} from "../server/http";
import { staticPage } from "../server/static-pages";
import { parseRenderRequest } from "./request";

export interface RscPayload {
  root: ReactNode;
  returnValue?: { ok: true; data: unknown } | { ok: false; message: string };
  formState?: ReactFormState;
}

const ACTION_BODY_LIMIT = 1_000_000;

export default {
  fetch: (request: Request, env: WebEnv) => handle(request, env),
};

/** Every request: the gate authenticates, then React renders. */
export async function handle(request: Request, env: WebEnv) {
  const result = await gate(request, env, {
    allowSynthetic: import.meta.env.DEV,
  });
  if (result.kind === "response") return result.response;
  return runWithContext(result.context, () =>
    render(request, result.origin, result.context),
  );
}

async function render(
  request: Request,
  origin: string,
  context: RequestContext,
) {
  let renderRequest;
  try {
    renderRequest = parseRenderRequest(request);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  let returnValue: RscPayload["returnValue"];
  let formState: ReactFormState | undefined;
  let temporaryReferences: unknown;

  if (renderRequest.isAction) {
    if (!sameOrigin(request, origin)) return staticPage("forbidden", 403);
    const length = contentLength(request);
    if (length === null || length > ACTION_BODY_LIMIT)
      return new Response("Request too large", { status: 413 });
    if (renderRequest.actionId) {
      const body = (request.headers.get("Content-Type") ?? "").startsWith(
        "multipart/form-data",
      )
        ? await request.formData()
        : await request.text();
      temporaryReferences = createTemporaryReferenceSet();
      const args = await decodeReply(body, { temporaryReferences });
      const action = await loadServerAction(renderRequest.actionId);
      try {
        returnValue = { ok: true, data: await action(...(args as unknown[])) };
      } catch (error) {
        console.error("Server action failed", error);
        returnValue = {
          ok: false,
          message: "Something went wrong. Nothing was changed.",
        };
      }
    } else {
      // A form posted before JavaScript loaded (progressive enhancement).
      const formData = await request.formData();
      const action = await decodeAction(formData);
      try {
        formState = await decodeFormState(await action(), formData);
      } catch (error) {
        console.error("Form action failed", error);
      }
    }
  }

  const payload: RscPayload = {
    root: <Root url={renderRequest.url} />,
    formState,
    returnValue,
  };
  const rscStream = renderToReadableStream<RscPayload>(payload, {
    temporaryReferences,
    onError: logRenderError,
  });
  const route = matchRoute(renderRequest.url.pathname);

  if (renderRequest.isRsc) {
    const headers = baseHeaders("text/x-component; charset=utf-8");
    context.responseHeaders.forEach((value, key) => headers.append(key, value));
    return new Response(rscStream, { headers });
  }

  const nonce = createNonce();
  const ssr = await import.meta.viteRsc.loadModule<
    typeof import("./entry.ssr")
  >("ssr", "index");
  const html = await ssr.renderHTML(rscStream, { formState, nonce });
  const headers = baseHeaders("text/html; charset=utf-8");
  if (!import.meta.env.DEV)
    headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  context.responseHeaders.forEach((value, key) => headers.append(key, value));
  return new Response(html.stream, {
    status: html.status ?? (route.name === "not-found" ? 404 : 200),
    headers,
  });
}

function logRenderError(error: unknown) {
  // Rendering errors never include record contents in the message we log.
  console.error(
    "Render failed",
    error instanceof Error ? error.name : typeof error,
  );
}

if (import.meta.hot) import.meta.hot.accept();
