"use client";
import { useTransition, type ReactNode } from "react";
import { SIGN_OUT_HREF } from "../routes";

/**
 * Signs out of Saldo, then of Cloudflare Access. Saldo first refuses every
 * token issued so far (POST /session/sign-out), closing the 20–30 seconds
 * Access takes to revoke them; the browser then goes to the Access logout
 * whatever that answered. Without JavaScript the link goes straight there.
 */
export function SignOutLink({
  className,
  children,
  label,
  title,
}: {
  className?: string;
  children: ReactNode;
  /** Accessible name when the link shows only an icon. */
  label?: string;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <a
      href={SIGN_OUT_HREF}
      aria-label={label}
      title={title}
      aria-disabled={pending || undefined}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        if (pending) return;
        startTransition(async () => {
          await fetch("/session/sign-out", {
            method: "POST",
            headers: { "X-Requested-With": "XMLHttpRequest" },
            redirect: "manual",
          }).catch(() => undefined);
          window.location.assign(SIGN_OUT_HREF);
        });
      }}
    >
      {children}
    </a>
  );
}
