import type { Subscription } from "@saldo/domain";
import {
  ArrowRight,
  CalendarDays,
  FileUp,
  Inbox,
  MessageCircle,
  Plus,
  ShieldCheck,
} from "lucide-react";
import {
  formatDay,
  formatMoney,
  relativeDays,
  todayIn,
} from "../../lib/format";
import type { Preferences } from "../../lib/preferences";
import {
  cadenceLabels,
  categoryBreakdown,
  needsAttention,
  recurringTotals,
  upcomingRenewals,
  type Renewal,
} from "../../lib/subscriptions";
import { getRequestContext } from "../../server/context";
import { subscriptionHref } from "../routes";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ServiceAvatar,
} from "../ui/components";
import { buttonClass, cx } from "../ui/styles";
import { attempt, LoadError, Title } from "./shared";

export async function OverviewPage() {
  const { load, preferences } = getRequestContext();
  const [items, status] = await Promise.all([
    attempt(load.subscriptions),
    attempt(load.status),
  ]);
  const today = todayIn(preferences.timeZone);
  const aiConnected = status.ok && status.value.aiConnected;
  const header = (
    <PageHeader
      eyebrow={
        <span className="text-sm font-medium text-ink-muted">
          {formatDay(today, preferences, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </span>
      }
      title="Overview"
      description="Confirmed recurring costs, what renews next, and what needs a look."
      actions={
        <a
          href="/subscriptions/new"
          className={buttonClass({ variant: "primary", icon: "leading" })}
        >
          <Plus
            className="size-4.5"
            absoluteStrokeWidth
            strokeWidth={2}
            aria-hidden="true"
          />
          Add subscription
        </a>
      }
    />
  );
  if (!items.ok)
    return (
      <>
        <Title>Overview</Title>
        {header}
        <LoadError error={items.error} what="your overview" />
      </>
    );
  if (items.value.length === 0)
    return (
      <>
        <Title>Overview</Title>
        {header}
        <Onboarding aiConnected={aiConnected} />
      </>
    );
  return (
    <>
      <Title>Overview</Title>
      {header}
      <Dashboard items={items.value} today={today} preferences={preferences} />
    </>
  );
}

function Dashboard({
  items,
  today,
  preferences,
}: {
  items: Subscription[];
  today: string;
  preferences: Preferences;
}) {
  const totals = recurringTotals(items, preferences.currency);
  const renewals = upcomingRenewals(items, today);
  const attention = needsAttention(items, today);
  const active = items.filter((s) => s.status === "active").length;
  const chartCurrency =
    totals.currencies.find((c) => c.currency === preferences.currency)
      ?.currency ?? totals.currencies[0]?.currency;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2" aria-labelledby="recurring-title">
        <h2 id="recurring-title" className="text-sm font-medium text-ink-muted">
          Confirmed recurring cost
        </h2>
        {totals.currencies.length ? (
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 xl:grid-cols-3">
            {totals.currencies.map((total) => (
              <li key={total.currency} className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-ink-muted">
                  {total.currency}
                </p>
                <p className="mt-0.5 text-[28px] leading-9 font-semibold tracking-[-0.03em] whitespace-nowrap tabular-nums">
                  {formatMoney(total.monthly, total.currency, preferences)}
                  <span className="ms-1 text-sm font-medium tracking-normal text-ink-muted">
                    /mo
                  </span>
                </p>
                <p className="text-sm text-ink-muted tabular-nums">
                  ≈ {formatMoney(total.yearly, total.currency, preferences)} a
                  year
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[15px] text-ink-muted">
            No confirmed recurring costs yet. Records with an unknown amount,
            currency or billing cycle aren’t counted.
          </p>
        )}
        <p className="mt-5 border-t border-line pt-4 text-sm text-ink-muted">
          {active} active
          {totals.excluded > 0 &&
            ` · ${totals.excluded} not counted until confirmed`}
          {totals.trials > 0 &&
            ` · ${totals.trials} ${totals.trials === 1 ? "trial" : "trials"} not counted`}
          <span className="block text-xs text-ink-faint">
            Estimates in each native currency, never added together. Yearly ÷
            12, quarterly ÷ 3, weekly × 52 ÷ 12.
          </span>
        </p>
      </Card>

      <Card className="flex flex-col p-5" aria-labelledby="attention-title">
        <h2 id="attention-title" className="text-sm font-medium text-ink-muted">
          Needs attention
        </h2>
        <p className="mt-3 text-[32px] leading-10 font-semibold tracking-[-0.03em] tabular-nums">
          {attention.length}
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">
          {attention.length
            ? `${attention.length === 1 ? "record" : "records"} with missing or old details`
            : "Every record has its key details."}
        </p>
        {attention.length > 0 && (
          <ul className="mt-4 mb-5 space-y-1.5 text-sm">
            {issueSummary(attention).map(([label, count]) => (
              <li key={label} className="flex justify-between gap-3">
                <span className="text-ink-muted">{label}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
        <a
          href="/review"
          className={cx(
            buttonClass({ size: "sm", icon: "trailing" }),
            "mt-auto self-start",
          )}
        >
          Open review inbox
          <ArrowRight
            className="size-4"
            absoluteStrokeWidth
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </a>
      </Card>

      <Card className="lg:col-span-2" aria-labelledby="renewals-title">
        <CardHeader
          id="renewals-title"
          title="Renewing in the next 30 days"
          description="Only confirmed dates. Unknown dates are never guessed."
          action={
            <a
              href="/subscriptions?due=30"
              className="shrink-0 rounded-md text-sm font-medium text-brand hover:text-brand-hover"
            >
              See all
            </a>
          }
        />
        {renewals.length ? (
          <ul className="p-2 pt-0">
            {renewals.slice(0, 6).map((renewal) => (
              <RenewalRow
                key={renewal.subscription.id}
                renewal={renewal}
                preferences={preferences}
              />
            ))}
          </ul>
        ) : (
          <EmptyState icon={CalendarDays} title="Nothing renews in 30 days">
            Records with a confirmed renewal date appear here.
          </EmptyState>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        <Card aria-labelledby="attention-list-title">
          <CardHeader id="attention-list-title" title="Check these first" />
          {attention.length ? (
            <ul className="p-2 pt-0">
              {attention.slice(0, 4).map(({ subscription, issues }) => (
                <li key={subscription.id}>
                  <a
                    href={subscriptionHref(subscription.id)}
                    className="flex items-center gap-3 rounded-lg p-2.5 transition-colors duration-150 ease-out hover:bg-surface-hover"
                  >
                    <ServiceAvatar name={subscription.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {subscription.name}
                      </span>
                      <span className="block truncate text-xs text-warn-ink">
                        {issues[0].label}
                        {issues.length > 1 && ` · ${issues.length - 1} more`}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-5 text-sm text-ink-muted">
              Nothing needs a look right now.
            </p>
          )}
        </Card>
        {chartCurrency && (
          <CategoryCard
            items={items}
            currency={chartCurrency}
            preferences={preferences}
          />
        )}
      </div>
    </div>
  );
}

const issueGroups: Record<string, string> = {
  status: "Status unconfirmed",
  amount: "Amount or currency unknown",
  currency: "Amount or currency unknown",
  cadence: "Billing cycle unknown",
  renewal: "Renewal date missing",
  trial: "Trials ending soon",
  stale: "Old or no evidence",
  duplicate: "Possible duplicates",
};

/** Records per kind of problem (a record counts once per group). */
function issueSummary(attention: ReturnType<typeof needsAttention>) {
  const counts = new Map<string, number>();
  for (const { issues } of attention)
    for (const label of new Set(issues.map((i) => issueGroups[i.kind])))
      counts.set(label, (counts.get(label) ?? 0) + 1);
  return Array.from(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
}

function RenewalRow({
  renewal,
  preferences,
}: {
  renewal: Renewal;
  preferences: Preferences;
}) {
  const s = renewal.subscription;
  return (
    <li>
      <a
        href={subscriptionHref(s.id)}
        className="flex items-center gap-3 rounded-lg p-2.5 transition-colors duration-150 ease-out hover:bg-surface-hover"
      >
        <span className="grid w-11 shrink-0 place-items-center rounded-lg bg-surface-sunken py-1 text-center shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
            {formatDay(renewal.date, preferences, { month: "short" })}
          </span>
          <span className="text-base leading-5 font-semibold tabular-nums">
            {formatDay(renewal.date, preferences, { day: "numeric" })}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium sm:text-sm">
            {s.name}
          </span>
          <span className="block truncate text-xs text-ink-muted">
            {s.status === "trial"
              ? "Trial converts"
              : `${cadenceLabels[s.cadence]} renewal`}
          </span>
        </span>
        <span className="text-end">
          <span className="block text-[15px] font-medium tabular-nums sm:text-sm">
            {s.amount === null
              ? "Amount unknown"
              : formatMoney(s.amount, s.currency, preferences)}
          </span>
          <span className="block text-xs text-ink-muted">
            {relativeDays(renewal.inDays, preferences)}
          </span>
        </span>
      </a>
    </li>
  );
}

const chartColors = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
];

function CategoryCard({
  items,
  currency,
  preferences,
}: {
  items: Subscription[];
  currency: string;
  preferences: Preferences;
}) {
  const breakdown = categoryBreakdown(items, currency);
  if (!breakdown.length) return null;
  const total = breakdown.reduce((sum, c) => sum + c.monthly, 0);
  return (
    <Card aria-labelledby="category-title">
      <CardHeader
        id="category-title"
        title="Where it goes"
        description={`Active, per month, in ${currency}`}
      />
      <div className="px-5 pb-5">
        <div
          className="flex h-2 gap-0.5 overflow-hidden rounded-full"
          aria-hidden="true"
        >
          {breakdown.map((c, i) => (
            <span
              key={c.category}
              className={chartColors[i % chartColors.length]}
              style={{ flexGrow: c.monthly }}
            />
          ))}
        </div>
        <ul className="mt-4 space-y-2.5">
          {breakdown.map((c, i) => (
            <li key={c.category} className="flex items-center gap-2.5 text-sm">
              <span
                className={cx(
                  "size-2 shrink-0 rounded-full",
                  chartColors[i % chartColors.length],
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">
                {c.category}
                <span className="ms-1.5 text-ink-faint tabular-nums">
                  {Math.round((c.monthly / total) * 100)}%
                </span>
              </span>
              <span className="font-medium tabular-nums">
                {formatMoney(c.monthly, currency, preferences)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Onboarding({ aiConnected }: { aiConnected: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <EmptyState
          icon={Inbox}
          title="Start with your first subscription"
          actions={
            <>
              <a
                href="/subscriptions/new"
                className={buttonClass({ variant: "primary", icon: "leading" })}
              >
                <Plus
                  className="size-4.5"
                  absoluteStrokeWidth
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Add manually
              </a>
              <a
                href="/review#import"
                className={buttonClass({ icon: "leading" })}
              >
                <FileUp
                  className="size-4.5"
                  absoluteStrokeWidth
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                Import a CSV
              </a>
              {aiConnected && (
                <a href="/chat" className={buttonClass({ icon: "leading" })}>
                  <MessageCircle
                    className="size-4.5"
                    absoluteStrokeWidth
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  Add from a screenshot
                </a>
              )}
            </>
          }
        >
          Add what you know; unknown details stay unknown until you confirm
          them. Saldo totals each currency separately.
        </EmptyState>
      </Card>
      <Card className="p-5">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-soft-ink">
          <ShieldCheck
            className="size-5"
            absoluteStrokeWidth
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </span>
        <h2 className="mt-4 text-[15px] font-semibold tracking-tight">
          Where your data lives
        </h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          Records are stored privately in your own Cloudflare account and only
          you can open them. AI sees a message or screenshot only when you send
          it, and every suggestion waits for your review before it’s saved.
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          {aiConnected
            ? "ChatGPT is connected."
            : "AI is unavailable right now; manual entry and CSV import work without it."}
        </p>
      </Card>
    </div>
  );
}
