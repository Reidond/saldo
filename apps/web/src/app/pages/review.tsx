import { CircleCheck } from "lucide-react";
import { todayIn } from "../../lib/format";
import { needsAttention } from "../../lib/subscriptions";
import { saveProposal } from "../../server/actions";
import { getRequestContext } from "../../server/context";
import { CsvImport, DraftInbox } from "../client/review-inbox";
import { subscriptionHref } from "../routes";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Pill,
  ServiceAvatar,
} from "../ui/components";
import { attempt, LoadError, Title } from "./shared";

export async function ReviewPage() {
  const { load, preferences } = getRequestContext();
  const result = await attempt(load.subscriptions);
  const header = (
    <PageHeader
      title="Review inbox"
      description="Drafts waiting for a decision, and saved records with missing or old details."
    />
  );
  if (!result.ok)
    return (
      <>
        <Title>Review</Title>
        {header}
        <LoadError error={result.error} what="the review inbox" />
      </>
    );
  const items = result.value;
  const attention = needsAttention(items, todayIn(preferences.timeZone));
  return (
    <>
      <Title>Review</Title>
      {header}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="drafts-title" className="min-w-0">
          <h2
            id="drafts-title"
            className="mb-3 text-[15px] font-semibold tracking-tight"
          >
            Drafts
          </h2>
          <DraftInbox
            subscriptions={items}
            locale={preferences.locale}
            save={saveProposal}
          />
        </section>

        <div className="flex flex-col gap-6 lg:row-span-2">
          <Card
            id="import"
            aria-labelledby="import-title"
            className="scroll-mt-20"
          >
            <CardHeader
              id="import-title"
              title="Import a CSV"
              description="Each row becomes a draft for you to check."
            />
            <div className="px-5 pb-5">
              <CsvImport subscriptions={items} />
            </div>
          </Card>
        </div>

        <section aria-labelledby="attention-title" className="min-w-0">
          <h2
            id="attention-title"
            className="mb-3 text-[15px] font-semibold tracking-tight"
          >
            Saved records to check{" "}
            <span className="font-normal text-ink-muted tabular-nums">
              {attention.length}
            </span>
          </h2>
          <Card>
            {attention.length ? (
              <ul className="p-2">
                {attention.map(({ subscription, issues }) => (
                  <li key={subscription.id}>
                    <a
                      href={`${subscriptionHref(subscription.id)}/edit`}
                      className="flex gap-3 rounded-lg p-2.5 transition-colors duration-150 ease-out hover:bg-surface-hover"
                    >
                      <ServiceAvatar name={subscription.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate text-[15px] font-medium sm:text-sm">
                            {subscription.name}
                          </span>
                          <span className="shrink-0 text-sm font-medium text-brand">
                            Fix
                          </span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {issues.map((issue) => (
                            <Pill
                              key={issue.kind + issue.label}
                              tone={
                                issue.kind === "duplicate"
                                  ? "danger"
                                  : issue.kind === "stale"
                                    ? "neutral"
                                    : "warn"
                              }
                            >
                              {issue.label}
                            </Pill>
                          ))}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={CircleCheck} title="All records look complete">
                Records with an unknown amount, date or status, old evidence or
                a possible duplicate show up here.
              </EmptyState>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
