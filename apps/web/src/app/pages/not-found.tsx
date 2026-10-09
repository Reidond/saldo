import { Compass } from "lucide-react";
import { Card, EmptyState } from "../ui/components";
import { buttonClass } from "../ui/styles";
import { Title } from "./shared";

export function NotFoundPage({ what = "page" }: { what?: string }) {
  return (
    <>
      <Title>Not found</Title>
      <Card className="mt-2">
        <EmptyState
          icon={Compass}
          title={`This ${what} doesn’t exist`}
          actions={
            <>
              <a href="/subscriptions" className={buttonClass()}>
                All subscriptions
              </a>
              <a href="/" className={buttonClass({ variant: "ghost" })}>
                Overview
              </a>
            </>
          }
        >
          It may have been removed, or the link is incomplete.
        </EmptyState>
      </Card>
    </>
  );
}
