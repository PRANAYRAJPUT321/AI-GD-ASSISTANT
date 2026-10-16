"use client";

import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Print shows everything in its final state, including blocks whose entrance never ran
 * because they were never scrolled into view (motion leaves them at opacity 0 inline).
 */
export const PRINT_SETTLED = "print:opacity-100! print:transform-none!";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Fades and lifts its content in the first time it scrolls into view, so the scorecard
 * assembles as you read it. The global MotionConfig drops the lift for reduced motion.
 */
export function Reveal({
  delay = 0,
  className,
  children,
}: {
  /** Seconds, for staggering siblings that enter together. */
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -48px 0px" }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay }}
      className={cn(PRINT_SETTLED, className)}
    >
      {children}
    </motion.div>
  );
}

/**
 * A bar fill that grows from its left edge the first time it scrolls into view. Size and
 * colour come from `className`/`style` (its final state), so print and reduced motion
 * (which skips transform animations) show the true length.
 */
export function GrowBar({
  delay = 0,
  className,
  style,
}: {
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.span
      aria-hidden
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: EASE_OUT, delay }}
      className={cn("block origin-left", PRINT_SETTLED, className)}
      style={style}
    />
  );
}
