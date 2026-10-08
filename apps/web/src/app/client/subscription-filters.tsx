"use client";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../../framework/navigation";
import { cx, inputClass, selectClass } from "../ui/styles";

/**
 * Search and category filter. A plain GET form without JavaScript; with it,
 * typing updates the URL (debounced) and the server re-renders the list.
 */
export function SubscriptionFilters({
  q,
  status,
  category,
  due,
  categories,
}: {
  q: string;
  status: string;
  category: string;
  due: boolean;
  categories: string[];
}) {
  const { navigate } = useNavigation();
  const [query, setQuery] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow the URL (e.g. "Reset filters") unless the person is typing.
  useEffect(() => {
    if (document.activeElement !== input.current) setQuery(q);
  }, [q]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = (next: { q?: string; category?: string }) => {
    const params = new URLSearchParams();
    const nextQ = (next.q ?? query).trim();
    const nextCategory = next.category ?? category;
    if (nextQ) params.set("q", nextQ);
    if (status !== "all") params.set("status", status);
    if (nextCategory) params.set("category", nextCategory);
    if (due) params.set("due", "30");
    const search = params.toString();
    navigate(`/subscriptions${search ? `?${search}` : ""}`, { replace: true });
  };

  return (
    <form
      method="get"
      action="/subscriptions"
      role="search"
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        apply({});
      }}
    >
      {status !== "all" && <input type="hidden" name="status" value={status} />}
      {due && <input type="hidden" name="due" value="30" />}
      <label className="relative flex-1">
        <span className="sr-only">Search subscriptions</span>
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4.5 -translate-y-1/2 text-ink-faint"
          absoluteStrokeWidth
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <input
          ref={input}
          type="search"
          name="q"
          value={query}
          autoComplete="off"
          placeholder="Search by name or category"
          className={cx(
            inputClass,
            "ps-9.5 pe-10 [&::-webkit-search-cancel-button]:hidden",
          )}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => apply({ q: value }), 250);
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute end-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-ink-muted hover:text-ink"
            onClick={() => {
              setQuery("");
              clearTimeout(timer.current);
              apply({ q: "" });
              input.current?.focus();
            }}
          >
            <X
              className="size-4"
              absoluteStrokeWidth
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </button>
        )}
      </label>
      <label className="sm:w-56">
        <span className="sr-only">Category</span>
        <select
          name="category"
          value={category}
          className={selectClass}
          onChange={(event) => apply({ category: event.target.value })}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button type="submit" className="h-10 rounded-lg px-4 text-sm">
          Apply
        </button>
      </noscript>
    </form>
  );
}
