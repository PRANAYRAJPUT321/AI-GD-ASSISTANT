"use client";

import { Quote, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { DEFAULT_TIMINGS } from "@/lib/engine";
import { USER_COLOR } from "@/lib/personas";
import { tint } from "@/components/ui/style";
import { formatClock } from "./model";

/** The cap on the candidate's closing summary, for the countdown bar. */
const SUMMARY_SECONDS = DEFAULT_TIMINGS.summaryCapMs / 1000;
/** Under this many seconds the countdown warns (in words too, not only in colour). */
const WRAP_UP_SECONDS = 15;

/** The candidate's closing-summary turn: what to say and how long they have. */
export function SummaryPrompt({ prompt, secondsLeft }: { prompt: string; secondsLeft: number | null }) {
  const left = Math.max(0, secondsLeft ?? SUMMARY_SECONDS);
  const fraction = Math.min(1, left / SUMMARY_SECONDS);
  const hurry = left <= WRAP_UP_SECONDS;

  return (
    <motion.section
      aria-labelledby="summary-prompt-title"
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="rounded-2xl border-2 p-4 shadow-card sm:p-5"
      style={{ borderColor: USER_COLOR, background: `linear-gradient(${tint(USER_COLOR, 9)}, ${tint(USER_COLOR, 9)}), var(--panel)` }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl text-ink"
          style={{ background: tint(USER_COLOR, 22) }}
        >
          <Quote className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">Your closing summary</p>
          <h2 id="summary-prompt-title" className="mt-0.5 text-lg font-semibold leading-snug text-ink sm:text-xl">
            {prompt}
          </h2>
        </div>
        <div className="shrink-0 text-right">
          <span role="timer" className="block font-mono text-2xl font-semibold tabular-nums text-ink">
            {formatClock(left)}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">left</span>
        </div>
      </div>
      <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div
          className="h-full origin-left rounded-full transition-[transform,background-color] duration-1000 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${fraction})`, background: hurry ? "var(--warn)" : USER_COLOR }}
        />
      </div>
      {hurry && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          <TriangleAlert aria-hidden className="size-4 text-warn" />
          Wrap up now: give your conclusion.
        </p>
      )}
    </motion.section>
  );
}
