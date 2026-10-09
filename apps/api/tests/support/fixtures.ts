import type { Subscription } from "@saldo/domain";

/** Synthetic subscriptions; never use real records in tests. */
export const synthetic: Record<"streaming" | "music", Subscription> = {
  streaming: {
    id: "streaming",
    name: "Example Streaming",
    amount: 9.99,
    currency: "USD",
    cadence: "monthly",
    renewalDate: "2026-11-01",
    status: "active",
    category: "Entertainment",
    source: "manual entry",
    lastVerified: null,
    notes: "",
  },
  music: {
    id: "music",
    name: "Example Music",
    amount: 4.5,
    currency: "USD",
    cadence: "monthly",
    renewalDate: null,
    status: "active",
    category: "Entertainment",
    source: "manual entry",
    lastVerified: null,
    notes: "",
  },
};
