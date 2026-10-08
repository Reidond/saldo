import type { Subscription } from "@saldo/domain";
import { ArrowLeft, History, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import {
  daysBetween,
  formatDay,
  formatMoment,
  formatMoney,
  relativeDays,
  todayIn,
} from "../../lib/format";
import type { Preferences } from "../../lib/preferences";
import {
  cadenceLabels,
  issuesFor,
  monthlyEquivalent,
  statusLabels,
} from "../../lib/subscriptions";
import { removeSubscription } from "../../server/actions";
import { getRequestContext } from "../../server/context";
import { RemoveSubscription } from "../client/remove-subscription";
import { subscriptionHref } from "../routes";
import {
  Card,
  CardHeader,
  Notice,
  ServiceAvatar,
  StatusBadge,
} from "../ui/components";
import { buttonClass } from "../ui/styles";
import { NotFoundPage } from "./not-found";
import { attempt, LoadError, Title } from "./shared";

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="-ms-2 mb-4 inline-flex h-9 items-center gap-1.5 rounded-lg ps-1.5 pe-2.5 text-sm text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-hover hover:text-ink"
    >
      <ArrowLeft
        className="size-4"
        absoluteStrokeWidth
        strokeWidth={1.5}
        aria-hidden="true"
      />
      {children}
    </a>
  );
}

export async function SubscriptionPage({
  id,
  params,
}: {
  id: string;
  params: URLSearchParams;
}) {
  const { load, preferences } = getRequestContext();
  const result = await attempt(load.subscriptions);
  if (!result.ok)
    return (
      <>
        <Title>Subscription</Title>
        <BackLink href="/subscriptions">Subscriptions</BackLink>
        <LoadError error={result.error} what="this subscription" />
      </>
    );
  const s = result.value.find((item) => item.id === id);
  if (!s) return <NotFoundPage what="subscription" />;
  const today = todayIn(preferences.timeZone);
  const issues = issuesFor(s, result.value, today);

  return (
    <>
      <Title>{s.name}</Title>
      <BackLink href="/subscriptions">Subscriptions</BackLink>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <ServiceAvatar name={s.name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
              {s.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <StatusBadge status={s.status} />
              <span>{s.category}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <a
            href={`${subscriptionHref(s.id)}/edit`}
            className={buttonClass({ icon: "leading" })}
          >
            <Pencil
              className="size-4.5"
              absoluteStrokeWidth
              strokeWidth={1.5}
              aria-hidden="true"
            />
            Edit
          </a>
          <RemoveSubscription
            id={s.id}
            name={s.name}
            remove={removeSubscription}
          />
        </div>
      </header>

      {params.get("saved") === "1" && (
        <Notice role="status" tone="success" className="mb-4">
          Saved. Tracking this doesn’t start, change or cancel the subscription.
        </Notice>
      )}
      {issues.length > 0 && (
        <Notice
          tone="warn"
          className="mb-4"
          title="Some details need a look"
          action={
            <a
              href={`${subscriptionHref(s.id)}/edit`}
              className="text-sm font-semibold underline underline-offset-2"
            >
              Update details
            </a>
          }
        >
          {issues.map((issue) => issue.label).join(" · ")}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" aria-labelledby="facts-title">
          <CardHeader id="facts-title" title="Current details" />
          <Facts s={s} today={today} preferences={preferences} />
        </Card>
        <div className="flex flex-col gap-4">
          <Card aria-labelledby="evidence-title">
            <CardHeader
              id="evidence-title"
              title="Evidence"
              description="Where these details came from."
            />
            <dl className="space-y-3 px-5 pb-5 text-sm">
              <div>
                <dt className="text-ink-muted">Source</dt>
                <dd className="mt-0.5 break-words">
                  <SourceText source={s.source} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Last verified</dt>
                <dd className="mt-0.5">
                  {s.lastVerified
                    ? formatMoment(s.lastVerified, preferences)
                    : "Never verified"}
                </dd>
              </div>
            </dl>
          </Card>
          <Card aria-labelledby="history-title">
            <CardHeader id="history-title" title="History" />
            <div className="flex gap-3 px-5 pb-5 text-sm text-ink-muted">
              <History
                className="mt-0.5 size-4.5 shrink-0"
                absoluteStrokeWidth
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <p>
                Saldo keeps the current version only for now. Price changes and
                edits will be listed here once history is recorded.
              </p>
            </div>
          </Card>
        </div>
        <Card className="lg:col-span-2" aria-labelledby="notes-title">
          <CardHeader id="notes-title" title="Notes" />
          <p className="px-5 pb-5 text-[15px] whitespace-pre-wrap text-ink sm:text-sm">
            {s.notes || <span className="text-ink-muted">No notes yet.</span>}
          </p>
        </Card>
      </div>
    </>
  );
}

function Facts({
  s,
  today,
  preferences,
}: {
  s: Subscription;
  today: string;
  preferences: Preferences;
}) {
  const monthly = monthlyEquivalent(s);
  const rows: [string, ReactNode][] = [
    [
      "Amount",
      s.amount === null
        ? "Not confirmed"
        : `${formatMoney(s.amount, s.currency, preferences)}${s.currency === "UNK" ? " (currency unknown)" : ` ${s.currency}`}`,
    ],
    ["Billing cycle", cadenceLabels[s.cadence]],
    [
      "Monthly equivalent",
      monthly === null || s.currency === "UNK"
        ? "Not available"
        : `≈ ${formatMoney(monthly, s.currency, preferences)}`,
    ],
    [
      "Next renewal",
      s.renewalDate
        ? `${formatDay(s.renewalDate, preferences)} · ${relativeDays(daysBetween(today, s.renewalDate), preferences)}`
        : "Not confirmed",
    ],
    ["Status", statusLabels[s.status]],
    ["Category", s.category || "Other"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 px-5 pb-2">
      {rows.map(([label, value]) => (
        <div key={label} className="border-t border-line py-3">
          <dt className="text-sm text-ink-muted">{label}</dt>
          <dd className="mt-0.5 text-[15px] font-medium tabular-nums">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Renders the source as text; only https links become links. */
function SourceText({ source }: { source: string }) {
  const host = httpsHost(source);
  if (host)
    return (
      <a
        href={source}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-brand underline-offset-2 hover:underline"
      >
        {host}
      </a>
    );
  return <>{source || "Not recorded"}</>;
}

function httpsHost(value: string) {
  if (!/^https:\/\/\S+$/.test(value)) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}
