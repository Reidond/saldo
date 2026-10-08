"use client";
import {
  boundedChatHistory,
  duplicateKey,
  proposalSchema,
  type Proposal,
  type Subscription,
} from "@saldo/domain";
import {
  ArrowUp,
  FileUp,
  ImagePlus,
  MessageCirclePlus,
  PenLine,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { formatBytes } from "../../lib/format";
import { Notice } from "../ui/components";
import { buttonClass, cx } from "../ui/styles";
import {
  draftsStore,
  newId,
  useDrafts,
  type ChatMessage,
  type Conversation,
} from "./drafts-store";
import { ReviewCard, type SaveProposal } from "./review-card";

const ACCEPTED_IMAGES = ["image/png", "image/jpeg", "image/webp"] as const;
type ImageType = (typeof ACCEPTED_IMAGES)[number];
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 7 * 1024 * 1024;

interface PendingAttachment {
  id: string;
  name: string;
  type: ImageType;
  size: number;
  dataUrl: string;
}

interface Sending {
  startedAt: number;
  images: number;
  bytes: number;
}

const examples = [
  "Add Lumen Music for $9.99 a month",
  "This is the new price for my existing plan",
  "Which subscriptions have no renewal date?",
];

export interface ChatProps {
  aiAvailable: boolean;
  subscriptions: Subscription[];
  locale: string;
  save: SaveProposal;
}

export function Chat({ aiAvailable, subscriptions, locale, save }: ChatProps) {
  const { conversations, activeConversationId, drafts } = useDrafts();
  const active = conversations.find((c) => c.id === activeConversationId);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState<Sending | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const messageCount = active?.messages.length ?? 0;

  useEffect(() => () => controller.current?.abort(), []);
  // Bring the newest turn (or the progress row) to the top of the view, so a
  // long reply with review cards is read from its start.
  useEffect(() => {
    if (!messageCount && !sending) return;
    const items = threadEnd.current?.previousElementSibling?.children;
    items?.[items.length - 1]?.scrollIntoView?.({
      block: "start",
      behavior: "smooth",
    });
  }, [messageCount, sending]);

  const addFiles = async (files: File[]) => {
    setError("");
    const images = files.filter((f) =>
      ACCEPTED_IMAGES.includes(f.type as ImageType),
    );
    if (images.length < files.length)
      setError("Only PNG, JPEG and WebP images can be attached.");
    if (attachments.length + images.length > MAX_IMAGES) {
      setError(`Attach up to ${MAX_IMAGES} images per message.`);
      return;
    }
    if (images.some((f) => f.size > MAX_IMAGE_BYTES)) {
      setError("Each image must be smaller than 5 MB.");
      return;
    }
    const total =
      attachments.reduce((sum, a) => sum + a.size, 0) +
      images.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      setError("Images in one message must total less than 7 MB.");
      return;
    }
    try {
      const loaded = await Promise.all(
        images.map(async (file): Promise<PendingAttachment> => ({
          id: newId(),
          name: file.name || "Pasted image",
          type: file.type as ImageType,
          size: file.size,
          dataUrl: await readAsDataUrl(file),
        })),
      );
      setAttachments((old) => [...old, ...loaded].slice(0, MAX_IMAGES));
    } catch {
      setError("That image could not be opened. Choose it again.");
    }
  };

  const send = async () => {
    const text = message.trim();
    if (!aiAvailable || sendLock.current || (!text && !attachments.length))
      return;
    sendLock.current = true;
    setError("");
    const conversationId = active?.id ?? draftsStore.startConversation();
    const history = boundedChatHistory(
      (active?.messages ?? [])
        .filter((m) => !m.failed && m.text)
        .map((m) => ({ role: m.role, content: m.text })),
    );
    const sent = attachments;
    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      attachments: sent.map(({ name, dataUrl }) => ({ name, dataUrl })),
    };
    draftsStore.appendMessage(conversationId, userMessage);
    setMessage("");
    setAttachments([]);
    const request = new AbortController();
    controller.current = request;
    setSending({
      startedAt: Date.now(),
      images: sent.length,
      bytes: sent.reduce((sum, a) => sum + a.size, 0),
    });
    try {
      const response = await fetch("/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          message: text,
          attachments: sent.map(({ name, type, dataUrl }) => ({
            name,
            type,
            dataUrl,
          })),
          history,
        }),
        signal: request.signal,
      });
      const body = (await response.json().catch(() => null)) as {
        reply?: unknown;
        proposals?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Your session expired. Reload to sign in again."
            : typeof body?.error === "string"
              ? body.error
              : "ChatGPT could not complete this request. Nothing was saved.",
        );
      const proposals = proposalSchema
        .array()
        .max(100)
        .parse(body?.proposals ?? []);
      const keys = draftsStore.addDrafts(withHints(proposals, subscriptions), {
        kind: "chat",
        conversationId,
      });
      draftsStore.appendMessage(conversationId, {
        id: newId(),
        role: "assistant",
        text:
          typeof body?.reply === "string"
            ? body.reply
            : "Review these proposed changes before saving.",
        draftKeys: keys,
      });
    } catch (e) {
      draftsStore.markMessageFailed(conversationId, userMessage.id);
      // Put the message back so nothing typed or attached is lost.
      setMessage(text);
      setAttachments(sent);
      setError(
        request.signal.aborted
          ? "Stopped. Nothing was saved; your message is back in the box."
          : `${e instanceof Error && e.message ? e.message : "Something went wrong."} Your message is back in the box.`,
      );
    } finally {
      sendLock.current = false;
      setSending(null);
      if (controller.current === request) controller.current = null;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!aiAvailable) return;
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const busy = sending !== null;
  const canSend =
    aiAvailable && !busy && (message.trim() !== "" || attachments.length > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[13.5rem_1fr]">
      {aiAvailable || conversations.length > 0 ? (
        <ConversationList
          conversations={conversations}
          activeId={active?.id ?? null}
          disabled={busy}
        />
      ) : (
        <div className="max-lg:hidden" />
      )}

      <section
        aria-label="Conversation"
        className="flex min-h-[calc(100svh-21rem)] min-w-0 flex-col lg:min-h-[calc(100svh-15rem)]"
      >
        {!aiAvailable && (
          <Notice
            tone="warn"
            title="AI is unavailable"
            className="mb-5"
            action={
              <div className="flex flex-wrap gap-2">
                <a
                  href="/subscriptions/new"
                  className={buttonClass({ size: "sm", icon: "leading" })}
                >
                  <PenLine
                    className="size-4"
                    absoluteStrokeWidth
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  Add manually
                </a>
                <a
                  href="/review#import"
                  className={buttonClass({ size: "sm", icon: "leading" })}
                >
                  <FileUp
                    className="size-4"
                    absoluteStrokeWidth
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  Import CSV
                </a>
              </div>
            }
          >
            ChatGPT isn’t connected, so Saldo can’t read messages or
            screenshots. Nothing you type here is sent anywhere. Manual entry
            and CSV import work as usual.
          </Notice>
        )}

        <div className="flex-1" aria-live="polite">
          {messageCount === 0 && !busy ? (
            <Intro
              aiAvailable={aiAvailable}
              onPick={(text) => {
                setMessage(text);
                textarea.current?.focus();
              }}
            />
          ) : (
            <ol className="flex flex-col gap-5 [&>li]:scroll-mt-20 [&>li]:transition-[opacity,translate] [&>li]:duration-200 [&>li]:ease-out motion-safe:[&>li]:starting:translate-y-1 [&>li]:starting:opacity-0">
              {active?.messages.map((m) => (
                <li key={m.id}>
                  <MessageBubble message={m} />
                  {m.draftKeys && m.draftKeys.length > 0 && (
                    <div className="mt-3 flex flex-col gap-3">
                      {m.draftKeys.map((key) => {
                        const draft = drafts.find((d) => d.key === key);
                        return draft ? (
                          <ReviewCard
                            key={key}
                            draft={draft}
                            subscriptions={subscriptions}
                            locale={locale}
                            save={save}
                          />
                        ) : null;
                      })}
                    </div>
                  )}
                </li>
              ))}
              {sending && (
                <li>
                  <Progress
                    sending={sending}
                    onCancel={() => controller.current?.abort()}
                  />
                </li>
              )}
            </ol>
          )}
          <div ref={threadEnd} className="h-px" />
        </div>

        <div
          className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] mt-6 lg:bottom-6"
          onDragOver={(event) => aiAvailable && event.preventDefault()}
          onDrop={onDrop}
        >
          {error && (
            <p
              role="alert"
              className="mb-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger-ink"
            >
              {error}
            </p>
          )}
          <div className="rounded-[20px] bg-surface p-2 shadow-pop">
            {attachments.length > 0 && (
              <ul
                aria-label="Attached images"
                className="flex gap-2 overflow-x-auto pb-2"
              >
                {attachments.map((a) => (
                  <li
                    key={a.id}
                    className="relative flex shrink-0 items-center gap-2 rounded-xl bg-surface-sunken p-1.5 pe-9 shadow-[inset_0_0_0_1px_var(--line)] transition-[opacity,scale] duration-200 ease-out starting:scale-[0.96] starting:opacity-0"
                  >
                    <img
                      src={a.dataUrl}
                      alt=""
                      className="size-11 rounded-md object-cover"
                    />
                    <span className="max-w-32 min-w-0 text-xs">
                      <span className="block truncate font-medium">
                        {a.name}
                      </span>
                      <span className="block text-ink-muted">
                        {formatBytes(a.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${a.name}`}
                      onClick={() =>
                        setAttachments((old) =>
                          old.filter((x) => x.id !== a.id),
                        )
                      }
                      className="absolute end-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-surface-hover hover:text-ink"
                    >
                      <X
                        className="size-4"
                        absoluteStrokeWidth
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="sr-only" htmlFor="chat-message">
              Message Saldo
            </label>
            <textarea
              id="chat-message"
              ref={textarea}
              rows={1}
              maxLength={12000}
              value={message}
              disabled={!aiAvailable || busy}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={
                aiAvailable
                  ? "Describe a subscription or attach a screenshot…"
                  : "AI is unavailable"
              }
              className="block max-h-48 min-h-11 w-full resize-none bg-transparent px-2.5 py-2.5 text-base text-ink [field-sizing:content] placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed sm:text-[15px]"
            />
            <div className="flex items-center justify-between gap-2">
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_IMAGES.join(",")}
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void addFiles(files);
                }}
              />
              <button
                type="button"
                disabled={
                  !aiAvailable || busy || attachments.length >= MAX_IMAGES
                }
                onClick={() => fileInput.current?.click()}
                className={buttonClass({
                  variant: "ghost",
                  size: "sm",
                  icon: "leading",
                  radius: "xl",
                })}
              >
                <ImagePlus
                  className="size-4.5"
                  absoluteStrokeWidth
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Add image
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void send()}
                aria-label="Send for review"
                className={buttonClass({
                  variant: "primary",
                  size: "icon-sm",
                  radius: "xl",
                })}
              >
                <ArrowUp
                  className="size-4.5"
                  absoluteStrokeWidth
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          <p className="mt-2 hidden text-center text-xs text-ink-faint sm:block">
            Suggestions are drafts. Nothing is saved until you choose Create or
            Update.
          </p>
        </div>
      </section>
    </div>
  );
}

function ConversationList({
  conversations,
  activeId,
  disabled,
}: {
  conversations: Conversation[];
  activeId: string | null;
  disabled: boolean;
}) {
  return (
    <nav
      aria-label="Conversations"
      className="flex flex-col gap-1 max-lg:flex-row max-lg:items-center max-lg:gap-2"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => draftsStore.startConversation()}
        className={cx(
          buttonClass({ size: "sm", icon: "leading" }),
          "lg:mb-2 lg:self-start",
        )}
      >
        <MessageCirclePlus
          className="size-4"
          absoluteStrokeWidth
          strokeWidth={2}
          aria-hidden="true"
        />
        New conversation
      </button>
      {conversations.length > 0 && (
        <>
          <label className="min-w-0 flex-1 lg:hidden">
            <span className="sr-only">Conversation</span>
            <select
              disabled={disabled}
              value={activeId ?? ""}
              onChange={(event) =>
                draftsStore.selectConversation(event.target.value)
              }
              className="h-9 w-full truncate rounded-lg bg-surface px-3 text-sm shadow-card"
            >
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <ul className="hidden flex-col gap-0.5 lg:flex">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-current={c.id === activeId ? "true" : undefined}
                  onClick={() => draftsStore.selectConversation(c.id)}
                  className={cx(
                    "w-full truncate rounded-lg px-3 py-2 text-start text-sm transition-[background-color,color] duration-150 ease-out",
                    c.id === activeId
                      ? "bg-surface font-medium shadow-card"
                      : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                  )}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
          <p className="hidden px-3 pt-2 text-xs text-ink-faint lg:block">
            Conversations stay in this tab until you reload.
          </p>
        </>
      )}
    </nav>
  );
}

function Intro({
  aiAvailable,
  onPick,
}: {
  aiAvailable: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center sm:py-16">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-soft-ink">
        <Sparkles
          className="size-5.5"
          absoluteStrokeWidth
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">
        Add or update by chatting
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted">
        Describe a subscription or attach a receipt screenshot. Saldo proposes
        the details; you check each one before anything is saved.
      </p>
      {aiAvailable && (
        <ul className="mt-6 flex w-full max-w-md flex-col gap-2">
          {examples.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => onPick(example)}
                className="w-full rounded-xl bg-surface px-4 py-3 text-start text-sm shadow-card transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-surface-hover hover:shadow-card-hover motion-safe:active:scale-[0.96]"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user")
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((a, i) => (
              <img
                key={i}
                src={a.dataUrl}
                alt={a.name}
                className="size-20 rounded-xl object-cover sm:size-24"
              />
            ))}
          </div>
        )}
        {message.text && (
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] whitespace-pre-wrap text-brand-ink sm:text-sm">
            {message.text}
          </p>
        )}
        {message.failed && <p className="text-xs text-danger-ink">Not sent</p>}
      </div>
    );
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-soft-ink">
        <Sparkles
          className="size-3.5"
          absoluteStrokeWidth
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </span>
      <p className="min-w-0 pt-1 text-[15px] whitespace-pre-wrap sm:text-sm">
        {message.text}
      </p>
    </div>
  );
}

/** Honest progress: what was sent, how long it's been, and a way out. */
function Progress({
  sending,
  onCancel,
}: {
  sending: Sending;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - sending.startedAt) / 1000));
  const what =
    sending.images > 0
      ? `${sending.images} ${sending.images === 1 ? "image" : "images"} · ${formatBytes(sending.bytes)}`
      : "your message";
  return (
    <div className="flex gap-3" role="status">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-soft-ink">
        <Sparkles
          className="size-3.5 motion-safe:animate-pulse"
          absoluteStrokeWidth
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0 flex-1 pt-1 text-sm">
        <p className="font-medium">
          {seconds < 2
            ? `Sending ${what}…`
            : "ChatGPT is reading and extracting details…"}
        </p>
        <p className="text-ink-muted tabular-nums">
          {seconds}s{seconds >= 30 && " · large screenshots can take a minute"}
          {" · nothing is saved until you decide"}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className={cx(
            buttonClass({ variant: "secondary", size: "sm" }),
            "mt-2",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Flags a proposed "add" that matches a saved record so it can be an update. */
function withHints(proposals: Proposal[], subscriptions: Subscription[]) {
  return proposals.map((p) => {
    const match =
      p.operation === "add" &&
      subscriptions.find((s) => duplicateKey(s) === duplicateKey(p));
    return match
      ? {
          ...p,
          warnings: [
            ...(p.warnings ?? []),
            `Possible duplicate of ${match.name}. Choose “Update ${match.name}” if it’s the same subscription.`,
          ],
        }
      : p;
  });
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unreadable image"));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
