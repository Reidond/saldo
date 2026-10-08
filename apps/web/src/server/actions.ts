"use server";
import { proposalSchema, type Proposal } from "@saldo/domain";
import {
  serializePreferences,
  validCurrency,
  validLocale,
  validTimeZone,
} from "../lib/preferences";
import {
  parseSubscriptionForm,
  type FieldErrors,
} from "../lib/subscription-form";
import { errorMessage, isApiError } from "./api";
import { getRequestContext, invalidate } from "./context";

/*
 * Server actions: every write the UI makes. Each runs inside the request
 * context created after Access verification, calls the API through the
 * ApiClient, and returns a plain result the client can show.
 */

export type SaveSubscriptionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: FieldErrors }
  | { status: "saved"; id: string; name: string };

export async function saveSubscription(
  _previous: SaveSubscriptionState,
  formData: FormData,
): Promise<SaveSubscriptionState> {
  const parsed = parseSubscriptionForm(formData);
  if (!parsed.ok)
    return {
      status: "error",
      message: "Check the highlighted fields. Nothing was saved.",
      fieldErrors: parsed.fieldErrors,
    };
  const context = getRequestContext();
  try {
    const saved = parsed.id
      ? await context.api.updateSubscription(parsed.id, parsed.value)
      : await context.api.createSubscription(parsed.value);
    invalidate(context);
    return { status: "saved", id: saved.id, name: saved.name };
  } catch (error) {
    return { status: "error", message: errorMessage(error), fieldErrors: {} };
  }
}

export type RemoveResult = { ok: true } | { ok: false; message: string };

export async function removeSubscription(id: string): Promise<RemoveResult> {
  if (typeof id !== "string" || !id || id.length > 100)
    return { ok: false, message: "That record could not be found." };
  const context = getRequestContext();
  try {
    await context.api.deleteSubscription(id);
    invalidate(context);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

export type ProposalResult =
  | { ok: true; id: string; alreadySaved: boolean }
  | { ok: false; message: string; retryable: boolean };

/**
 * Saves one reviewed proposal as an atomic batch. Retrying with the same
 * `requestId` is safe: the API saves a batch at most once.
 */
export async function saveProposal(input: {
  requestId: string;
  proposal: Proposal;
}): Promise<ProposalResult> {
  const proposal = proposalSchema.safeParse(input?.proposal);
  if (
    !proposal.success ||
    typeof input.requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(input.requestId)
  )
    return {
      ok: false,
      message: "This draft is incomplete. Edit it, then try again.",
      retryable: false,
    };
  const context = getRequestContext();
  try {
    const result = await context.api.saveReview({
      requestId: input.requestId,
      proposals: [proposal.data],
    });
    invalidate(context);
    const id =
      proposal.data.operation === "update"
        ? (proposal.data.targetId ?? proposal.data.id)
        : proposal.data.id;
    return { ok: true, id, alreadySaved: result.alreadySaved };
  } catch (error) {
    const retryable =
      !isApiError(error) ||
      error.code === "unavailable" ||
      error.code === "bad_response";
    return { ok: false, message: errorMessage(error), retryable };
  }
}

export type PreferencesState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

export async function savePreferences(
  _previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  const field = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const currency = field("currency").toUpperCase();
  const locale = field("locale");
  const timeZone = field("timeZone");
  if (!validCurrency(currency))
    return { status: "error", message: "Choose a three-letter currency code." };
  if (!validLocale(locale))
    return { status: "error", message: "Choose a supported locale." };
  if (!validTimeZone(timeZone))
    return { status: "error", message: "Choose a valid timezone." };
  const context = getRequestContext();
  context.preferences = { currency, locale, timeZone };
  context.responseHeaders.append(
    "Set-Cookie",
    serializePreferences(context.preferences, {
      secure: context.secureCookies,
    }),
  );
  return { status: "saved" };
}
