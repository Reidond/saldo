"use client";
import {
  duplicateKey,
  proposalSchema,
  type Proposal,
  type Subscription,
} from "@saldo/domain";
import {
  Check,
  LoaderCircle,
  Pencil,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import { formatDay, formatMoney } from "../../lib/format";
import {
  cadenceLabels,
  categoriesOf,
  possibleDuplicate,
  statusLabels,
} from "../../lib/subscriptions";
import type { ProposalResult } from "../../server/actions";
import { subscriptionHref } from "../routes";
import { IconSwap, ServiceAvatar } from "../ui/components";
import {
  buttonClass,
  cx,
  inputClass,
  labelClass,
  selectClass,
} from "../ui/styles";
import { draftsStore, type Draft } from "./drafts-store";

export type SaveProposal = (input: {
  requestId: string;
  proposal: Proposal;
}) => Promise<ProposalResult>;

export interface ReviewCardProps {
  draft: Draft;
  subscriptions: Subscription[];
  locale: string;
  save: SaveProposal;
}

/**
 * One proposed change, nothing saved yet. The owner checks the facts, picks
 * Create or Update existing, or discards it. Saving is optimistic: the card
 * collapses at once and reopens with the error if the API refuses.
 */
export function ReviewCard({
  draft,
  subscriptions,
  locale,
  save,
}: ReviewCardProps) {
  const [optimistic, setOptimistic] = useOptimistic<
    Draft["state"] | "saving",
    "saving"
  >(draft.state, (_current, next) => next);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const p = draft.proposal;
  const target =
    p.operation === "update"
      ? subscriptions.find((s) => s.id === p.targetId)
      : undefined;
  const exactDuplicate =
    p.operation === "add"
      ? subscriptions.find((s) => duplicateKey(s) === duplicateKey(p))
      : undefined;
  const similar =
    p.operation === "add" && !exactDuplicate
      ? possibleDuplicate({ id: "", name: p.name }, subscriptions)
      : undefined;
  const valid =
    proposalSchema.safeParse(p).success && (p.operation === "add" || !!target);
  const blocked = !valid || !!exactDuplicate;

  const decide = () =>
    startTransition(async () => {
      setOptimistic("saving");
      const result = await save({
        requestId: draft.requestId,
        proposal: p,
      }).catch((error: unknown): ProposalResult => ({
        ok: false,
        message:
          error instanceof Error ? error.message : "Saldo could not save this.",
        retryable: true,
      }));
      if (result.ok)
        draftsStore.settleDraft(draft.key, {
          state: "saved",
          savedId: result.id,
        });
      else
        draftsStore.settleDraft(draft.key, {
          state: "error",
          error: result.message,
          retryable: result.retryable,
        });
    });

  if (
    optimistic === "saving" ||
    optimistic === "saved" ||
    optimistic === "discarded"
  )
    return (
      <div
        className={cx(
          "flex items-center gap-3 rounded-xl bg-surface p-3 shadow-card transition-opacity duration-150 ease-out starting:opacity-0",
          optimistic === "discarded" && "opacity-70",
        )}
      >
        <ServiceAvatar name={p.name || "?"} size="sm" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="block truncate font-medium">{p.name}</span>
          <span className="block text-ink-muted" role="status">
            {optimistic === "saving"
              ? "Saving…"
              : optimistic === "discarded"
                ? "Discarded. Nothing was saved."
                : p.operation === "update"
                  ? `Updated ${target?.name ?? "the existing record"}`
                  : "Created"}
          </span>
        </p>
        {optimistic === "discarded" ? (
          <button
            type="button"
            className={buttonClass({
              variant: "ghost",
              size: "sm",
              icon: "leading",
            })}
            onClick={() =>
              draftsStore.settleDraft(draft.key, { state: "pending" })
            }
          >
            <Undo2
              className="size-4"
              absoluteStrokeWidth
              strokeWidth={2}
              aria-hidden="true"
            />
            Undo
          </button>
        ) : (
          <>
            {optimistic === "saved" && draft.savedId && (
              <a
                href={subscriptionHref(draft.savedId)}
                className="rounded-md px-2 py-1 text-sm font-medium text-brand hover:text-brand-hover"
              >
                View
              </a>
            )}
            <SaveIcon saved={optimistic === "saved"} />
          </>
        )}
      </div>
    );

  return (
    <article className="rounded-2xl bg-surface shadow-card">
      <header className="flex items-start gap-3 p-4 pb-3">
        <ServiceAvatar name={p.name || "?"} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">
            {p.name || "Unnamed subscription"}
          </h3>
          <p className="text-sm text-ink-muted">
            {p.operation === "update"
              ? `Update ${target?.name ?? "existing record"}`
              : "New subscription"}
            {" · "}
            {draft.origin.kind === "csv" ? draft.origin.file : "from chat"}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={editing}
          className={buttonClass({ variant: "ghost", size: "icon-sm" })}
          onClick={() => setEditing((value) => !value)}
          aria-label={editing ? "Close editor" : `Edit ${p.name || "draft"}`}
        >
          <IconSwap
            active={editing}
            from={
              <Pencil
                className="size-4.5"
                absoluteStrokeWidth
                strokeWidth={1.5}
              />
            }
            to={
              <X className="size-4.5" absoluteStrokeWidth strokeWidth={1.5} />
            }
          />
        </button>
      </header>

      {editing ? (
        <DraftEditor
          draft={draft}
          categories={categoriesOf(subscriptions)}
          onDone={() => setEditing(false)}
        />
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 text-sm sm:grid-cols-3">
          <Fact
            label="Amount"
            missing={p.amount === null || p.currency === "UNK"}
          >
            {p.amount === null
              ? "Unknown"
              : `${formatMoney(p.amount, p.currency, { locale })}${p.currency === "UNK" ? " · currency unknown" : ` ${p.currency}`}`}
          </Fact>
          <Fact label="Billing" missing={p.cadence === "unknown"}>
            {p.cadence === "unknown" ? "Unknown" : cadenceLabels[p.cadence]}
          </Fact>
          <Fact label="Next renewal" missing={!p.renewalDate}>
            {p.renewalDate ? formatDay(p.renewalDate, { locale }) : "Unknown"}
          </Fact>
          <Fact label="Status" missing={p.status === "unknown"}>
            {statusLabels[p.status]}
          </Fact>
          <Fact label="Category">{p.category || "Other"}</Fact>
          <Fact label="Evidence">{p.source || "Not recorded"}</Fact>
        </dl>
      )}

      {(p.warnings?.length ||
        exactDuplicate ||
        similar ||
        draft.state === "error") &&
      !editing ? (
        <ul className="mx-4 mt-4 space-y-1.5 rounded-xl bg-warn-soft px-3.5 py-3 text-sm text-warn-ink">
          {exactDuplicate && (
            <Warning>
              Already tracked as {exactDuplicate.name} (
              {exactDuplicate.currency}). Choose “Update {exactDuplicate.name}”
              or rename this draft.
            </Warning>
          )}
          {similar && (
            <Warning>
              Similar to {similar.name}. Check it isn’t the same plan.
            </Warning>
          )}
          {p.warnings?.map((warning, i) => (
            <Warning key={i}>{warning}</Warning>
          ))}
        </ul>
      ) : null}

      {draft.state === "error" && draft.error && !editing && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger-ink"
        >
          {draft.error}
          {draft.retryable && " Trying again is safe; it can’t save twice."}
        </p>
      )}

      {!editing && (
        <footer className="mt-4 flex flex-col gap-2 border-t border-line p-4 sm:flex-row sm:items-center">
          <TargetSelect draft={draft} subscriptions={subscriptions} />
          <div className="flex gap-2 sm:ms-auto">
            <button
              type="button"
              className={cx(
                buttonClass({ variant: "ghost" }),
                "flex-1 sm:flex-none",
              )}
              onClick={() =>
                draftsStore.settleDraft(draft.key, { state: "discarded" })
              }
            >
              Discard
            </button>
            <button
              type="button"
              disabled={blocked}
              className={cx(
                buttonClass({ variant: "primary", icon: "leading" }),
                "flex-1 sm:flex-none",
              )}
              onClick={decide}
            >
              <Check
                className="size-4.5"
                absoluteStrokeWidth
                strokeWidth={2}
                aria-hidden="true"
              />
              {draft.state === "error" && draft.retryable
                ? "Try again"
                : p.operation === "update"
                  ? `Update ${target?.name ?? ""}`.trim()
                  : "Create"}
            </button>
          </div>
        </footer>
      )}
    </article>
  );
}

