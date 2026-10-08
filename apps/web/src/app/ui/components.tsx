import type { ComponentProps, CSSProperties, ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Status } from "../../lib/subscriptions";
import { statusLabels } from "../../lib/subscriptions";
import { cardClass, cx } from "./styles";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 text-[22px] font-bold tracking-[-0.04em] text-ink",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6 text-brand"
        aria-hidden="true"
        fill="currentColor"
      >
        <rect
          x="3.5"
          y="9"
          width="4"
          height="11"
          rx="2"
          transform="rotate(-8 5.5 14.5)"
        />
        <rect
          x="10"
          y="4"
          width="4"
          height="16"
          rx="2"
          transform="rotate(-8 12 12)"
        />
        <rect
          x="16.5"
          y="6.5"
          width="4"
          height="10"
          rx="2"
          transform="rotate(-8 18.5 11.5)"
        />
      </svg>
      <span>
        saldo<span className="text-brand">.</span>
      </span>
    </span>
  );
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx(cardClass, className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-prose text-[15px] text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const statusTone: Record<Status, string> = {
  active: "bg-brand-soft text-brand-soft-ink",
  trial: "bg-info-soft text-info-ink",
  paused:
    "bg-surface-sunken text-ink-muted shadow-[inset_0_0_0_1px_var(--line)]",
  cancelled:
    "bg-surface-sunken text-ink-muted shadow-[inset_0_0_0_1px_var(--line)]",
  unknown: "bg-warn-soft text-warn-ink",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        statusTone[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "brand" | "danger" | "info";
}) {
  const tones = {
    neutral:
      "bg-surface-sunken text-ink-muted shadow-[inset_0_0_0_1px_var(--line)]",
    warn: "bg-warn-soft text-warn-ink",
    brand: "bg-brand-soft text-brand-soft-ink",
    danger: "bg-danger-soft text-danger-ink",
    info: "bg-info-soft text-info-ink",
  };
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

const noticeTones: Record<
  "info" | "success" | "warn" | "danger",
  { className: string; icon: LucideIcon }
> = {
  info: { className: "bg-info-soft text-info-ink", icon: Info },
  success: {
    className: "bg-brand-soft text-brand-soft-ink",
    icon: CircleCheck,
  },
  warn: { className: "bg-warn-soft text-warn-ink", icon: TriangleAlert },
  danger: { className: "bg-danger-soft text-danger-ink", icon: CircleAlert },
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: keyof typeof noticeTones;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const { className: toneClass, icon: Icon } = noticeTones[tone];
  return (
    <div
      role={role}
      className={cx(
        "flex gap-3 rounded-xl px-4 py-3 text-sm",
        toneClass,
        className,
      )}
    >
      <Icon
        className="mt-px size-4.5 shrink-0"
        strokeWidth={2}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && (
          <div className={cx(title ? "mt-0.5" : null, "opacity-90")}>
            {children}
          </div>
        )}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center px-6 py-12 text-center",
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-soft-ink">
        <Icon className="size-5.5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-base font-semibold tracking-tight">{title}</h3>
      {children && (
        <div className="mt-1.5 max-w-sm text-sm text-ink-muted">{children}</div>
      )}
      {actions && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

const avatarHues = [160, 185, 80, 330, 255, 30, 120, 290];

/** A neutral initial tile; brand logos are never fetched or embedded. */
export function ServiceAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = avatarHues[hash % avatarHues.length];
  const sizes = {
    sm: "size-8 rounded-lg text-[13px]",
    md: "size-10 rounded-[10px] text-[15px]",
    lg: "size-14 rounded-2xl text-xl",
  };
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center font-semibold",
        "bg-[oklch(0.94_0.04_var(--hue))] text-[oklch(0.42_0.09_var(--hue))]",
        "dark:bg-[oklch(0.32_0.05_var(--hue))] dark:text-[oklch(0.88_0.07_var(--hue))]",
        sizes[size],
      )}
      style={{ "--hue": hue } as CSSProperties}
    >
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-sunken px-1 font-sans text-[11px] text-ink-muted">
      {children}
    </kbd>
  );
}

/** Visually hidden but announced. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function Initial({
  name,
  size = "sm",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid place-items-center rounded-full bg-brand-soft font-semibold text-brand-soft-ink",
        size === "sm" ? "size-8 text-[13px]" : "size-9 text-sm",
      )}
    >
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
