"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/components/ui/cn";

/**
 * A persona colour mixed towards the ink token, for names written in colour. Mixing with ink
 * darkens the colour on the light theme and lightens it on the dark one, so coloured text
 * keeps readable contrast in both (raw persona colours like the drifter's orange don't).
 */
export function inkTint(color: string): string {
  return `color-mix(in oklab, ${color} 62%, var(--ink))`;
}

/** Bar heights (relative) of the speaking equalizer, so it reads as a voice rather than a meter. */
const EQ_PEAKS = [0.55, 1, 0.72, 0.88] as const;

/**
 * Animated equalizer bars next to whoever is speaking. With `level` (0..1, the candidate's
 * live mic) the bars follow the voice; without it they loop to show an AI voice playing.
 */
export function Equalizer({ color, level, className }: { color: string; level?: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <span aria-hidden className={cn("flex h-3 items-end gap-[2px]", className)}>
      {EQ_PEAKS.map((peak, index) => {
        if (level !== undefined) {
          return (
            <motion.span
              key={index}
              className="h-full w-[3px] origin-bottom rounded-full"
              style={{ background: color }}
              initial={false}
              animate={{ scaleY: 0.18 + Math.min(1, level * 1.25) * peak * 0.82 }}
              transition={{ type: "spring", stiffness: 700, damping: 32 }}
            />
          );
        }
        return (
          <motion.span
            key={index}
            className="h-full w-[3px] origin-bottom rounded-full"
            style={{ background: color }}
            initial={{ scaleY: 0.3 }}
            animate={reduceMotion ? { scaleY: peak * 0.75 } : { scaleY: [0.3, peak, 0.45, peak * 0.8, 0.3] }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.8 + index * 0.17, repeat: Infinity, ease: "easeInOut" }
            }
          />
        );
      })}
    </span>
  );
}

/** The "about to speak" dots from globals.css, in the participant's colour. */
export function ThinkingDots({ color, className }: { color: string; className?: string }) {
  return (
    <span aria-hidden className={cn("thinking-dots inline-flex items-center gap-[3px]", className)} style={{ color }}>
      <span className="size-1.5 rounded-full bg-current" />
      <span className="size-1.5 rounded-full bg-current" />
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}
