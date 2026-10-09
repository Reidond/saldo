/** Display preferences. Kept in a cookie in this browser; never sent to the API. */
export interface Preferences {
  currency: string;
  locale: string;
  timeZone: string;
}

export const PREFERENCES_COOKIE = "saldo_prefs";

export const defaultPreferences: Preferences = {
  currency: "USD",
  locale: "en-US",
  timeZone: "UTC",
};

export const localeOptions = [
  ["en-US", "English (United States)"],
  ["en-GB", "English (United Kingdom)"],
  ["uk-UA", "Українська (Україна)"],
  ["de-DE", "Deutsch (Deutschland)"],
  ["fr-FR", "Français (France)"],
  ["es-ES", "Español (España)"],
  ["pl-PL", "Polski (Polska)"],
] as const;

export const currencyOptions = [
  "USD",
  "EUR",
  "GBP",
  "UAH",
  "PLN",
  "CHF",
  "CAD",
  "JPY",
] as const;

export function validCurrency(value: string) {
  return /^[A-Z]{3}$/.test(value) && value !== "UNK";
}

export function validLocale(value: string) {
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

export function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Reads preferences from a Cookie header, falling back per field. */
export function readPreferences(cookieHeader: string | null): Preferences {
  const raw = cookieHeader
    ?.split(/;\s*/)
    .find((part) => part.startsWith(`${PREFERENCES_COOKIE}=`))
    ?.slice(PREFERENCES_COOKIE.length + 1);
  if (!raw) return defaultPreferences;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(decodeURIComponent(raw));
  } catch {
    return defaultPreferences;
  }
  const currency = params.get("currency") ?? "";
  const locale = params.get("locale") ?? "";
  const timeZone = params.get("timeZone") ?? "";
  return {
    currency: validCurrency(currency) ? currency : defaultPreferences.currency,
    locale: validLocale(locale) ? locale : defaultPreferences.locale,
    timeZone: validTimeZone(timeZone) ? timeZone : defaultPreferences.timeZone,
  };
}

export function serializePreferences(
  preferences: Preferences,
  { secure }: { secure: boolean },
) {
  const value = encodeURIComponent(
    new URLSearchParams({ ...preferences }).toString(),
  );
  return [
    `${PREFERENCES_COOKIE}=${value}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
