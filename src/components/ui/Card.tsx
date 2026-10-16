import type { HTMLAttributes } from "react";
import { cn } from "./cn";

interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Landmark element to render; "div" by default. */
  as?: "div" | "section" | "aside";
}

/** Rounded panel surface used for every grouped block of the UI. */
export function Card({ as: Element = "div", className, ...rest }: CardProps) {
  return <Element className={cn("rounded-2xl border border-line bg-panel shadow-card", className)} {...rest} />;
}

/** Small uppercase label above a heading or value. */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs font-semibold uppercase tracking-[0.08em] text-ink-2", className)} {...rest} />;
}
