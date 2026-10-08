import "../styles.css";
import { Suspense } from "react";
import { ChatPage } from "./pages/chat";
import { NotFoundPage } from "./pages/not-found";
import { OverviewPage } from "./pages/overview";
import { ReviewPage } from "./pages/review";
import { SettingsPage } from "./pages/settings";
import { SubscriptionPage } from "./pages/subscription";
import { SubscriptionFormPage } from "./pages/subscription-form";
import { SubscriptionsPage } from "./pages/subscriptions";
import { PageSkeleton } from "./pages/shared";
import { matchRoute, sectionOf, type Route } from "./routes";
import { AppShell } from "./shell/app-shell";

export function Root({ url }: { url: URL }) {
  const route = matchRoute(url.pathname);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="robots" content="noindex, nofollow" />
        <meta
          name="theme-color"
          content="#f7f8f4"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#141a17"
          media="(prefers-color-scheme: dark)"
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <AppShell section={sectionOf(route)}>
          <Suspense fallback={<PageSkeleton />}>
            <Page route={route} url={url} />
          </Suspense>
        </AppShell>
      </body>
    </html>
  );
}

function Page({ route, url }: { route: Route; url: URL }) {
  switch (route.name) {
    case "overview":
      return <OverviewPage />;
    case "subscriptions":
      return <SubscriptionsPage params={url.searchParams} />;
    case "new-subscription":
      return <SubscriptionFormPage />;
    case "subscription":
      return <SubscriptionPage id={route.id} params={url.searchParams} />;
    case "edit-subscription":
      return <SubscriptionFormPage id={route.id} />;
    case "chat":
      return <ChatPage />;
    case "review":
      return <ReviewPage />;
    case "settings":
      return <SettingsPage />;
    case "not-found":
      return <NotFoundPage />;
  }
}
