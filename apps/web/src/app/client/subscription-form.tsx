"use client";
import { Check } from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useNavigation } from "../../framework/navigation";
import { useUnsavedWork } from "../../framework/session";
import type { SubscriptionFormValues } from "../../lib/subscription-form";
import { cadenceLabels, statusLabels } from "../../lib/subscriptions";
import type { SaveSubscriptionState } from "../../server/actions";
import { Notice } from "../ui/components";
import {
  buttonClass,
  cx,
  fieldClass,
  inputClass,
  labelClass,
  selectClass,
} from "../ui/styles";

export interface SubscriptionFormProps {
  id?: string;
  initial: SubscriptionFormValues;
  categories: string[];
  /** Pre-formatted on the server, so SSR and hydration agree. */
  lastVerifiedLabel: string | null;
  cancelHref: string;
  save: (
    state: SaveSubscriptionState,
    data: FormData,
  ) => Promise<SaveSubscriptionState>;
}

const currencySuggestions = ["USD", "EUR", "GBP", "UAH", "PLN", "CHF", "UNK"];

export function SubscriptionForm({
  id,
  initial,
  categories,
  lastVerifiedLabel,
  cancelHref,
  save,
}: SubscriptionFormProps) {
  const { navigate } = useNavigation();
  const [state, formAction, pending] = useActionState(save, { status: "idle" });
  const [loaded] = useState(() => ({
    ...initial,
    amount: initial.amount === null ? "" : String(initial.amount),
    renewalDate: initial.renewalDate ?? "",
  }));
  const [values, setValues] = useState(loaded);
  // Typed changes survive an expired session (src/framework/session.ts).
  useUnsavedWork(
    state.status !== "saved" &&
      (Object.keys(loaded) as (keyof typeof loaded)[]).some(
        (key) => values[key] !== loaded[key],
      ),
  );
  const formId = useId();
  const errors = state.status === "error" ? state.fieldErrors : {};

  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "saved")
      navigate(`/subscriptions/${encodeURIComponent(state.id)}?saved=1`, {
        replace: true,
        scroll: true,
      });
    // Take people straight to the first field that needs fixing.
    if (state.status === "error")
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [state, navigate]);

  const set =
    (key: keyof typeof values) =>
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setValues((old) => ({ ...old, [key]: event.target.value }));

  const field = (
    name: keyof typeof errors,
    label: ReactNode,
    control: (props: {
      id: string;
      "aria-invalid"?: true;
      "aria-describedby"?: string;
    }) => ReactNode,
    options: { hint?: string; className?: string } = {},
  ) => {
    const controlId = `${formId}-${name}`;
    const error = errors[name];
    return (
      <div className={options.className}>
        <label htmlFor={controlId} className={labelClass}>
          {label}
        </label>
        {control({
          id: controlId,
          ...(error
            ? { "aria-invalid": true, "aria-describedby": `${controlId}-error` }
            : {}),
        })}
        {error ? (
          <p
            id={`${controlId}-error`}
            className="mt-1.5 text-sm text-danger-ink"
          >
            {error}
          </p>
        ) : (
          options.hint && (
            <p className="mt-1.5 text-xs text-ink-muted">{options.hint}</p>
          )
        )}
      </div>
    );
  };

  const optional = (
    <span className="font-normal text-ink-faint"> · optional</span>
  );

  return (
    <form ref={form} action={formAction} noValidate>
      {id && <input type="hidden" name="id" value={id} />}
      <input
        type="hidden"
        name="lastVerified"
        value={initial.lastVerified ?? ""}
      />
      <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
        {field(
          "name",
          "Name",
          (props) => (
            <input
              {...props}
              name="name"
              required
              maxLength={160}
              autoComplete="off"
              placeholder="e.g. Lumen Music"
              value={values.name}
              onChange={set("name")}
              className={inputClass}
            />
          ),
          { className: "sm:col-span-2" },
        )}
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          {field("amount", <>Amount{optional}</>, (props) => (
            <input
              {...props}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Not confirmed"
              value={values.amount}
              onChange={set("amount")}
              className={cx(inputClass, "tabular-nums")}
            />
          ))}
          {field("currency", "Currency", (props) => (
            <>
              <input
                {...props}
                name="currency"
                required
                maxLength={3}
                autoComplete="off"
                autoCapitalize="characters"
                list={`${formId}-currencies`}
                value={values.currency}
                onChange={(event) =>
                  setValues((old) => ({
                    ...old,
                    currency: event.target.value.toUpperCase(),
                  }))
                }
                className={cx(inputClass, "uppercase")}
              />
              <datalist id={`${formId}-currencies`}>
                {currencySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          ))}
        </div>
        {field("cadence", "Billing cycle", (props) => (
          <select
            {...props}
            name="cadence"
            value={values.cadence}
            onChange={set("cadence")}
            className={selectClass}
          >
            {Object.entries(cadenceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ))}
        {field(
          "renewalDate",
          <>Next renewal{optional}</>,
          (props) => (
            <input
              {...props}
              type="date"
              name="renewalDate"
              value={values.renewalDate}
              onChange={set("renewalDate")}
              className={cx(inputClass, "tabular-nums")}
            />
          ),
          { hint: "Leave empty if you haven’t confirmed it." },
        )}
        {field("status", "Status", (props) => (
          <select
            {...props}
            name="status"
            value={values.status}
            onChange={set("status")}
            className={selectClass}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ))}
        {field("category", "Category", (props) => (
          <select
            {...props}
            name="category"
            value={values.category}
            onChange={set("category")}
            className={selectClass}
          >
            {Array.from(new Set([...categories, values.category])).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ))}
        {field(
          "source",
          <>Source{optional}</>,
          (props) => (
            <input
              {...props}
              name="source"
              maxLength={500}
              autoComplete="off"
              placeholder="Receipt, account page, or a link"
              value={values.source}
              onChange={set("source")}
              className={inputClass}
            />
          ),
          { className: "sm:col-span-2" },
        )}
        <label className="flex gap-3 rounded-xl bg-surface-sunken p-3.5 shadow-[inset_0_0_0_1px_var(--line)] sm:col-span-2">
          <input
            type="checkbox"
            name="verifiedNow"
            className="mt-0.5 size-4.5 shrink-0 accent-brand"
          />
          <span className="text-sm">
            <span className="font-medium">I checked these details today</span>
            <span className="block text-ink-muted">
              {lastVerifiedLabel
                ? `Last verified ${lastVerifiedLabel}.`
                : "Not verified yet."}
            </span>
          </span>
        </label>
        {field(
          "notes",
          <>Notes{optional}</>,
          (props) => (
            <textarea
              {...props}
              name="notes"
              rows={4}
              maxLength={4000}
              placeholder="Plan details, the account it’s billed to, reminders…"
              value={values.notes}
              onChange={set("notes")}
              className={cx(fieldClass, "min-h-28 py-2.5")}
            />
          ),
          { className: "sm:col-span-2" },
        )}
      </fieldset>

      {state.status === "error" && (
        <Notice role="alert" tone="danger" className="mt-5">
          {state.message}
        </Notice>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          Tracking doesn’t start, change or cancel the subscription.
        </p>
        <div className="flex gap-2">
          <a
            href={cancelHref}
            className={cx(buttonClass(), "flex-1 sm:flex-none")}
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={pending}
            className={cx(
              buttonClass({ variant: "primary", icon: "leading" }),
              "flex-1 sm:flex-none",
            )}
          >
            <Check
              className="size-4.5"
              absoluteStrokeWidth
              strokeWidth={2}
              aria-hidden="true"
            />
            {pending ? "Saving…" : id ? "Save changes" : "Add subscription"}
          </button>
        </div>
      </div>
    </form>
  );
}
