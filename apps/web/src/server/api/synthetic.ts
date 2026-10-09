import "server-only";
import {
  proposalSchema,
  subscriptionSchema,
  validateReview,
  type Proposal,
  type Subscription,
} from "@saldo/domain";
import {
  ApiError,
  type ApiClient,
  type ChatInput,
  type ReviewInput,
  type SubscriptionInput,
} from "./client";

/**
 * An in-memory ApiClient with fictional records, for `vp dev` and tests only.
 * It mirrors the API's validation (duplicates, review idempotency, 404s) so the
 * UI behaves the same as against the real Worker. Never real data.
 */
export interface SyntheticOptions {
  ai?: "available" | "unavailable";
  seed?: Subscription[];
  /** Milliseconds the fake AI waits before answering. */
  aiDelayMs?: number;
  /** Every data call fails as if the API Worker were unreachable. */
  down?: boolean;
  /** The API refuses the session, as after a sign-out. */
  signedOut?: boolean;
}

export function createSyntheticApiClient(
  options: SyntheticOptions = {},
): ApiClient {
  let items = (options.seed ?? syntheticSubscriptions()).map((s) =>
    subscriptionSchema.parse(s),
  );
  const reviewed = new Set<string>();
  const ai = options.ai ?? "unavailable";
  const find = (id: string) => {
    const item = items.find((s) => s.id === id);
    if (!item) throw new ApiError("not_found", undefined, 404);
    return item;
  };
  const guard = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error instanceof Error ? error.message : "";
      throw new ApiError(
        "invalid",
        /duplicate|target/i.test(message) ? message : undefined,
        400,
      );
    }
  };

  const client: ApiClient = {
    async status() {
      return { authenticated: true, aiConnected: ai === "available" };
    },
    async me() {
      return {
        id: "synthetic-owner",
        email: "owner@example.com",
        displayName: "Sample Owner",
        role: "owner",
      };
    },
    async signOut() {},
    async listSubscriptions() {
      return structuredClone(items);
    },
    async createSubscription(input: SubscriptionInput) {
      return guard(() => {
        const s = subscriptionSchema.parse({
          ...input,
          id: crypto.randomUUID(),
        });
        items = validateReview([{ ...s, operation: "add" }], items);
        return structuredClone(s);
      });
    },
    async updateSubscription(id: string, input: SubscriptionInput) {
      find(id);
      return guard(() => {
        const s = subscriptionSchema.parse({ ...input, id });
        items = validateReview(
          [{ ...s, operation: "update", targetId: id }],
          items,
        );
        return structuredClone(s);
      });
    },
    async deleteSubscription(id: string) {
      find(id);
      items = items.filter((s) => s.id !== id);
    },
    async saveReview(review: ReviewInput) {
      if (reviewed.has(review.requestId))
        return { subscriptions: structuredClone(items), alreadySaved: true };
      return guard(() => {
        items = validateReview(review.proposals, items);
        reviewed.add(review.requestId);
        return { subscriptions: structuredClone(items), alreadySaved: false };
      });
    },
    async chat(input: ChatInput, signal?: AbortSignal) {
      if (ai !== "available")
        throw new ApiError("ai_unavailable", undefined, 503);
      await delay(options.aiDelayMs ?? 1600, signal);
      return syntheticReply(input, items);
    },
  };
  if (options.signedOut) {
    const refused = () =>
      Promise.reject(new ApiError("unauthenticated", undefined, 401));
    return {
      ...client,
      me: refused,
      signOut: refused,
      listSubscriptions: refused,
      createSubscription: refused,
      updateSubscription: refused,
      deleteSubscription: refused,
      saveReview: refused,
      chat: refused,
    };
  }
  if (!options.down) return client;
  const unavailable = () =>
    Promise.reject(new ApiError("unavailable", undefined, 503));
  return {
    ...client,
    status: unavailable,
    listSubscriptions: unavailable,
    createSubscription: unavailable,
    updateSubscription: unavailable,
    deleteSubscription: unavailable,
    saveReview: unavailable,
    chat: unavailable,
  };
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

const amountPattern =
  /(?:([$€£₴])\s?(\d+(?:[.,]\d{1,2})?))|(?:(\d+(?:[.,]\d{1,2})?)\s?(USD|EUR|GBP|UAH|\$|€|£|₴))/i;
const symbols: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₴": "UAH",
};

