import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold " +
  "transition-[background-color,border-color,color,box-shadow,transform,translate,scale,opacity,filter] duration-150 " +
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
  "active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

const VARIANTS: Record<ButtonVariant, string> = {
  // The brand gradient with a soft glow, lifting a little on hover like a physical key.
  primary:
    "bg-accent bg-linear-to-br from-accent to-accent-2 text-accent-ink shadow-glow " +
    "hover:-translate-y-px hover:brightness-110 disabled:hover:translate-y-0 disabled:hover:brightness-100 " +
    "motion-reduce:hover:translate-y-0",
  secondary: "border border-line bg-panel text-ink hover:border-ink-3/50 hover:bg-panel-2",
  ghost: "text-ink-2 hover:bg-panel-2 hover:text-ink",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-14 px-6 text-base sm:text-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shows a spinner and ignores clicks. Unlike `disabled`, the button keeps keyboard focus,
   * so focus is not lost while a request is in flight.
   */
  busy?: boolean;
  /** Icon before the label (replaced by the spinner while busy). */
  icon?: ReactNode;
  /** Icon after the label. */
  iconEnd?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  icon,
  iconEnd,
  className,
  children,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      // Also stops a busy submit button from re-submitting its form.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={handleClick}
      className={cn(BASE, VARIANTS[variant], SIZES[size], busy && "cursor-progress", className)}
      {...rest}
    >
      {busy ? <LoaderCircle aria-hidden className="size-[1.15em] animate-spin motion-reduce:animate-none" /> : icon}
      {children}
      {iconEnd}
    </button>
  );
}
