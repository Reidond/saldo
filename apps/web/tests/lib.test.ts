import type { Subscription } from "@saldo/domain";
import { describe, expect, it } from "vite-plus/test";
import { matchRoute } from "../src/app/routes";
import { addDays, formatDay, formatMoney, todayIn } from "../src/lib/format";
import {
  defaultPreferences,
  readPreferences,
  serializePreferences,
} from "../src/lib/preferences";
import {
  filterSubscriptions,
  issuesFor,
  readFilters,
  recurringTotals,
  upcomingRenewals,
} from "../src/lib/subscriptions";
import { syntheticSubscriptions } from "../src/server/api/synthetic";

const today = "2026-10-08";
const items = syntheticSubscriptions(new Date(`${today}T12:00:00Z`));
const by = (id: string) => items.find((s) => s.id === id)!;

describe("totals", () => {
  it("keeps native currencies apart and lists the display currency first", () => {
    const { currencies, excluded, trials } = recurringTotals(items, "EUR");
    expect(currencies.map((c) => c.currency)).toEqual(["EUR", "UAH", "USD"]);
    const usd = currencies.find((c) => c.currency === "USD")!;
    // 9.99 monthly + 96 yearly + 15 monthly; trials, unknown amounts and
    // cancelled, paused or unconfirmed records are not counted.
    expect(usd.monthly).toBeCloseTo(9.99 + 8 + 15, 5);
    expect(usd.yearly).toBeCloseTo(usd.monthly * 12, 5);
    expect(excluded).toBe(1);
    expect(trials).toBe(1);
  });
});

describe("renewals and attention", () => {
  it("lists confirmed renewals of active and trial records within 30 days", () => {
    const renewals = upcomingRenewals(items, today);
    expect(renewals[0]).toMatchObject({ date: "2026-10-11", inDays: 3 });
    expect(
      renewals.every((r) => r.date >= today && r.date <= addDays(today, 30)),
    ).toBe(true);
    expect(renewals.some((r) => r.subscription.status === "paused")).toBe(
      false,
    );
  });

  it("explains why a record needs a look", () => {
    const kinds = (id: string) =>
      issuesFor(by(id), items, today).map((i) => i.kind);
    expect(kinds("syn-orbit")).toEqual(
      expect.arrayContaining(["status", "currency", "cadence", "stale"]),
    );
    expect(kinds("syn-courier")).toEqual(
      expect.arrayContaining(["amount", "renewal", "stale"]),
    );
    expect(kinds("syn-harbor")).toContain("trial");
    expect(kinds("syn-lumen")).toEqual([]);
    const twin: Subscription = {
      ...by("syn-lumen"),
      id: "twin",
      currency: "EUR",
    };
    expect(
      issuesFor(twin, [...items, twin], today).map((i) => i.kind),
    ).toContain("duplicate");
  });

  it("filters by text, status, category and due date", () => {
    const filters = readFilters(
      new URLSearchParams("q=NOTES&status=active&due=30"),
    );
    expect(
      filterSubscriptions(items, filters, today).map((s) => s.name),
    ).toEqual(["Paperleaf Notes"]);
    expect(readFilters(new URLSearchParams("status=bogus")).status).toBe("all");
  });
});

describe("formatting", () => {
  it("never shifts date-only values across timezones", () => {
    expect(formatDay("2026-01-31", { locale: "en-US" })).toBe("Jan 31, 2026");
    expect(
      todayIn("Pacific/Kiritimati", new Date("2026-10-08T12:00:00Z")),
    ).toBe("2026-10-09");
    expect(todayIn("Pacific/Pago_Pago", new Date("2026-10-08T05:00:00Z"))).toBe(
      "2026-10-07",
    );
  });
  it("formats unknown currencies as plain numbers", () => {
    expect(formatMoney(4.99, "UNK", { locale: "en-US" })).toBe("4.99");
    expect(formatMoney(9.99, "USD", { locale: "en-US" })).toBe("$9.99");
  });
});

describe("preferences cookie", () => {
  it("round-trips and falls back per field", () => {
    const cookie = serializePreferences(
      { currency: "UAH", locale: "uk-UA", timeZone: "Europe/Kyiv" },
      { secure: false },
    ).split(";")[0];
    expect(readPreferences(`a=b; ${cookie}`)).toEqual({
      currency: "UAH",
      locale: "uk-UA",
      timeZone: "Europe/Kyiv",
    });
    expect(
      readPreferences("saldo_prefs=currency%3Dxx%26timeZone%3DMars"),
    ).toEqual(defaultPreferences);
    expect(readPreferences(null)).toEqual(defaultPreferences);
  });
});

describe("routes", () => {
  it("maps paths to screens", () => {
    expect(matchRoute("/")).toEqual({ name: "overview" });
    expect(matchRoute("/subscriptions/new")).toEqual({
      name: "new-subscription",
    });
    expect(matchRoute("/subscriptions/a%20b/edit")).toEqual({
      name: "edit-subscription",
      id: "a b",
    });
    expect(matchRoute("/subscriptions/%E0")).toEqual({ name: "not-found" });
    expect(matchRoute("/nope")).toEqual({ name: "not-found" });
  });
});
