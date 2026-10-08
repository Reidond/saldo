import type { Subscription } from "@saldo/domain";
import { FileUp, Layers3, Plus, SearchX } from "lucide-react";
import { formatDay, formatMoney, todayIn } from "../../lib/format";
import type { Preferences } from "../../lib/preferences";
import {
  cadenceLabels,
  categoriesOf,
  filterSubscriptions,
  readFilters,
  statusFilters,
  type Filters,
} from "../../lib/subscriptions";
import { getRequestContext } from "../../server/context";
import { SubscriptionFilters } from "../client/subscription-filters";
import { subscriptionHref } from "../routes";
import {
  Card,
  EmptyState,
  Notice,
  PageHeader,
  ServiceAvatar,
  StatusBadge,
} from "../ui/components";
import { buttonClass, cx } from "../ui/styles";
import { attempt, LoadError, Title } from "./shared";

function filtersHref(filters: Filters, change: Partial<Filters>) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status !== "all") params.set("status", next.status);
  if (next.category) params.set("category", next.category);
  if (next.due) params.set("due", "30");
  const search = params.toString();
  return `/subscriptions${search ? `?${search}` : ""}`;
}

export async function SubscriptionsPage({
  params,
}: {
  params: URLSearchParams;
}) {
  const { load, preferences } = getRequestContext();
  const filters = readFilters(params);
  const removed = params.get("removed");
  const result = await attempt(load.subscriptions);
  const header = (
    <PageHeader
      title="Subscriptions"
      description="Everything you track, with status, cost and next renewal."
      actions={
        <>
          <a href="/review#import" className={buttonClass({ icon: "leading" })}>
            <FileUp
              className="size-4.5"
              absoluteStrokeWidth
              strokeWidth={1.5}
              aria-hidden="true"
            />
            Import CSV
          </a>
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
        </>
      }
    />
  );
  if (!result.ok)
    return (
      <>
        <Title>Subscriptions</Title>
        {header}
        <LoadError error={result.error} what="your subscriptions" />
      </>
    );
  const items = result.value;
  const today = todayIn(preferences.timeZone);
  const shown = filterSubscriptions(items, filters, today);
  const filtered =
    filters.q || filters.status !== "all" || filters.category || filters.due;

  return (
    <>
      <Title>Subscriptions</Title>
      {header}
      {removed && (
        <Notice role="status" tone="success" className="mb-4">
          Removed {removed} from your tracker. This doesn’t cancel the service.
        </Notice>
      )}
      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers3}
            title="No subscriptions yet"
            actions={
              <>
                <a
                  href="/subscriptions/new"
                  className={buttonClass({
                    variant: "primary",
                    icon: "leading",
                  })}
                >
                  <Plus
                    className="size-4.5"
                    absoluteStrokeWidth
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  Add subscription
                </a>
                <a href="/review#import" className={buttonClass()}>
                  Import CSV
                </a>
              </>
            }
          >
            Add one by hand or import a list. Unknown details can stay unknown.
          </EmptyState>
        </Card>
      ) : (
        <>
          <SubscriptionFilters
            q={filters.q}
            status={filters.status}
            category={filters.category}
            due={filters.due}
            categories={categoriesOf(items)}
          />
          <nav
            aria-label="Filter by status"
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {statusFilters.map(([value, label]) => {
              const count =
                value === "all"
                  ? items.length
                  : items.filter((s) => s.status === value).length;
              const current = filters.status === value;
              return (
                <a
                  key={value}
                  href={filtersHref(filters, { status: value })}
                  aria-current={current ? "true" : undefined}
                  className={cx(
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-out",
                    current
                      ? "bg-ink text-canvas"
                      : "bg-surface text-ink-muted shadow-card hover:text-ink",
                  )}
                >
                  {label}
                  <span
                    className={cx(
                      "tabular-nums",
                      current ? "opacity-70" : "text-ink-faint",
                    )}
                  >
                    {count}
                  </span>
                </a>
              );
            })}
            <a
              href={filtersHref(filters, { due: !filters.due })}
              aria-current={filters.due ? "true" : undefined}
              className={cx(
                "inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-out",
                filters.due
                  ? "bg-ink text-canvas"
                  : "bg-surface text-ink-muted shadow-card hover:text-ink",
              )}
            >
              Renews in 30 days
            </a>
          </nav>

          <p className="mt-4 mb-2 text-sm text-ink-muted" aria-live="polite">
            {filtered
              ? `${shown.length} of ${items.length} subscriptions`
              : `${items.length} subscriptions`}
          </p>

          {shown.length === 0 ? (
            <Card>
              <EmptyState
                icon={SearchX}
                title="No matches"
                actions={
                  <a href="/subscriptions" className={buttonClass()}>
                    Reset filters
                  </a>
                }
              >
                Try another search, status or category.
              </EmptyState>
            </Card>
          ) : (
            <>
              <ul className="flex flex-col gap-2 md:hidden">
                {shown.map((s) => (
                  <SubscriptionCard
                    key={s.id}
                    s={s}
                    preferences={preferences}
                  />
                ))}
              </ul>
              <Card className="hidden overflow-hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-start text-xs text-ink-muted">
                      <th
                        scope="col"
                        className="py-3 ps-5 text-start font-medium"
                      >
                        Subscription
                      </th>
                      <th scope="col" className="py-3 text-end font-medium">
                        Cost
                      </th>
                      <th
                        scope="col"
                        className="py-3 ps-6 text-start font-medium"
                      >
                        Billing
                      </th>
                      <th scope="col" className="py-3 text-start font-medium">
                        Next renewal
                      </th>
                      <th
                        scope="col"
                        className="py-3 pe-5 text-start font-medium"
                      >
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr
                        key={s.id}
                        className="relative border-b border-line transition-colors duration-150 ease-out last:border-0 hover:bg-surface-hover"
                      >
                        <td className="py-3 ps-5">
                          <a
                            href={subscriptionHref(s.id)}
                            className="flex items-center gap-3 after:absolute after:inset-0 after:content-['']"
                          >
                            <ServiceAvatar name={s.name} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {s.name}
                              </span>
                              <span className="block truncate text-xs text-ink-muted">
                                {s.category}
                              </span>
                            </span>
                          </a>
                        </td>
                        <td className="py-3 text-end font-medium tabular-nums">
                          {s.amount === null ? (
                            <span className="font-normal text-ink-muted">
                              Unknown
                            </span>
                          ) : (
                            formatMoney(s.amount, s.currency, preferences)
                          )}
                        </td>
                        <td className="py-3 ps-6 text-ink-muted">
                          {cadenceLabels[s.cadence]}
                        </td>
                        <td className="py-3 text-ink-muted tabular-nums">
                          {s.renewalDate
                            ? formatDay(s.renewalDate, preferences)
                            : "Not confirmed"}
                        </td>
                        <td className="py-3 pe-5">
                          <StatusBadge status={s.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}

function SubscriptionCard({
  s,
  preferences,
}: {
  s: Subscription;
  preferences: Preferences;
}) {
  return (
    <li>
      <a
        href={subscriptionHref(s.id)}
        className="flex gap-3 rounded-2xl bg-surface p-3.5 shadow-card transition-colors duration-150 ease-out active:bg-surface-hover"
      >
        <ServiceAvatar name={s.name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[15px] font-medium">{s.name}</span>
            <span className="shrink-0 text-[15px] font-medium tabular-nums">
              {s.amount === null ? (
                <span className="font-normal text-ink-muted">Unknown</span>
              ) : (
                formatMoney(s.amount, s.currency, preferences)
              )}
            </span>
          </span>
          <span className="mt-0.5 flex items-baseline justify-between gap-3 text-sm text-ink-muted">
            <span className="truncate">{s.category}</span>
            <span className="shrink-0">{cadenceLabels[s.cadence]}</span>
          </span>
          <span className="mt-2.5 flex items-center justify-between gap-3">
            <StatusBadge status={s.status} />
            <span className="text-xs text-ink-muted tabular-nums">
              {s.renewalDate
                ? `Renews ${formatDay(s.renewalDate, preferences, { month: "short", day: "numeric" })}`
                : "No renewal date"}
            </span>
          </span>
        </span>
      </a>
    </li>
  );
}
