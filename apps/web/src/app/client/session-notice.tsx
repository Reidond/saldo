"use client";
import {
  resumeAfterSignIn,
  SESSION_EXPIRED_MESSAGE,
  useSessionExpired,
} from "../../framework/session";
import { Notice } from "../ui/components";
import { buttonClass } from "../ui/styles";

/**
 * Shown when Access or the API refused this tab's session. Requests that
 * were refused wait here instead of failing, and the tab keeps its unsaved
 * drafts, typed messages and form values until the owner chooses Reload.
 */
export function SessionNotice() {
  const expired = useSessionExpired();
  if (!expired) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl bg-surface shadow-pop transition-[opacity,translate] duration-150 ease-out starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none">
        <Notice
          role="alert"
          tone="warn"
          title={SESSION_EXPIRED_MESSAGE}
          action={
            <div className="flex flex-wrap gap-2">
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "primary" })}
              >
                Sign in in a new tab
              </a>
              <button
                type="button"
                onClick={resumeAfterSignIn}
                className={buttonClass()}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className={buttonClass({ variant: "ghost" })}
              >
                Reload
              </button>
            </div>
          }
        >
          Unsaved drafts and typing stay in this tab only until it reloads. To
          keep them, sign in again in a new tab, then choose Try again here.
        </Notice>
      </div>
    </div>
  );
}
