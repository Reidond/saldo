"use client";
import { useNavigation } from "../../framework/navigation";
import { cx } from "../ui/styles";

/**
 * A thin bar while the next page loads. It fades in after 150ms, so quick
 * navigations never flash it.
 */
export function NavigationProgress() {
  const { pending } = useNavigation();
  return (
    <div
      className={cx(
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-150 ease-out",
        pending ? "opacity-100 delay-150" : "opacity-0",
      )}
      aria-hidden={!pending}
    >
      <div
        className={cx(
          "h-full w-2/5 rounded-full bg-brand",
          pending && "motion-safe:animate-progress",
        )}
      />
      <span className="sr-only" role="status">
        {pending ? "Loading page…" : ""}
      </span>
    </div>
  );
}
