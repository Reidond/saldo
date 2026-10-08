import {
  createFromReadableStream,
  getClientEntryUrl,
} from "@vitejs/plugin-rsc/ssr";
import { use } from "react";
import type { ReactFormState } from "react-dom/client";
import { renderToReadableStream } from "react-dom/server.edge";
import { injectRSCPayload } from "rsc-html-stream/server";
import type { RscPayload } from "./entry.rsc";

/** Turns the RSC stream into HTML and inlines the payload for hydration. */
export async function renderHTML(
  rscStream: ReadableStream<Uint8Array>,
  options: { formState?: ReactFormState; nonce: string },
): Promise<{ stream: ReadableStream<Uint8Array>; status?: number }> {
  const [forHtml, forHydration] = rscStream.tee();
  let payload: Promise<RscPayload> | undefined;
  function SsrRoot() {
    payload ??= createFromReadableStream<RscPayload>(forHtml, {
      nonce: options.nonce,
    });
    return use(payload).root;
  }
  const bootstrapScriptContent = `import(${JSON.stringify(getClientEntryUrl())})`;
  let status: number | undefined;
  let htmlStream: ReadableStream<Uint8Array>;
  try {
    htmlStream = await renderToReadableStream(<SsrRoot />, {
      bootstrapScriptContent,
      nonce: options.nonce,
      formState: options.formState,
    });
  } catch {
    // Render on the client instead; the error boundary there shows a message.
    status = 500;
    htmlStream = await renderToReadableStream(
      <html lang="en">
        <body>
          <noscript>Saldo could not render this page.</noscript>
        </body>
      </html>,
      {
        bootstrapScriptContent: `self.__NO_HYDRATE=1;${bootstrapScriptContent}`,
        nonce: options.nonce,
      },
    );
  }
  return {
    stream: htmlStream.pipeThrough(
      injectRSCPayload(forHydration, { nonce: options.nonce }),
    ),
    status,
  };
}
