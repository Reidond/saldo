import type { Preferences } from "./preferences";

type Locale = Pick<Preferences, "locale">;

/** Money in its native currency. `UNK` (unknown currency) shows the bare number. */
export function formatMoney(
  amount: number,
  currency: string,
  { locale }: Locale,
) {
  if (currency === "UNK")
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Splits a calendar date without any timezone conversion. */
function dateParts(isoDate: string) {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** A date-only value (renewals): its calendar day never shifts. */
export function formatDay(
  isoDate: string,
  { locale }: Locale,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
) {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(dateParts(isoDate));
}

/** A moment in time (verification), shown in the owner's timezone. */
export function formatMoment(
  iso: string,
  { locale, timeZone }: Pick<Preferences, "locale" | "timeZone">,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** Today's calendar date (YYYY-MM-DD) in a timezone. */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(isoDate: string, days: number) {
  const d = dateParts(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round(
    (dateParts(toIso).getTime() - dateParts(fromIso).getTime()) / 86_400_000,
  );
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDays(days: number, { locale }: Locale) {
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    days,
    "day",
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
