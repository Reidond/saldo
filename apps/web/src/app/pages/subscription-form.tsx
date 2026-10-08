import { formatMoment } from "../../lib/format";
import type { SubscriptionFormValues } from "../../lib/subscription-form";
import { categoriesOf } from "../../lib/subscriptions";
import { saveSubscription } from "../../server/actions";
import { getRequestContext } from "../../server/context";
import { SubscriptionForm } from "../client/subscription-form";
import { subscriptionHref } from "../routes";
import { Card, PageHeader } from "../ui/components";
import { NotFoundPage } from "./not-found";
import { attempt, LoadError, Title } from "./shared";
import { BackLink } from "./subscription";

/** Add (no id) or edit (id) a subscription by hand. Works without AI. */
export async function SubscriptionFormPage({ id }: { id?: string }) {
  const { load, preferences } = getRequestContext();
  const result = await attempt(load.subscriptions);
  const title = id ? "Edit subscription" : "Add a subscription";
  if (!result.ok)
    return (
      <>
        <Title>{title}</Title>
        <BackLink href="/subscriptions">Subscriptions</BackLink>
        <LoadError error={result.error} what="this form" />
      </>
    );
  const existing = id ? result.value.find((s) => s.id === id) : undefined;
  if (id && !existing) return <NotFoundPage what="subscription" />;
  const initial: SubscriptionFormValues = existing
    ? { ...existing }
    : {
        name: "",
        amount: null,
        currency: preferences.currency,
        cadence: "monthly",
        renewalDate: null,
        status: "active",
        category: "Other",
        source: "",
        lastVerified: null,
        notes: "",
      };
  const back = existing ? subscriptionHref(existing.id) : "/subscriptions";
  return (
    <>
      <Title>{existing ? `Edit ${existing.name}` : title}</Title>
      <BackLink href={back}>
        {existing ? existing.name : "Subscriptions"}
      </BackLink>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title={existing ? `Edit ${existing.name}` : title}
          description={
            existing
              ? "Change what you know. Unknown details can stay unknown."
              : "Add what you know now; fill in the rest later."
          }
        />
        <Card className="p-5 sm:p-6">
          <SubscriptionForm
            id={existing?.id}
            initial={initial}
            categories={categoriesOf(result.value)}
            lastVerifiedLabel={
              existing?.lastVerified
                ? formatMoment(existing.lastVerified, preferences)
                : null
            }
            cancelHref={back}
            save={saveSubscription}
          />
        </Card>
      </div>
    </>
  );
}
