import { subscriptionSchema, type Subscription } from "@saldo/domain";
import type { Cadence, Status } from "./subscriptions";
import { cadenceLabels, statusLabels } from "./subscriptions";

export type SubscriptionField =
  | "name"
  | "amount"
  | "currency"
  | "cadence"
  | "renewalDate"
  | "status"
  | "category"
  | "source"
  | "notes";

export type FieldErrors = Partial<Record<SubscriptionField, string>>;

export type SubscriptionFormValues = Omit<Subscription, "id">;

export type ParsedForm =
  | { ok: true; id: string | null; value: SubscriptionFormValues }
  | { ok: false; fieldErrors: FieldErrors };

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Reads the subscription form. Shared by the server action (authoritative)
 * and tests; messages are written for the person filling the form in.
 */
export function parseSubscriptionForm(
  data: FormData,
  now = new Date(),
): ParsedForm {
  const errors: FieldErrors = {};
  const name = text(data, "name");
  if (!name) errors.name = "Give this subscription a name.";
  else if (name.length > 160) errors.name = "Use 160 characters or fewer.";

  const amountText = text(data, "amount").replace(",", ".");
  let amount: number | null = null;
  if (amountText) {
    amount = Number(amountText);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12)
      errors.amount = "Enter an amount like 9.99, or leave it empty if unsure.";
  }

  const currency = text(data, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    errors.currency = "Use a three-letter code such as USD, or UNK if unknown.";

  const cadence = text(data, "cadence") as Cadence;
  if (!(cadence in cadenceLabels)) errors.cadence = "Choose a billing cycle.";

  const status = text(data, "status") as Status;
  if (!(status in statusLabels)) errors.status = "Choose a status.";

  const renewalDate = text(data, "renewalDate") || null;
  if (
    renewalDate &&
    !subscriptionSchema.shape.renewalDate.safeParse(renewalDate).success
  )
    errors.renewalDate = "Use a real date, or leave it empty if unsure.";

  const category = text(data, "category") || "Other";
  if (category.length > 80) errors.category = "Use 80 characters or fewer.";
  const source = text(data, "source");
  if (source.length > 500) errors.source = "Use 500 characters or fewer.";
  const notes = text(data, "notes");
  if (notes.length > 4000) errors.notes = "Use 4,000 characters or fewer.";

  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };

  const previous = text(data, "lastVerified");
  const lastVerified =
    data.get("verifiedNow") === "on"
      ? now.toISOString()
      : (subscriptionSchema.shape.lastVerified.safeParse(previous || null)
          .data ?? null);
  const id = text(data, "id") || null;
  return {
    ok: true,
    id,
    value: {
      name,
      amount,
      currency,
      cadence,
      renewalDate,
      status,
      category,
      source: source || "Manual entry",
      lastVerified,
      notes,
    },
  };
}
