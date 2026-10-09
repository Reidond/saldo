"use client";
import { useActionState, useId } from "react";
import type { Preferences } from "../../lib/preferences";
import type { PreferencesState } from "../../server/actions";
import { buttonClass, labelClass, selectClass } from "../ui/styles";

export function PreferencesForm({
  initial,
  currencies,
  locales,
  timeZones,
  save,
}: {
  initial: Preferences;
  currencies: string[];
  locales: [string, string][];
  timeZones: string[];
  save: (state: PreferencesState, data: FormData) => Promise<PreferencesState>;
}) {
  const [state, action, pending] = useActionState(save, { status: "idle" });
  const id = useId();
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3">
      <div>
        <label htmlFor={`${id}-currency`} className={labelClass}>
          Display currency
        </label>
        <select
          id={`${id}-currency`}
          name="currency"
          defaultValue={initial.currency}
          className={selectClass}
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-locale`} className={labelClass}>
          Number and date format
        </label>
        <select
          id={`${id}-locale`}
          name="locale"
          defaultValue={initial.locale}
          className={selectClass}
        >
          {locales.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-tz`} className={labelClass}>
          Timezone
        </label>
        <select
          id={`${id}-tz`}
          name="timeZone"
          defaultValue={initial.timeZone}
          className={selectClass}
        >
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:col-span-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted" role="status">
          {state.status === "saved" ? (
            "Saved for this browser."
          ) : state.status === "error" ? (
            <span className="text-danger-ink">{state.message}</span>
          ) : (
            "Totals stay in each native currency; this sets the order and the default for new records."
          )}
        </p>
        <button
          type="submit"
          disabled={pending}
          className={buttonClass({ variant: "primary" })}
        >
          {pending ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}
