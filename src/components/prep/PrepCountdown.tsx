"use client";

import { motion } from "motion/react";
import { useEffect, useEffectEvent, useState } from "react";
import { cn } from "@/components/ui/cn";

const RADIUS = 88;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Re-render cadence. The ring's CSS transition interpolates between ticks. */
const TICK_MS = 200;
/** Under this many seconds the ring and clock turn amber. */
const WARN_SECONDS = 30;
const TICK_MARKS = Array.from({ length: 24 }, (_, index) => index);

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Spoken milestones for screen readers (the clock itself is not announced every second). */
function milestone(secondsLeft: number): string {
  if (secondsLeft === 0) return "Prep time is up.";
  if (secondsLeft <= 10) return "10 seconds of prep left.";
  if (secondsLeft <= 30) return "30 seconds of prep left.";
  if (secondsLeft <= 60) return "1 minute of prep left.";
  return "";
}

/**
 * Large countdown ring. Time is derived from a monotonic deadline (not by counting ticks), so
 * it stays exact even when the browser throttles timers in a background tab; it re-syncs the
 * moment the tab is visible again. Calls `onElapsed` once when it reaches zero.
 */
export function PrepCountdown({ totalSeconds, onElapsed }: { totalSeconds: number; onElapsed(): void }) {
  const totalMs = totalSeconds * 1000;
  const [msLeft, setMsLeft] = useState(totalMs);
  const elapsed = useEffectEvent(onElapsed);

  useEffect(() => {
    const deadline = performance.now() + totalMs;
    let finished = false;
    const tick = () => {
      if (finished) return;
      const left = Math.max(0, deadline - performance.now());
      setMsLeft(left);
      if (left === 0) {
        finished = true;
        window.clearInterval(timer);
        elapsed();
      }
    };
    const timer = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      finished = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [totalMs]);

  const secondsLeft = Math.ceil(msLeft / 1000);
  const fraction = msLeft / totalMs;
  const warn = secondsLeft <= WARN_SECONDS;
  const finalCount = secondsLeft <= 10 && secondsLeft > 0;
  const stroke = warn ? "var(--warn)" : "var(--accent)";

  return (
    <div className="relative size-52 sm:size-60">
      <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
        {TICK_MARKS.map((index) => {
          const angle = (index / TICK_MARKS.length) * 2 * Math.PI;
          return (
            <line
              key={index}
              x1={100 + 99 * Math.cos(angle)}
              y1={100 + 99 * Math.sin(angle)}
              x2={100 + (index % 6 === 0 ? 94 : 96) * Math.cos(angle)}
              y2={100 + (index % 6 === 0 ? 94 : 96) * Math.sin(angle)}
              stroke="var(--line)"
              strokeWidth={index % 6 === 0 ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="var(--panel-2)" strokeWidth="11" />
        <circle
          cx="100"
          cy="100"
          r={RADIUS}
          fill="none"
          stroke={stroke}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          strokeOpacity={msLeft > 0 ? 1 : 0}
          className="transition-[stroke-dashoffset,stroke] duration-200 ease-linear motion-reduce:transition-none"
          style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${stroke} 45%, transparent))` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          role="timer"
          // Only the last ten seconds get a heartbeat; before that the digits just update.
          key={finalCount ? secondsLeft : "steady"}
          initial={finalCount ? { scale: 1.18, opacity: 0.6 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 18 }}
          className={cn(
            "block font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl",
            warn ? "text-warn" : "text-ink",
          )}
        >
          {formatClock(secondsLeft)}
        </motion.span>
        <span className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">prep time</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {milestone(secondsLeft)}
      </p>
    </div>
  );
}
