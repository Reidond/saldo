import { saveProposal } from "../../server/actions";
import { getRequestContext } from "../../server/context";
import { Chat } from "../client/chat";
import { PageHeader } from "../ui/components";
import { attempt, LoadError, Title } from "./shared";

export async function ChatPage() {
  const { load, preferences } = getRequestContext();
  const [items, status] = await Promise.all([
    attempt(load.subscriptions),
    attempt(load.status),
  ]);
  return (
    <>
      <Title>Chat</Title>
      <PageHeader
        title="Chat"
        description="Add or update subscriptions from a message or a screenshot. You review every change."
      />
      {items.ok ? (
        <Chat
          aiAvailable={status.ok && status.value.aiConnected}
          subscriptions={items.value}
          locale={preferences.locale}
          save={saveProposal}
        />
      ) : (
        <LoadError error={items.error} what="your subscriptions" />
      )}
    </>
  );
}
