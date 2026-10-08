import { z } from "zod";
export const subscriptionSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  amount: z.number().finite().nonnegative().max(1e12).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  cadence: z.enum([
    "monthly",
    "yearly",
    "weekly",
    "quarterly",
    "one-time",
    "unknown",
  ]),
  renewalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
      "Invalid date",
    )
    .nullable(),
  status: z.enum(["active", "trial", "paused", "cancelled", "unknown"]),
  category: z.string().trim().max(80),
  source: z.string().trim().max(500),
  lastVerified: z.string().datetime({ offset: true }).nullable(),
  notes: z.string().max(4000).default(""),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const proposalSchema = subscriptionSchema.extend({
  operation: z.enum(["add", "update"]),
  targetId: z.string().max(100).optional(),
  warnings: z.array(z.string().max(500)).max(20).optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export const reviewSchema = z.object({
  requestId: z.string().uuid(),
  proposals: z.array(proposalSchema).min(1).max(100),
});
export function duplicateKey(s: Pick<Subscription, "name" | "currency">) {
  return `${s.name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")}|${s.currency}`;
}
export function validateReview(
  proposals: Proposal[],
  existing: Subscription[],
): Subscription[] {
  const result = [...existing];
  const touched = new Set<string>();
  for (const raw of proposals) {
    const p = proposalSchema.parse(raw);
    const id = p.operation === "update" ? p.targetId : p.id;
    if (!id || touched.has(id))
      throw new Error("Repeated or missing review target");
    touched.add(id);
    const index = result.findIndex((s) => s.id === id);
    if (p.operation === "update" && index < 0)
      throw new Error("Update target not found");
    if (p.operation === "add" && index >= 0)
      throw new Error("Duplicate subscription ID");
    if (result.some((s) => s.id !== id && duplicateKey(s) === duplicateKey(p)))
      throw new Error(
        `Possible duplicate: ${p.name}. Review as an update instead.`,
      );
    const s = subscriptionSchema.parse({ ...p, id });
    if (index >= 0) result[index] = s;
    else result.push(s);
  }
  return result;
}
export function monthlyTotals(items: Subscription[]) {
  const totals: Record<string, number> = {};
  let excluded = 0;
  for (const s of items) {
    if (s.status !== "active") continue;
    if (
      s.currency === "UNK" ||
      s.amount === null ||
      s.cadence === "unknown" ||
      s.cadence === "one-time"
    ) {
      excluded++;
      continue;
    }
    const multiplier = {
      monthly: 1,
      yearly: 1 / 12,
      weekly: 52 / 12,
      quarterly: 1 / 3,
    }[s.cadence];
    totals[s.currency] = (totals[s.currency] ?? 0) + s.amount * multiplier;
  }
  return { totals, excluded };
}
export const imageSchema = z
  .object({
    name: z.string().max(200),
    type: z.enum(["image/png", "image/jpeg", "image/webp"]),
    dataUrl: z.string().max(7_000_000),
  })
  .superRefine((v, ctx) => {
    if (
      !v.dataUrl.startsWith(`data:${v.type};base64,`) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(v.dataUrl.split(",")[1] ?? "")
    )
      ctx.addIssue({ code: "custom", message: "Invalid image encoding" });
    else {
      const raw = atob(v.dataUrl.split(",")[1]);
      const bytes = Array.from(raw.slice(0, 12)).map((c) => c.charCodeAt(0));
      const valid =
        v.type === "image/png"
          ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
          : v.type === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : raw.startsWith("RIFF") && raw.slice(8, 12) === "WEBP";
      if (!valid)
        ctx.addIssue({
          code: "custom",
          message: "Image content does not match type",
        });
    }
  });
export const chatSchema = z
  .object({
    message: z.string().trim().max(12000),
    attachments: z.array(imageSchema).max(4).default([]),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(12000),
        }),
      )
      .max(20)
      .default([]),
  })
  .refine(
    (v) => v.history.reduce((n, m) => n + m.content.length, 0) <= 60000,
    "Chat history too long",
  )
  .refine(
    (v) => v.message.length > 0 || v.attachments.length > 0,
    "Add a message or screenshot",
  );
/** Keep recent context within the same limits enforced by chatSchema. */
export function boundedChatHistory(
  history: { role: "user" | "assistant"; content: string }[],
) {
  const result: { role: "user" | "assistant"; content: string }[] = [];
  let remaining = 60000;
  const marker = "[Earlier text omitted]\n";
  for (const item of history.slice(-20).reverse()) {
    if (remaining <= marker.length) break;
    const limit = Math.min(12000, remaining);
    const content =
      item.content.length > limit
        ? marker + item.content.slice(-(limit - marker.length))
        : item.content;
    result.unshift({ role: item.role, content });
    remaining -= content.length;
  }
  return result;
}
