import {
  parseInventoryCsv,
  subscriptionSchema,
  type Proposal,
} from "@saldo/domain";
import { describe, expect, it } from "vite-plus/test";
import { defaultPreferences } from "../src/lib/preferences";
import {
  removeSubscription,
  savePreferences,
  saveProposal,
  saveSubscription,
} from "../src/server/actions";
import { ApiError, type ApiClient } from "../src/server/api";
import {
  createSyntheticApiClient,
  syntheticSubscriptions,
} from "../src/server/api/synthetic";
import { createRequestContext, runWithContext } from "../src/server/context";
import { toCsv } from "../src/server/routes/export";

function contextFor(api: ApiClient) {
  return createRequestContext({
    url: new URL("https://saldo.example/subscriptions/new"),
    api,
    dataSource: "synthetic",
    preferences: defaultPreferences,
    secureCookies: true,
  });
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const validForm = {
  name: "Synthetic Work",
  amount: "",
  currency: "USD",
  cadence: "monthly",
  status: "active",
  renewalDate: "",
  category: "Other",
  source: "",
  notes: "",
};

describe("manual subscription actions", () => {
  it("rejects invalid fields without calling the API", async () => {
    let calls = 0;
    const api = new Proxy(createSyntheticApiClient({ seed: [] }), {
      get: (target, key) => {
        calls++;
        return target[key as keyof ApiClient];
      },
    });
    const result = await runWithContext(contextFor(api), () =>
      saveSubscription(
        { status: "idle" },
        form({
          ...validForm,
          name: " ",
          amount: "-3",
          currency: "dollars",
          renewalDate: "2026-02-30",
        }),
      ),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      "amount",
      "currency",
      "name",
      "renewalDate",
    ]);
    expect(calls).toBe(0);
  });

  it("sends schema-valid records and marks verification only when asked", async () => {
    const api = createSyntheticApiClient({ seed: [] });
    const context = contextFor(api);
    const result = await runWithContext(context, () =>
      saveSubscription(
        { status: "idle" },
        form({ ...validForm, amount: "4,50", verifiedNow: "on" }),
      ),
    );
    expect(result.status).toBe("saved");
    const [saved] = await api.listSubscriptions();
    expect(() => subscriptionSchema.parse(saved)).not.toThrow();
    expect(saved).toMatchObject({
      name: "Synthetic Work",
      amount: 4.5,
      source: "Manual entry",
    });
    expect(saved.lastVerified).not.toBeNull();
  });

  it("surfaces the API's duplicate message and removes without cancelling", async () => {
    const api = createSyntheticApiClient();
    const context = contextFor(api);
    const duplicate = await runWithContext(context, () =>
      saveSubscription(
        { status: "idle" },
        form({ ...validForm, name: "Lumen Music" }),
      ),
    );
    expect(duplicate.status === "error" && duplicate.message).toMatch(
      /duplicate/i,
    );
    const removed = await runWithContext(context, () =>
      removeSubscription("syn-lumen"),
    );
    expect(removed).toEqual({ ok: true });
    expect(
      (await api.listSubscriptions()).some((s) => s.id === "syn-lumen"),
    ).toBe(false);
    const missing = await runWithContext(context, () =>
      removeSubscription("syn-lumen"),
    );
    expect(missing.ok).toBe(false);
  });
});

describe("review decisions", () => {
  const proposal = (): Proposal => ({
    ...parseInventoryCsv(
      "service,amount,currency,cadence,status\nSynthetic Plan,2,EUR,monthly,active",
    )[0],
  });

  it("retries an uncertain save with the same request ID and saves once", async () => {
    const synthetic = createSyntheticApiClient({ seed: [] });
    const requestIds: string[] = [];
    let attempts = 0;
    const api: ApiClient = {
      ...synthetic,
      saveReview: async (review) => {
        requestIds.push(review.requestId);
        attempts++;
        const result = await synthetic.saveReview(review);
        // The first save lands but its response is lost on the way back.
        if (attempts === 1) throw new ApiError("unavailable");
        return result;
      },
    };
    const input = { requestId: crypto.randomUUID(), proposal: proposal() };
    const first = await runWithContext(contextFor(api), () =>
      saveProposal(input),
    );
    expect(first).toMatchObject({ ok: false, retryable: true });
    const retry = await runWithContext(contextFor(api), () =>
      saveProposal(input),
    );
    expect(retry).toMatchObject({ ok: true, alreadySaved: true });
    expect(requestIds).toEqual([input.requestId, input.requestId]);
    expect(await synthetic.listSubscriptions()).toHaveLength(1);
  });

  it("refuses a duplicate as a non-retryable decision", async () => {
    const api = createSyntheticApiClient();
    const result = await runWithContext(contextFor(api), () =>
      saveProposal({
        requestId: crypto.randomUUID(),
        proposal: { ...proposal(), name: "Lumen Music", currency: "USD" },
      }),
    );
    expect(result).toMatchObject({ ok: false, retryable: false });
  });

  it("validates its input before calling the API", async () => {
    const api = createSyntheticApiClient();
    const result = await runWithContext(contextFor(api), () =>
      saveProposal({ requestId: "not-a-uuid", proposal: proposal() }),
    );
    expect(result).toMatchObject({ ok: false, retryable: false });
  });
});

describe("preferences and export", () => {
  it("stores valid preferences in an HttpOnly cookie and rejects invalid ones", async () => {
    const context = contextFor(createSyntheticApiClient());
    const saved = await runWithContext(context, () =>
      savePreferences(
        { status: "idle" },
        form({ currency: "eur", locale: "uk-UA", timeZone: "Europe/Kyiv" }),
      ),
    );
    expect(saved).toEqual({ status: "saved" });
    expect(context.preferences).toEqual({
      currency: "EUR",
      locale: "uk-UA",
      timeZone: "Europe/Kyiv",
    });
    const cookie = context.responseHeaders.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    const invalid = await runWithContext(context, () =>
      savePreferences(
        { status: "idle" },
        form({ currency: "EUR", locale: "en-US", timeZone: "Mars/Base" }),
      ),
    );
    expect(invalid.status).toBe("error");
  });

  it("exports CSV that the importer reads back", () => {
    const items = syntheticSubscriptions(new Date("2026-10-08T12:00:00Z"));
    const rows = parseInventoryCsv(toCsv(items));
    expect(rows.map((r) => r.name)).toEqual(items.map((s) => s.name));
    expect(rows.map((r) => r.renewalDate)).toEqual(
      items.map((s) => s.renewalDate),
    );
    expect(rows.map((r) => r.amount)).toEqual(items.map((s) => s.amount));
  });
});
