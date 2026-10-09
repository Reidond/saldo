import "server-only";
import { baseHeaders } from "./http";

const pages = {
  "signed-out": {
    title: "Sign in to Saldo",
    heading: "This is a private Saldo workspace.",
    body: "Sign in through Cloudflare Access as the owner to continue. If you just signed in, reload the page.",
    action: '<a href="/">Reload</a>',
  },
  unconfigured: {
    title: "Saldo is not available",
    heading: "Saldo isn’t configured yet.",
    body: "This Worker is missing its API binding or Access settings, so it shows nothing. No data was read.",
    action: "",
  },
  forbidden: {
    title: "Request refused",
    heading: "That request came from somewhere else.",
    body: "Saldo only accepts changes made on this site. Nothing was changed.",
    action: '<a href="/">Back to Saldo</a>',
  },
} as const;

/**
 * Self-contained pages for requests that never reach the app: no scripts,
 * stylesheets or data, because assets are protected by the same check.
 */
export function staticPage(kind: keyof typeof pages, status: number) {
  const page = pages[kind];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${page.title}</title><style>
:root{color-scheme:light dark;--bg:#f7f8f4;--fg:#1f2a24;--muted:#5d6a62;--brand:#2b5f47}
@media (prefers-color-scheme:dark){:root{--bg:#141a17;--fg:#eef1ec;--muted:#a3b0a8;--brand:#8fd0ad}}
body{margin:0;min-height:100svh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:26rem;padding:24px}
b{font-size:22px;letter-spacing:-.02em;color:var(--brand)}
h1{font-size:20px;line-height:1.3;margin:24px 0 8px;text-wrap:balance}
p{color:var(--muted);margin:0 0 20px;text-wrap:pretty}
a{color:var(--brand);font-weight:600}
</style></head><body><main><b>saldo.</b><h1>${page.heading}</h1><p>${page.body}</p>${page.action}</main></body></html>`;
  const headers = baseHeaders("text/html; charset=utf-8");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  return new Response(html, { status, headers });
}
