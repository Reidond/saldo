"use client";
import {
  duplicateKey,
  parseInventoryCsv,
  type Subscription,
} from "@saldo/domain";
import { FileUp, Inbox, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { EmptyState } from "../ui/components";
import { cx } from "../ui/styles";
import { draftsStore, useDrafts } from "./drafts-store";
import { ReviewCard, type SaveProposal } from "./review-card";

const CSV_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_DRAFTS = 100;

/** Every undecided draft in this tab, from chat and CSV imports alike. */
export function DraftInbox({
  subscriptions,
  locale,
  save,
}: {
  subscriptions: Subscription[];
  locale: string;
  save: SaveProposal;
}) {
  const { drafts } = useDrafts();
  const open = drafts.filter(
    (d) => d.state === "pending" || d.state === "error",
  );
  const finished = drafts.filter(
    (d) => d.state === "saved" || d.state === "discarded",
  );
  return (
    <div className="flex flex-col gap-3">
      {open.length === 0 && finished.length === 0 ? (
        <div className="rounded-2xl bg-surface shadow-card">
          <EmptyState icon={Inbox} title="No drafts waiting">
            Drafts from chat and CSV imports wait here until you create, update
            or discard them. They stay in this tab only.
          </EmptyState>
        </div>
      ) : (
        <>
          {open.map((draft) => (
            <ReviewCard
              key={draft.key}
              draft={draft}
              subscriptions={subscriptions}
              locale={locale}
              save={save}
            />
          ))}
          {finished.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-ink-muted">
                  Decided in this tab
                </h3>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-sm text-ink-muted hover:text-ink"
                  onClick={() =>
                    draftsStore.removeDrafts(finished.map((d) => d.key))
                  }
                >
                  Clear
                </button>
              </div>
              {finished.map((draft) => (
                <ReviewCard
                  key={draft.key}
                  draft={draft}
                  subscriptions={subscriptions}
                  locale={locale}
                  save={save}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Reads a CSV in the browser and turns each row into a draft for review. */
export function CsvImport({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{
    tone: "error" | "ok";
    text: string;
  } | null>(null);
  const { drafts } = useDrafts();
  const openCount = drafts.filter(
    (d) => d.state === "pending" || d.state === "error",
  ).length;

  const importFile = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (file.size > CSV_LIMIT_BYTES) {
      setMessage({
        tone: "error",
        text: "Choose a CSV smaller than 2 MB. Nothing was imported.",
      });
      return;
    }
    try {
      const proposals = parseInventoryCsv(await file.text());
      if (!proposals.length)
        throw new Error("This CSV has no subscription rows.");
      if (proposals.length + openCount > MAX_DRAFTS)
        throw new Error(
          `Review up to ${MAX_DRAFTS} drafts at a time. Decide some first.`,
        );
      const withDuplicates = proposals.map((p) => {
        const match = subscriptions.find(
          (s) => duplicateKey(s) === duplicateKey(p),
        );
        return match
          ? {
              ...p,
              operation: "update" as const,
              targetId: match.id,
              warnings: [
                ...(p.warnings ?? []),
                `Matches ${match.name}; set to update it. Choose “New subscription” to keep both.`,
              ],
            }
          : p;
      });
      draftsStore.addDrafts(withDuplicates, { kind: "csv", file: file.name });
      setMessage({
        tone: "ok",
        text: `${proposals.length} ${proposals.length === 1 ? "draft" : "drafts"} from ${file.name} are ready below. Nothing is saved until you decide.`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: `${error instanceof Error ? error.message : "That CSV could not be read."} Nothing was imported.`,
      });
    }
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-full items-center gap-3 rounded-2xl bg-surface-sunken p-2 pe-4 text-start shadow-[inset_0_0_0_1px_var(--line)] transition-[background-color,box-shadow] duration-150 ease-out hover:bg-surface-hover hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface text-brand shadow-card">
          <FileUp
            className="size-5"
            absoluteStrokeWidth
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-medium sm:text-sm">
            Choose a CSV file
          </span>
          <span className="block text-sm text-ink-muted">
            Up to 100 rows · 2 MB
          </span>
        </span>
      </button>
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cx(
            "mt-3 rounded-xl px-3.5 py-3 text-sm",
            message.tone === "error"
              ? "bg-danger-soft text-danger-ink"
              : "bg-brand-soft text-brand-soft-ink",
          )}
        >
          {message.text}
        </p>
      )}
      <p className="mt-3 flex gap-2 text-sm text-ink-muted">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0"
          absoluteStrokeWidth
          strokeWidth={1.5}
          aria-hidden="true"
        />
        The file is read in this browser. Only drafts you create or update are
        sent to your workspace.
      </p>
      <details className="group mt-3 text-sm">
        <summary className="inline-flex h-9 items-center rounded-md font-medium text-brand marker:content-none hover:text-brand-hover">
          What should the CSV contain?
        </summary>
        <div className="mt-1 space-y-2 text-ink-muted">
          <p>
            A <code className="font-mono text-ink">service</code> column for the
            name. Optional: amount, currency, cadence, status, next_or_end_date,
            date_type, notes, source_urls, last_checked.
          </p>
          <p>
            Dates use YYYY-MM-DD. A date becomes the renewal only when date_type
            says renewal. Blank amounts and unknown currencies stay unconfirmed.
            Saldo’s CSV export uses the same columns.
          </p>
        </div>
      </details>
    </div>
  );
}
