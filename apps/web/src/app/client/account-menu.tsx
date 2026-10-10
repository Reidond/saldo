"use client";
import { LogOut, Settings2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Initial } from "../ui/components";
import { cx } from "../ui/styles";
import { SignOutLink } from "./sign-out-link";

/** The account popover in the phone top bar. */
export function AccountMenu({
  name,
  email,
}: {
  name: string;
  email: string | null;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={root}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account: ${name}`}
        onClick={() => setOpen((value) => !value)}
        className="grid size-11 place-items-center rounded-full transition-[scale] duration-150 ease-out motion-safe:active:scale-[0.96]"
      >
        <Initial name={name} />
      </button>
      <div
        id={menuId}
        hidden={!open}
        className={cx(
          "absolute top-full right-0 z-40 mt-1 w-64 origin-top-right rounded-[14px] bg-surface p-1.5 shadow-pop",
          "transition-[opacity,scale] duration-150 ease-out starting:scale-[0.96] starting:opacity-0",
        )}
      >
        <div className="px-2.5 pt-2 pb-2.5">
          <p className="truncate text-sm font-medium">{name}</p>
          {email && <p className="truncate text-sm text-ink-muted">{email}</p>}
          <p className="mt-1 text-xs text-ink-faint">
            Signed in with Cloudflare Access
          </p>
        </div>
        <div className="my-1 h-px bg-line" />
        <a
          href="/settings"
          onClick={() => setOpen(false)}
          className="flex h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-surface-hover"
        >
          <Settings2
            className="size-4.5 text-ink-muted"
            absoluteStrokeWidth
            strokeWidth={1.5}
            aria-hidden="true"
          />
          Settings
        </a>
        <SignOutLink className="flex h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-surface-hover">
          <LogOut
            className="size-4.5 text-ink-muted"
            absoluteStrokeWidth
            strokeWidth={1.5}
            aria-hidden="true"
          />
          Sign out
        </SignOutLink>
      </div>
    </div>
  );
}
