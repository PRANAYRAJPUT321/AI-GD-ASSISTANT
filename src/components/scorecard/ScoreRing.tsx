"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { EASE_OUT } from "./Reveal";

const RADIUS = 84;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** One tick per 10 points, drawn just outside the ring. */
const TICKS = Array.from({ length: 10 }, (_, index) => index);

/**
 * The overall score as a ring that fills from 0 while the number counts up (both driven by
 * one motion value, so no React re-render per frame). Static with reduced motion.
 */
export function ScoreRing({ score, color }: { score: number; color: string }) {
  const reduced = usePrefersReducedMotion();
  const target = Math.min(100, Math.max(0, Math.round(score)));
  const progress = useMotionValue(reduced ? target : 0);
  const dashOffset = useTransform(progress, (value) => CIRCUMFERENCE * (1 - value / 100));
  const shown = useTransform(progress, (value) => String(Math.round(value)));

  useEffect(() => {
    if (reduced) {
      progress.set(target);
      return;
    }
    const controls = animate(progress, target, { duration: 1.6, delay: 0.3, ease: EASE_OUT });
    return () => controls.stop();
  }, [progress, reduced, target]);

  return (
    <div className="relative size-44 shrink-0 sm:size-52">
      <svg viewBox="0 0 200 200" aria-hidden className="size-full -rotate-90">
        {TICKS.map((index) => {
          const angle = (index / TICKS.length) * 2 * Math.PI;
          return (
            <line
              key={index}
              x1={100 + 97 * Math.cos(angle)}
              y1={100 + 97 * Math.sin(angle)}
              x2={100 + 93.5 * Math.cos(angle)}
              y2={100 + 93.5 * Math.sin(angle)}
              stroke="var(--line)"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="var(--panel-2)" strokeWidth={STROKE} />
        <motion.circle
          cx="100"
          cy="100"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={{
            strokeDashoffset: dashOffset,
            filter: `drop-shadow(0 0 8px color-mix(in srgb, ${color} 40%, transparent))`,
          }}
          // A zero score draws nothing (a round cap would otherwise leave a dot).
          strokeOpacity={target === 0 ? 0 : 1}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="sr-only">Overall score: {target} out of 100</p>
        <motion.span aria-hidden className="text-5xl font-bold tracking-tight text-ink sm:text-6xl">
          {shown}
        </motion.span>
        <span aria-hidden className="text-sm font-semibold text-ink-2">
          out of 100
        </span>
      </div>
    </div>
  );
}
