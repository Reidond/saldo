import { duplicateKey, monthlyTotals, type Subscription } from "@saldo/domain";
import { addDays, daysBetween } from "./format";

export type Cadence = Subscription["cadence"];
export type Status = Subscription["status"];

export const cadenceLabels: Record<Cadence, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  weekly: "Weekly",
  quarterly: "Quarterly",
  "one-time": "One-time",
  unknown: "Not confirmed",
};

export const statusLabels: Record<Status, string> = {
  active: "Active",
  trial: "Trial",
  paused: "Paused",
  cancelled: "Cancelled",
  unknown: "Unconfirmed",
};

export const statusFilters = [
  ["all", "All"],
  ["active", "Active"],
  ["trial", "Trials"],
  ["paused", "Paused"],
  ["cancelled", "Cancelled"],
  ["unknown", "Unconfirmed"],
] as const;

export const defaultCategories = [
  "Entertainment",
  "Productivity",
  "Design",
  "Health & wellness",
  "Education",
  "Storage",
  "News",
  "Utilities",
  "Other",
];

/** Monthly-equivalent multipliers; weekly uses 52 weeks a year. */
export const monthlyFactor: Record<Cadence, number> = {
  monthly: 1,
  yearly: 1 / 12,
  weekly: 52 / 12,
  quarterly: 1 / 3,
  "one-time": 0,
  unknown: 0,
};

const live = (s: Subscription) => s.status === "active" || s.status === "trial";

export interface CurrencyTotal {
  currency: string;
  monthly: number;
  yearly: number;
}

/**
 * Confirmed recurring cost per native currency (active records with a known
 * amount, currency and cycle). Currencies are never summed together.
 */
export function recurringTotals(
  items: Subscription[],
  displayCurrency: string,
) {
  const { totals, excluded } = monthlyTotals(items);
  const currencies: CurrencyTotal[] = Object.entries(totals)
    .map(([currency, monthly]) => ({ currency, monthly, yearly: monthly * 12 }))
    .sort((a, b) =>
      a.currency === displayCurrency
        ? -1
        : b.currency === displayCurrency
          ? 1
          : b.monthly - a.monthly || a.currency.localeCompare(b.currency),
    );
  return {
    currencies,
    excluded,
    trials: items.filter((s) => s.status === "trial").length,
  };
}

export function monthlyEquivalent(s: Subscription) {
  if (s.amount === null) return null;
  const factor = monthlyFactor[s.cadence];
  return factor ? s.amount * factor : null;
}

export interface Renewal {
  subscription: Subscription;
  date: string;
  inDays: number;
}

/** Confirmed renewal dates of active and trial records within `days`. */
export function upcomingRenewals(
  items: Subscription[],
  today: string,
  days = 30,
): Renewal[] {
  const until = addDays(today, days);
  return items
    .filter(
      (s): s is Subscription & { renewalDate: string } =>
        live(s) &&
        s.renewalDate !== null &&
        s.renewalDate >= today &&
        s.renewalDate <= until,
    )
    .map((s) => ({
      subscription: s,
      date: s.renewalDate,
      inDays: daysBetween(today, s.renewalDate),
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.subscription.name.localeCompare(b.subscription.name),
    );
}

export type IssueKind =
  | "status"
  | "amount"
  | "currency"
  | "cadence"
  | "renewal"
  | "trial"
  | "stale"
  | "duplicate";

export interface Issue {
  kind: IssueKind;
  label: string;
}

const STALE_AFTER_DAYS = 180;

/** Why a saved record needs a look: missing facts, old evidence, duplicates. */
export function issuesFor(
  s: Subscription,
  items: Subscription[],
  today: string,
): Issue[] {
  const issues: Issue[] = [];
  if (s.status === "unknown")
    issues.push({ kind: "status", label: "Status not confirmed" });
  if (s.status === "cancelled") return issues;
  if (s.amount === null)
    issues.push({ kind: "amount", label: "Amount not confirmed" });
  if (s.currency === "UNK")
    issues.push({ kind: "currency", label: "Currency unknown" });
  if (s.cadence === "unknown")
    issues.push({ kind: "cadence", label: "Billing cycle unknown" });
  if (live(s)) {
    if (!s.renewalDate && s.cadence !== "one-time")
      issues.push({ kind: "renewal", label: "Next renewal unknown" });
    else if (s.renewalDate && s.renewalDate < today)
      issues.push({ kind: "renewal", label: "Renewal date has passed" });
    if (
      s.status === "trial" &&
      s.renewalDate &&
      s.renewalDate >= today &&
      daysBetween(today, s.renewalDate) <= 7
    )
      issues.push({ kind: "trial", label: "Trial ends within a week" });
  }
  if (!s.lastVerified) issues.push({ kind: "stale", label: "Never verified" });
  else if (daysBetween(s.lastVerified.slice(0, 10), today) > STALE_AFTER_DAYS)
    issues.push({ kind: "stale", label: "Not verified in 6 months" });
  const twin = possibleDuplicate(s, items);
  if (twin)
    issues.push({
      kind: "duplicate",
      label: `Possible duplicate of ${twin.name}`,
    });
  return issues;
}

/** Same name (ignoring case, spacing and punctuation) in another record. */
export function possibleDuplicate(
  s: Pick<Subscription, "id" | "name">,
  items: Subscription[],
) {
  const name = duplicateKey({ name: s.name, currency: "" });
  return items.find(
    (other) =>
      other.id !== s.id &&
      duplicateKey({ name: other.name, currency: "" }) === name,
  );
}

export function needsAttention(items: Subscription[], today: string) {
  return items
    .map((subscription) => ({
      subscription,
      issues: issuesFor(subscription, items, today),
    }))
    .filter((entry) => entry.issues.length > 0)
    .sort(
      (a, b) =>
        b.issues.length - a.issues.length ||
        a.subscription.name.localeCompare(b.subscription.name),
    );
}

export interface Filters {
  q: string;
  status: string;
  category: string;
  due: boolean;
}

export function readFilters(params: URLSearchParams): Filters {
  const status = params.get("status") ?? "all";
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    status: statusFilters.some(([value]) => value === status) ? status : "all",
    category: (params.get("category") ?? "").slice(0, 80),
    due: params.get("due") === "30",
  };
}

export function filterSubscriptions(
  items: Subscription[],
  filters: Filters,
  today: string,
) {
  const q = filters.q.toLowerCase();
  const due = filters.due
    ? new Set(upcomingRenewals(items, today).map((r) => r.subscription.id))
    : null;
  return items
    .filter(
      (s) =>
        (!q ||
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)) &&
        (filters.status === "all" || s.status === filters.status) &&
        (!filters.category || s.category === filters.category) &&
        (!due || due.has(s.id)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function categoriesOf(items: Subscription[]) {
  return Array.from(
    new Set([...defaultCategories, ...items.map((s) => s.category)]),
  )
    .filter(Boolean)
    .sort((a, b) =>
      a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
    );
}

/** Monthly equivalents by category for one currency, largest first. */
export function categoryBreakdown(items: Subscription[], currency: string) {
  const totals = new Map<string, number>();
  for (const s of items) {
    if (s.status !== "active" || s.currency !== currency) continue;
    const monthly = monthlyEquivalent(s);
    if (monthly === null) continue;
    const key = s.category || "Other";
    totals.set(key, (totals.get(key) ?? 0) + monthly);
  }
  return Array.from(totals, ([category, monthly]) => ({
    category,
    monthly,
  })).sort((a, b) => b.monthly - a.monthly);
}
