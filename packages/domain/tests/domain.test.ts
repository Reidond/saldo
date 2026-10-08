import { describe, it, expect } from "vite-plus/test";
import {
  subscriptionSchema,
  validateReview,
  monthlyTotals,
  chatSchema,
  type Subscription,
} from "../src/domain.js";
import { parseInventoryCsv, csvRows } from "../src/import.js";
const sub: Subscription = {
  id: "one",
  name: "Example",
  amount: 120,
  currency: "USD",
  cadence: "yearly",
  status: "active",
  renewalDate: "2027-02-28",
  category: "Work",
  source: "manual",
  lastVerified: null,
  notes: "",
};
describe("financial records", () => {
  it("keeps currencies separate and excludes uncertainty", () =>
    expect(
      monthlyTotals([
        sub,
        { ...sub, id: "two", currency: "EUR" },
        { ...sub, id: "three", amount: null },
      ]),
    ).toEqual({ totals: { USD: 10, EUR: 10 }, excluded: 1 }));
  it("rejects malformed screenshot-extracted fields", () => {
    expect(() => subscriptionSchema.parse({ ...sub, amount: -1 })).toThrow();
    expect(() =>
      subscriptionSchema.parse({ ...sub, renewalDate: "2026-02-31" }),
    ).toThrow();
    expect(() => subscriptionSchema.parse({ ...sub, currency: "$" })).toThrow();
  });
  it("rejects duplicate imports", () =>
    expect(() =>
      validateReview(
        [{ ...sub, id: "two", name: " EXAMPLE ", operation: "add" }],
        [sub],
      ),
    ).toThrow("duplicate"));
  it("requires existing update targets", () =>
    expect(() =>
      validateReview(
        [{ ...sub, operation: "update", targetId: "missing" }],
        [sub],
      ),
    ).toThrow("target"));
  it("updates without mutating source", () => {
    const next = validateReview(
      [{ ...sub, amount: 130, operation: "update", targetId: "one" }],
      [sub],
    );
    expect(next[0].amount).toBe(130);
    expect(sub.amount).toBe(120);
  });
  it("rejects repeated target IDs in a batch", () =>
    expect(() =>
      validateReview(
        [
          { ...sub, operation: "add" },
          { ...sub, operation: "add" },
        ],
        [],
      ),
    ).toThrow("Repeated"));
});
describe("import review", () => {
  it("parses quoted commas/newlines and BOM", () =>
    expect(csvRows('\uFEFFservice,notes\r\n"Example","a,b\nc"')).toEqual([
      ["service", "notes"],
      ["Example", "a,b\nc"],
    ]));
  it("preserves unknown fields without invented billing facts", () => {
    const [s] = parseInventoryCsv(
      "service,amount,currency,cadence,status,next_or_end_date,date_type\nExample,,USD,unclear,possible,2026-12-01,end",
    );
    expect(s.amount).toBeNull();
    expect(s.status).toBe("unknown");
    expect(s.renewalDate).toBeNull();
    expect(s.warnings?.length).toBe(2);
  });
  it("rejects invalid amounts and incomplete CSV", () => {
    expect(() =>
      parseInventoryCsv(
        "service,amount,currency,cadence,status\nExample,abc,USD,monthly,active",
      ),
    ).toThrow("amount");
    expect(() => csvRows('service\n"unfinished')).toThrow();
  });
});
describe("boundaries", () => {
  it("rejects mislabeled uploads and empty chat", () => {
    expect(() => chatSchema.parse({ message: "", attachments: [] })).toThrow();
    expect(() =>
      chatSchema.parse({
        message: "parse",
        attachments: [
          {
            name: "x",
            type: "image/png",
            dataUrl: "data:text/html;base64,QQ==",
          },
        ],
      }),
    ).toThrow();
  });
});
it("accepts minimal CSV without inventing price, currency or status", () => {
  const [s] = parseInventoryCsv("service\nExample");
  expect(s.currency).toBe("UNK");
  expect(s.amount).toBeNull();
  expect(s.status).toBe("unknown");
  expect(s.cadence).toBe("unknown");
});
it("bounds long assistant replies and repeated chat history to server limits", async () => {
  const { boundedChatHistory } = await import("../src/domain.js");
  const history = boundedChatHistory(
    Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      content: "x".repeat(24000),
    })),
  );
  expect(history.length).toBeLessThanOrEqual(20);
  expect(history.every((m) => m.content.length <= 12000)).toBe(true);
  expect(history.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(
    60000,
  );
  expect(() =>
    chatSchema.parse({ message: "continue", history }),
  ).not.toThrow();
});
