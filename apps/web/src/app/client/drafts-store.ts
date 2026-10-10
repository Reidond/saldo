import type { Proposal } from "@saldo/domain";
import { useSyncExternalStore } from "react";
import { registerUnsavedWork } from "../../framework/session";

/*
 * Unsaved work lives only in this browser tab: chat conversations and the
 * drafts (proposals) they or a CSV import produced. Nothing here is persisted;
 * a draft reaches the API only when the owner chooses Create or Update.
 */

export type DraftState = "pending" | "saved" | "discarded" | "error";

export interface Draft {
  key: string;
  proposal: Proposal;
  /** Identifies this exact batch; a retry reuses it, an edit replaces it. */
  requestId: string;
  origin:
    | { kind: "chat"; conversationId: string }
    | { kind: "csv"; file: string };
  state: DraftState;
  error?: string;
  retryable?: boolean;
  savedId?: string;
}

export interface ChatAttachmentPreview {
  name: string;
  dataUrl: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachmentPreview[];
  draftKeys?: string[];
  failed?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
}

interface DraftsSnapshot {
  conversations: Conversation[];
  activeConversationId: string | null;
  drafts: Draft[];
}

const empty: DraftsSnapshot = {
  conversations: [],
  activeConversationId: null,
  drafts: [],
};

let snapshot: DraftsSnapshot = empty;
const listeners = new Set<() => void>();

// Conversations and undecided drafts exist only in this tab, so an expired
// session must not reload it away (src/framework/session.ts).
registerUnsavedWork(
  () =>
    snapshot.conversations.some((c) => c.messages.length > 0) ||
    snapshot.drafts.some((d) => d.state === "pending" || d.state === "error"),
);

function update(change: (old: DraftsSnapshot) => DraftsSnapshot) {
  snapshot = change(snapshot);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDrafts() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => empty,
  );
}

export const newId = () => crypto.randomUUID();

export const draftsStore = {
  /** The current state, outside React (tests and event handlers). */
  get(): DraftsSnapshot {
    return snapshot;
  },
  /** Test helper: start from an empty tab. */
  reset() {
    update(() => empty);
  },
  startConversation(): string {
    const id = newId();
    update((s) => ({
      ...s,
      conversations: [
        { id, title: "New conversation", createdAt: Date.now(), messages: [] },
        ...s.conversations,
      ],
      activeConversationId: id,
    }));
    return id;
  },
  selectConversation(id: string) {
    update((s) => ({ ...s, activeConversationId: id }));
  },
  appendMessage(conversationId: string, message: ChatMessage) {
    update((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id !== conversationId
          ? c
          : {
              ...c,
              title:
                c.messages.length === 0 && message.role === "user"
                  ? titleFrom(message)
                  : c.title,
              messages: [...c.messages, message],
            },
      ),
    }));
  },
  /** A message that never got an answer: shown as not sent, left out of history. */
  markMessageFailed(conversationId: string, messageId: string) {
    update((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id !== conversationId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId ? { ...m, failed: true } : m,
              ),
            },
      ),
    }));
  },
  addDrafts(proposals: Proposal[], origin: Draft["origin"]): string[] {
    const drafts = proposals.map((proposal): Draft => ({
      key: newId(),
      proposal,
      requestId: newId(),
      origin,
      state: "pending",
    }));
    update((s) => ({ ...s, drafts: [...s.drafts, ...drafts] }));
    return drafts.map((d) => d.key);
  },
  /** Edits make a different batch, so they get a fresh request ID. */
  editDraft(key: string, proposal: Proposal) {
    update((s) => ({
      ...s,
      drafts: s.drafts.map((d) =>
        d.key === key
          ? {
              ...d,
              proposal,
              requestId: newId(),
              state: "pending",
              error: undefined,
            }
          : d,
      ),
    }));
  },
  settleDraft(
    key: string,
    change: Partial<Pick<Draft, "state" | "error" | "retryable" | "savedId">>,
  ) {
    update((s) => ({
      ...s,
      drafts: s.drafts.map((d) => (d.key === key ? { ...d, ...change } : d)),
    }));
  },
  removeDrafts(keys: string[]) {
    const remove = new Set(keys);
    update((s) => ({
      ...s,
      drafts: s.drafts.filter((d) => !remove.has(d.key)),
    }));
  },
};

function titleFrom(message: ChatMessage) {
  const text = message.text.trim().replace(/\s+/g, " ");
  if (text) return text.length > 48 ? `${text.slice(0, 47)}…` : text;
  return message.attachments?.length ? "Screenshot" : "New conversation";
}
