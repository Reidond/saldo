// Shared by the browser entry and client components: how a request refused
// for an ended Access session is recognised, announced and resumed. The tab
// keeps everything it holds while the owner signs in again elsewhere.
import { useEffect, useSyncExternalStore } from "react";

export const SESSION_EXPIRED_MESSAGE =
  "Your session expired. Reload to sign in again.";

/**
 * Cloudflare Access refuses an expired session with 401 when the request
 * says `X-Requested-With: XMLHttpRequest`, or with a redirect to its sign-in
 * page, which `redirect: "manual"` turns into an opaque redirect. The gate
 * answers 401 too, when the token fails verification or the API ended the
 * session (a sign-out).
 */
export function isSessionEnded(response: Response) {
  return response.status === 401 || response.type === "opaqueredirect";
}

let expired = false;
let resumed: Promise<void> | null = null;
let resume: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows the session notice (src/app/client/session-notice.tsx). */
export function markSessionExpired() {
  if (expired) return;
  expired = true;
  notify();
}

/**
 * Shows the session notice and resolves when the owner chooses Try again,
 * having signed in again (for example in another tab). Requests refused
 * this way never reached the app, so sending them again is safe.
 */
export function waitForSignIn(): Promise<void> {
  markSessionExpired();
  resumed ??= new Promise<void>((resolve) => {
    resume = resolve;
  });
  return resumed;
}

/** Hides the notice and sends every request that was waiting again. */
export function resumeAfterSignIn() {
  const waiting = resume;
  expired = false;
  resumed = null;
  resume = null;
  notify();
  waiting?.();
}

export function useSessionExpired() {
  return useSyncExternalStore(
    subscribe,
    () => expired,
    () => false,
  );
}

const unsavedChecks = new Set<() => boolean>();

/**
 * Registers a check for work that exists only in this tab. While any check
 * is true, an expired session pauses navigation instead of reloading the
 * page, so nothing is thrown away.
 */
export function registerUnsavedWork(check: () => boolean) {
  unsavedChecks.add(check);
  return () => {
    unsavedChecks.delete(check);
  };
}

export function hasUnsavedWork() {
  for (const check of unsavedChecks) if (check()) return true;
  return false;
}

/** Marks this component's state as unsaved work while `dirty` is true. */
export function useUnsavedWork(dirty: boolean) {
  useEffect(
    () => (dirty ? registerUnsavedWork(() => true) : undefined),
    [dirty],
  );
}
