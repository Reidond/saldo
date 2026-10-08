import {
  Inbox,
  LayoutGrid,
  Layers3,
  LogOut,
  MessageCircle,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { todayIn } from "../../lib/format";
import { needsAttention } from "../../lib/subscriptions";
import { isApiError, type Me } from "../../server/api";
import { getRequestContext } from "../../server/context";
import { AccountMenu } from "../client/account-menu";
import { NavigationProgress } from "../client/navigation-progress";
import { SIGN_OUT_HREF, type Section } from "../routes";
import { Initial, Logo, Pill } from "../ui/components";
import { cx } from "../ui/styles";

const navItems: {
  section: Section;
  href: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { section: "overview", href: "/", label: "Overview", icon: LayoutGrid },
  {
    section: "subscriptions",
    href: "/subscriptions",
    label: "Subscriptions",
    icon: Layers3,
  },
  { section: "chat", href: "/chat", label: "Chat", icon: MessageCircle },
  { section: "review", href: "/review", label: "Review", icon: Inbox },
  {
    section: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings2,
  },
];

export function AppShell({
  section,
  children,
}: {
  section: Section | null;
  children: ReactNode;
}) {
  const { dataSource } = getRequestContext();
  const synthetic = dataSource === "synthetic";
  return (
    <div className="min-h-svh lg:ps-64">
      <NavigationProgress />
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-surface px-3 py-2 shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line px-4 pt-7 pb-4 lg:flex">
        <div className="flex items-center justify-between px-2">
          <a href="/" aria-label="Saldo overview" className="rounded-lg">
            <Logo />
          </a>
          {synthetic && <Pill tone="warn">Synthetic</Pill>}
        </div>
        <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
          {navItems.map((item) => (
            <SidebarLink
              key={item.section}
              item={item}
              active={section === item.section}
            />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <Suspense fallback={null}>
            <AiStatus />
          </Suspense>
          <Suspense fallback={<AccountSkeleton />}>
            <AccountBlock />
          </Suspense>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/85 ps-4 pe-2 backdrop-blur-md lg:hidden">
        <a href="/" aria-label="Saldo overview" className="rounded-lg">
          <Logo className="text-xl" />
        </a>
        <div className="flex items-center gap-1">
          {synthetic && <Pill tone="warn">Synthetic data</Pill>}
          <Suspense fallback={<div className="size-11" />}>
            <MobileAccount />
          </Suspense>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto max-w-6xl px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-10 lg:pb-16"
      >
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {navItems.map((item) => (
          <TabLink
            key={item.section}
            item={item}
            active={section === item.section}
          />
        ))}
      </nav>
    </div>
  );
}

function SidebarLink({
  item,
  active,
}: {
  item: (typeof navItems)[number];
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-[background-color,color,box-shadow] duration-150 ease-out",
        active
          ? "bg-surface font-medium text-ink shadow-card"
          : "text-ink-muted hover:bg-surface-hover hover:text-ink",
      )}
    >
      <Icon
        className={cx("size-4.5", active ? "text-brand" : undefined)}
        absoluteStrokeWidth
        strokeWidth={active ? 2 : 1.5}
        aria-hidden="true"
      />
      <span className="flex-1">{item.label}</span>
      {item.section === "review" && (
        <Suspense fallback={null}>
          <ReviewCount />
        </Suspense>
      )}
    </a>
  );
}

function TabLink({
  item,
  active,
}: {
  item: (typeof navItems)[number];
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex min-h-15 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-[background-color,color] duration-150 ease-out",
        active ? "text-brand" : "text-ink-muted",
      )}
    >
      <span
        className={cx(
          "grid h-7 w-12 place-items-center rounded-full transition-[background-color,color] duration-150 ease-out",
          active && "bg-brand-soft",
        )}
      >
        <Icon
          className="size-5"
          absoluteStrokeWidth
          strokeWidth={active ? 2 : 1.5}
          aria-hidden="true"
        />
      </span>
      {item.label}
      {item.section === "review" && (
        <Suspense fallback={null}>
          <span className="absolute top-1.5 left-[calc(50%+10px)]">
            <ReviewCount compact />
          </span>
        </Suspense>
      )}
    </a>
  );
}

/** Saved records that need a look; the count links people to the inbox. */
async function ReviewCount({ compact = false }: { compact?: boolean }) {
  const { load, preferences } = getRequestContext();
  const items = await load.subscriptions().catch(() => null);
  if (!items) return null;
  const count = needsAttention(items, todayIn(preferences.timeZone)).length;
  if (!count) return null;
  return (
    <span
      className={cx(
        "inline-grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        compact
          ? "h-4.5 bg-brand text-brand-ink"
          : "h-5 bg-brand-soft text-brand-soft-ink",
      )}
    >
      {count}
      <span className="sr-only"> need review</span>
    </span>
  );
}

async function AiStatus() {
  const { load } = getRequestContext();
  const status = await load.status().catch(() => null);
  const connected = status?.aiConnected === true;
  return (
    <a
      href="/settings#chatgpt"
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-ink-muted transition-[background-color,color] duration-150 ease-out hover:bg-surface-hover hover:text-ink"
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-2 rounded-full",
          connected ? "bg-brand" : "bg-ink-faint",
        )}
      />
      {connected ? "ChatGPT connected" : "AI unavailable · manual entry works"}
    </a>
  );
}

async function loadMe() {
  const { load } = getRequestContext();
  try {
    return await load.me();
  } catch (error) {
    if (isApiError(error) && error.code === "unauthenticated") throw error;
    return null;
  }
}

function displayName(me: Me | null) {
  return me?.displayName || me?.email || "Owner";
}

async function AccountBlock() {
  const me = await loadMe().catch(() => null);
  const name = displayName(me);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-2 ps-3 shadow-card">
      <Initial name={name} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-ink-muted">
          {me?.email && me.displayName ? me.email : "Signed in with Access"}
        </p>
      </div>
      <a
        href={SIGN_OUT_HREF}
        aria-label="Sign out"
        title="Sign out of Saldo and other Access apps"
        className="grid size-9 place-items-center rounded-lg text-ink-muted transition-[background-color,color] duration-150 ease-out hover:bg-surface-hover hover:text-ink"
      >
        <LogOut
          className="size-4.5"
          absoluteStrokeWidth
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </a>
    </div>
  );
}

async function MobileAccount() {
  const me = await loadMe().catch(() => null);
  return <AccountMenu name={displayName(me)} email={me?.email ?? null} />;
}

function AccountSkeleton() {
  return <div className="h-[52px] rounded-2xl bg-surface-sunken" />;
}
