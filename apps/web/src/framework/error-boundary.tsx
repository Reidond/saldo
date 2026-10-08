"use client";
import { Component, type ReactNode } from "react";

/** Last-resort screen when the client cannot render the app at all. */
export class GlobalErrorBoundary extends Component<
  { children?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <html lang="en">
        <head>
          <title>Saldo · Something went wrong</title>
        </head>
        <body className="grid min-h-svh place-items-center bg-canvas p-6 text-ink">
          <main className="max-w-sm">
            <p className="text-xl font-semibold tracking-tight text-brand">
              saldo.
            </p>
            <h1 className="mt-6 text-lg font-semibold text-balance">
              Saldo couldn’t show this page.
            </h1>
            <p className="mt-2 text-pretty text-ink-muted">
              Nothing was changed. Reload to try again.
            </p>
            <button
              type="button"
              className="mt-5 rounded-lg bg-brand px-4 py-2 font-medium text-brand-ink"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </main>
        </body>
      </html>
    );
  }
}