function Fact({
  label,
  missing = false,
  children,
}: {
  label: string;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={cx(
          "mt-0.5 truncate font-medium tabular-nums",
          missing && "text-warn-ink",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0"
        absoluteStrokeWidth
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

/** Spinner and check share one slot and cross-fade (scale, blur, opacity). */
function SaveIcon({ saved }: { saved: boolean }) {
  const layer =
    "transition-[opacity,filter,scale] duration-300 ease-snappy motion-reduce:transition-opacity";
  return (
    <span
      className="relative grid size-8 place-items-center"
      aria-hidden="true"
    >
      <span
        className={cx(
          "absolute inset-0 grid place-items-center",
          layer,
          saved
            ? "scale-[0.25] opacity-0 blur-[4px]"
            : "scale-100 opacity-100 blur-0",
        )}
      >
        <LoaderCircle
          className="size-4.5 text-ink-muted motion-safe:animate-spin"
          absoluteStrokeWidth
          strokeWidth={1.5}
        />
      </span>
      <span
        className={cx(
          "grid size-7 place-items-center rounded-full bg-brand-soft text-brand-soft-ink",
          layer,
          saved
            ? "scale-100 opacity-100 blur-0"
            : "scale-[0.25] opacity-0 blur-[4px]",
        )}
      >
        <Check className="size-4" absoluteStrokeWidth strokeWidth={2} />
      </span>
    </span>
  );
}

function TargetSelect({
  draft,
  subscriptions,
}: {
  draft: Draft;
  subscriptions: Subscription[];
}) {
  const id = useId();
  const p = draft.proposal;
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm sm:min-w-0">
      <span className="shrink-0 text-ink-muted">Save as</span>
      <select
        id={id}
        className={cx(selectClass, "min-w-0 flex-1 sm:w-60 sm:flex-none")}
        value={p.operation === "update" ? (p.targetId ?? "") : "__new"}
        onChange={(event) =>
          draftsStore.editDraft(
            draft.key,
            event.target.value === "__new"
              ? { ...p, operation: "add", targetId: undefined }
              : { ...p, operation: "update", targetId: event.target.value },
          )
        }
      >
        <option value="__new">New subscription</option>
        <optgroup label="Update existing">
          {[...subscriptions]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.currency})
              </option>
            ))}
        </optgroup>
      </select>
    </label>
  );
}

