/** Joins class names, skipping falsy values. */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "sm" | "icon" | "icon-sm";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap select-none " +
  "transition-[background-color,color,box-shadow,scale] duration-150 ease-out " +
  "motion-safe:active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-brand-ink shadow-[inset_0_1px_0_oklch(1_0_0/0.12)] hover:bg-brand-hover",
  secondary:
    "bg-surface text-ink shadow-card hover:bg-surface-hover hover:shadow-card-hover",
  ghost: "text-ink-muted hover:bg-surface-hover hover:text-ink",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
};

// 44px tall on touch-sized screens, 40px from `sm`.
const buttonSizes: Record<ButtonSize, string> = {
  md: "h-11 px-4 text-[15px] sm:h-10 sm:text-sm",
  sm: "h-9 px-3 text-sm",
  icon: "size-11 sm:size-10",
  "icon-sm": "size-9",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  icon,
  radius = "lg",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** `xl` where the button sits 8px inside a 20px container (concentric). */
  radius?: "lg" | "xl";
  /** A leading icon takes 2px less padding on its side, for optical balance. */
  icon?: "leading" | "trailing";
} = {}) {
  return cx(
    buttonBase,
    radius === "xl" ? "rounded-xl" : "rounded-lg",
    buttonVariants[variant],
    buttonSizes[size],
    icon === "leading" && size === "md" && "ps-3.5",
    icon === "trailing" && size === "md" && "pe-3.5",
  );
}

/** Text inputs, selects and textareas: 16px on phones so iOS never zooms. */
export const fieldClass =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink " +
  "placeholder:text-ink-faint transition-[border-color,box-shadow] duration-150 ease-out " +
  "focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/20 " +
  "disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm " +
  "aria-invalid:border-danger aria-invalid:focus:ring-danger/20";

export const inputClass = cx(fieldClass, "h-11 sm:h-10");

export const selectClass = cx(
  fieldClass,
  "select-chevron h-11 appearance-none pe-9 sm:h-10",
);

export const labelClass = "mb-1.5 block text-sm font-medium text-ink";

/** Raised surface: shadow ring instead of a border. 16px radius. */
export const cardClass = "rounded-2xl bg-surface shadow-card";
