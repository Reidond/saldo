"use client";
import { createContext, useContext } from "react";

export interface NavigateOptions {
  /** Replace the history entry (filters, search) instead of pushing one. */
  replace?: boolean;
  /** Scroll to the top once the new page renders. Defaults to `!replace`. */
  scroll?: boolean;
}

export interface Navigation {
  /** True while the next page's RSC payload is loading. */
  pending: boolean;
  navigate: (href: string, options?: NavigateOptions) => void;
}

/** Provided by the browser entry; falls back to full page loads in SSR. */
export const NavigationContext = createContext<Navigation>({
  pending: false,
  navigate: (href) => window.location.assign(href),
});

export function useNavigation() {
  return useContext(NavigationContext);
}