/** Inline correction of a draft before deciding. Edits stay in this tab. */
function DraftEditor({
  draft,
  categories,
  onDone,
}: {
  draft: Draft;
  categories: string[];
  onDone: () => void;
}) {
  const id = useId();
  const [values, setValues] = useState({
    ...draft.proposal,
    amount: draft.proposal.amount === null ? "" : String(draft.proposal.amount),
    renewalDate: draft.proposal.renewalDate ?? "",
  });
  const [error, setError] = useState("");
  const set =
    (key: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((old) => ({ ...old, [key]: event.target.value }));
  const apply = () => {
    const amount =
      values.amount.trim() === ""
        ? null
        : Number(values.amount.replace(",", "."));
    const parsed = proposalSchema.safeParse({
      ...values,
      name: values.name.trim(),
      currency: values.currency.trim().toUpperCase(),
      amount,
      renewalDate: values.renewalDate || null,
    });
    if (!parsed.success) {
      setError(
        "Check the name, a non-negative amount, a three-letter currency and a real date.",
      );
      return;
    }
    draftsStore.editDraft(draft.key, parsed.data);
    onDone();
  };
  const input = (
    key: "name" | "amount" | "currency",
    label: string,
    extra = {},
  ) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        value={values[key]}
        onChange={set(key)}
        autoComplete="off"
        className={inputClass}
        {...extra}
      />
    </div>
  );
  return (
    <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        {input("name", "Name", { maxLength: 160 })}
      </div>
      <div className="grid grid-cols-[1fr_6.5rem] gap-3">
        {input("amount", "Amount", {
          inputMode: "decimal",
          placeholder: "Unknown",
        })}
        {input("currency", "Currency", {
          maxLength: 3,
          className: cx(inputClass, "uppercase"),
        })}
      </div>
      <div>
        <label htmlFor={`${id}-renewal`} className={labelClass}>
          Next renewal
        </label>
        <input
          id={`${id}-renewal`}
          type="date"
          value={values.renewalDate}
          onChange={set("renewalDate")}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-cadence`} className={labelClass}>
          Billing cycle
        </label>
        <select
          id={`${id}-cadence`}
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
      </div>
      <div>
        <label htmlFor={`${id}-status`} className={labelClass}>
          Status
        </label>
        <select
          id={`${id}-status`}
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
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${id}-category`} className={labelClass}>
          Category
        </label>
        <select
          id={`${id}-category`}
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
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-ink sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          className={buttonClass({ variant: "ghost" })}
          onClick={onDone}
        >
          Cancel
        </button>
        <button
          type="button"
          className={buttonClass({ variant: "primary" })}
          onClick={apply}
        >
          Use these details
        </button>
      </div>
    </div>
  );
}
