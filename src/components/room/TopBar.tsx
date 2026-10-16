"use client";

import { Flag, LogOut, TimerOff } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { EngineState, Topic } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { clockMilestone, clockTone, formatClock, phaseLabel, timeLeftMs, type ClockTone } from "./model";

interface TopBarProps {
  topic: Topic;
  state: EngineState;
  onEnd(): void;
  onLeave(): void;
}

/** Topic, phase, the discussion countdown and the End & score / Leave actions. */
export function TopBar({ topic, state, onEnd, onLeave }: TopBarProps) {
  const live = state.status === "intro" || state.status === "discussion" || state.status === "closing";
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-panel px-4 py-3 shadow-card sm:px-5">
      <div className="min-w-0 flex-1 basis-56">
        <PhaseBadge state={state} />
        <h1 className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-ink sm:text-lg">{topic.title}</h1>
      </div>
      <Countdown state={state} />
      <div className="ml-auto flex items-center gap-2">
        {live && (
          <Button size="sm" variant="secondary" icon={<Flag aria-hidden className="size-4" />} onClick={onEnd}>
            End &amp; score
          </Button>
        )}
        {state.status !== "done" && (
          <Button size="sm" variant="ghost" icon={<LogOut aria-hidden className="size-4" />} onClick={onLeave}>
            Leave
          </Button>
        )}
      </div>
    </header>
  );
}

function PhaseBadge({ state }: { state: EngineState }) {
  const reduceMotion = useReducedMotion();
  const live = state.status === "intro" || state.status === "discussion" || state.status === "closing";
  return (
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
      <span className="relative flex size-2">
        {live && !reduceMotion && (
          <motion.span
            aria-hidden
            className="absolute inline-flex size-full rounded-full bg-bad"
            animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span aria-hidden className={cn("relative inline-flex size-2 rounded-full", live ? "bg-bad" : "bg-ink-3")} />
      </span>
      {live && <span className="text-ink">Live</span>}
      <span>{phaseLabel(state)}</span>
    </p>
  );
}

const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const TONE_STROKE: Record<ClockTone, string> = {
  calm: "var(--accent)",
  warn: "var(--warn)",
  danger: "var(--bad)",
};

/** Words under the clock, so the last minutes are not signalled by colour alone. */
function clockCaption(state: EngineState, tone: ClockTone, msLeft: number): string {
  if (state.discussionStartMs === null) return state.status === "error" ? "not started" : "starts after intro";
  if (msLeft <= 0) return "time's up";
  if (tone === "danger") return "final seconds";
  if (tone === "warn") return "final 2 min";
  return "remaining";
}

/**
 * The discussion clock: a ring that empties as time passes, amber in the last two minutes
 * and red in the last 30 seconds (with the words changing too).
 */
function Countdown({ state }: { state: EngineState }) {
  const msLeft = timeLeftMs(state);
  const tone = clockTone(msLeft);
  const running = state.discussionStartMs !== null && msLeft > 0;
  const fraction = state.discussionMs > 0 ? msLeft / state.discussionMs : 0;
  const stroke = running ? TONE_STROKE[tone] : "var(--ink-3)";

  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 48 48" aria-hidden className="size-12 -rotate-90">
        <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke="var(--panel-2)" strokeWidth="5" />
        <circle
          cx="24"
          cy="24"
          r={RING_RADIUS}
          fill="none"
          stroke={stroke}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
          strokeOpacity={msLeft > 0 ? 1 : 0}
          className="transition-[stroke-dashoffset,stroke] duration-300 ease-linear motion-reduce:transition-none"
        />
      </svg>
      <div className="min-w-[5.5rem]">
        <motion.span
          role="timer"
          // In the last 30 seconds every second lands with a small beat.
          key={running && tone === "danger" ? Math.ceil(msLeft / 1000) : "steady"}
          initial={running && tone === "danger" ? { scale: 1.15 } : false}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18 }}
          className="block origin-left font-mono text-2xl font-semibold leading-none tabular-nums text-ink"
        >
          {formatClock(Math.ceil(msLeft / 1000))}
        </motion.span>
        <span
          className={cn(
            "mt-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
            running && tone !== "calm" ? "text-ink" : "text-ink-2",
          )}
        >
          {state.discussionStartMs !== null && msLeft <= 0 && <TimerOff aria-hidden className="size-3" />}
          {running && tone !== "calm" && (
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: TONE_STROKE[tone] }} />
          )}
          {clockCaption(state, tone, msLeft)}
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {clockMilestone(state)}
      </p>
    </div>
  );
}
