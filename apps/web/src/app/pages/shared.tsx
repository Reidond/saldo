import { RotateCw } from "lucide-react";
import { ApiError, isApiError } from "../../server/api";
import { getRequestContext } from "../../server/context";
import { Card, Notice } from "../ui/components";
import { buttonClass } from "../ui/styles";

export type Loaded<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** Runs a read and turns any failure into an ApiError the page can show. */
export async function attempt<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return {
      ok: false,
      error: isApiError(error) ? error : new ApiError("unavailable"),
    };
  }
}

export function Title({ children }: { children: string }) {
  return <title>{`${children} · Saldo`}</title>;
}

/** Shown in place of a page whose data could not be loaded. */
export function LoadError({ error, what }: { error: ApiError; what: string }) {
  const { url } = getRequestContext();
  const expired = error.code === "unauthenticated";
  return (
    <Notice
      role="alert"
      tone={expired ? "warn" : "danger"}
      title={expired ? "Your session expired" : `Couldn’t load ${what}`}
      action={
        <a
          href={`${url.pathname}${url.search}`}
          className={buttonClass({ size: "sm", icon: "leading" })}
          {...(expired ? { "data-reload": "" } : {})}
        >
          <RotateCw
            className="size-4"
            absoluteStrokeWidth
            strokeWidth={1.5}
            aria-hidden="true"
          />
          {expired ? "Reload to sign in" : "Try again"}
        </a>
      }
    >
      {expired
        ? "Sign in again through Cloudflare Access. Nothing was changed."
        : error.message}
    </Notice>
  );
}

function Bone({ className }: { className: string }) {
  return (
    <div
      className={`rounded-lg bg-surface-sunken motion-safe:animate-pulse ${className}`}
    />
  );
}

/** First-load placeholder while a page's data streams in. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Bone className="h-8 w-48" />
      <Bone className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <Bone className="h-4 w-24" />
            <Bone className="mt-4 h-7 w-32" />
            <Bone className="mt-3 h-3 w-40" />
          </Card>
        ))}
      </div>
      <Card className="mt-4 p-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <Bone className="size-10" />
            <div className="flex-1">
              <Bone className="h-4 w-40" />
              <Bone className="mt-2 h-3 w-24" />
            </div>
            <Bone className="h-4 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}