/** A deterministic stand-in for extraction: enough to exercise review cards. */
function syntheticReply(input: ChatInput, items: Subscription[]) {
  const text = input.message;
  const proposals: Proposal[] = [];
  const match = text.match(amountPattern);
  const name =
    text
      .match(
        /\b(?:[Aa]dd|[Pp]ay for|for)\s+([A-Z][\w+ ]{0,40}?)(?=[,.]|\s+(?:at|for|is|costs|\d|[$€£₴])|$)/,
      )?.[1]
      ?.trim() ?? (input.attachments.length ? "Screenshot candidate" : null);
  if (name) {
    const existing = items.find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    const cadence = /year|annual/i.test(text)
      ? "yearly"
      : /week/i.test(text)
        ? "weekly"
        : /month/i.test(text)
          ? "monthly"
          : "unknown";
    const raw = match?.[2] ?? match?.[3];
    const unit = match?.[1] ?? match?.[4];
    proposals.push(
      proposalSchema.parse({
        id: crypto.randomUUID(),
        operation: existing ? "update" : "add",
        targetId: existing?.id,
        name: existing?.name ?? name,
        amount: raw ? Number(raw.replace(",", ".")) : null,
        currency: unit
          ? (symbols[unit] ?? unit.toUpperCase())
          : (existing?.currency ?? "UNK"),
        cadence,
        renewalDate: null,
        status: existing?.status ?? "active",
        category: existing?.category ?? "Other",
        source: input.attachments.length
          ? `Synthetic screenshot: ${input.attachments[0].name}`
          : "Synthetic chat message",
        lastVerified: null,
        notes: "",
        warnings: [
          ...(raw ? [] : ["Amount not visible. Left unknown."]),
          ...(cadence === "unknown" ? ["Billing cycle not stated."] : []),
          "Renewal date not visible. Left unknown.",
        ],
      }),
    );
  }
  return {
    reply: proposals.length
      ? `I found ${proposals.length === 1 ? "one subscription" : `${proposals.length} subscriptions`}. Check the details below before saving. This is the synthetic assistant.`
      : "I couldn't find a subscription in that. Try something like “Add Lumen Music for $9.99 a month”. This is the synthetic assistant.",
    proposals,
  };
}

/** Fictional records with dates relative to today, so every screen has data. */
export function syntheticSubscriptions(now = new Date()): Subscription[] {
  const day = (offset: number) => {
    const d = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + offset,
      ),
    );
    return d.toISOString().slice(0, 10);
  };
  const verified = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const base = {
    source: "Synthetic sample",
    notes: "Fictional sample data.",
  };
  return [
    {
      ...base,
      id: "syn-lumen",
      name: "Lumen Music",
      amount: 9.99,
      currency: "USD",
      cadence: "monthly",
      renewalDate: day(3),
      status: "active",
      category: "Entertainment",
      lastVerified: verified(4),
    },
    {
      ...base,
      id: "syn-paperleaf",
      name: "Paperleaf Notes",
      amount: 96,
      currency: "USD",
      cadence: "yearly",
      renewalDate: day(11),
      status: "active",
      category: "Productivity",
      lastVerified: verified(30),
    },
    {
      ...base,
      id: "syn-fjord",
      name: "Fjord TV",
      amount: 12.5,
      currency: "EUR",
      cadence: "monthly",
      renewalDate: day(6),
      status: "active",
      category: "Entertainment",
      lastVerified: verified(12),
    },
    {
      ...base,
      id: "syn-pixel",
      name: "Pixel Studio",
      amount: 15,
      currency: "USD",
      cadence: "monthly",
      renewalDate: day(19),
      status: "active",
      category: "Design",
      lastVerified: verified(60),
    },
    {
      ...base,
      id: "syn-harbor",
      name: "Calm Harbor",
      amount: 59.99,
      currency: "USD",
      cadence: "yearly",
      renewalDate: day(5),
      status: "trial",
      category: "Health & wellness",
      lastVerified: verified(2),
      notes: "Trial ends soon. Fictional sample data.",
    },
    {
      ...base,
      id: "syn-north",
      name: "Northwind Storage",
      amount: 2.99,
      currency: "EUR",
      cadence: "monthly",
      renewalDate: day(24),
      status: "active",
      category: "Storage",
      lastVerified: verified(300),
    },
    {
      ...base,
      id: "syn-atlas",
      name: "Atlas Daily",
      amount: 149,
      currency: "UAH",
      cadence: "monthly",
      renewalDate: day(14),
      status: "active",
      category: "News",
      lastVerified: verified(45),
    },
    {
      ...base,
      id: "syn-courier",
      name: "Courier VPN",
      amount: null,
      currency: "USD",
      cadence: "yearly",
      renewalDate: null,
      status: "active",
      category: "Utilities",
      lastVerified: null,
      notes: "Price not confirmed. Fictional sample data.",
    },
    {
      ...base,
      id: "syn-trail",
      name: "Trailhead Fitness",
      amount: 24,
      currency: "EUR",
      cadence: "monthly",
      renewalDate: null,
      status: "paused",
      category: "Health & wellness",
      lastVerified: verified(90),
    },
    {
      ...base,
      id: "syn-quill",
      name: "Quill Writer",
      amount: 8,
      currency: "USD",
      cadence: "monthly",
      renewalDate: null,
      status: "cancelled",
      category: "Productivity",
      lastVerified: verified(120),
    },
    {
      ...base,
      id: "syn-orbit",
      name: "Orbit Games",
      amount: 4.99,
      currency: "UNK",
      cadence: "unknown",
      renewalDate: null,
      status: "unknown",
      category: "Entertainment",
      lastVerified: null,
      source: "Synthetic receipt",
    },
  ];
}
