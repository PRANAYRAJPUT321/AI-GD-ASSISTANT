"use client";

import { Check, Hand, Hourglass, SendHorizontal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, type Ref } from "react";
import { USER_COLOR } from "@/lib/personas";
import { cn } from "@/components/ui/cn";
import { ringStyle, tint } from "@/components/ui/style";
import { Equalizer } from "./bits";
import type { FloorControl } from "./model";

interface FloorButtonProps {
  control: Exclude<FloorControl, { kind: "none" }>;
  /** The candidate's 0..1 mic level while they hold the floor. */
  micLevel: number;
  /** micLevel is live (false without a meter: the halo breathes instead). */
  hasMicMeter: boolean;
  onAct(): void;
  buttonRef: Ref<HTMLButtonElement>;
}

/**
 * The big Jump in / Done pill. It stays one focusable element whatever its state, so keyboard
 * focus survives the label changing; when jumping in isn't allowed it is aria-disabled and the
 * reason shows under it. While the candidate speaks, a halo around it follows their voice.
 */
export function FloorButton({ control, micLevel, hasMicMeter, onAct, buttonRef }: FloorButtonProps) {
  const hintId = useId();
  const blocked = control.kind === "blocked";
  const holding = control.kind === "hold";
  const sending = holding && control.action === "send";
  const label = holding ? (sending ? "Send" : "Done") : "Jump in";
  const Icon = holding ? (sending ? SendHorizontal : Check) : Hand;
  const hint = control.kind === "blocked" ? control.reason : control.hint;

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative">
        <AnimatePresence>
          {holding && control.listening && <MicHalo key="halo" level={micLevel} live={hasMicMeter} />}
        </AnimatePresence>
        {control.kind === "jump" && control.urgent && (
          <span
            aria-hidden
            className="speaking-ring pointer-events-none absolute inset-0 rounded-full"
            style={ringStyle("var(--accent)")}
          />
        )}
        <button
          ref={buttonRef}
          type="button"
          aria-disabled={blocked || undefined}
          aria-describedby={hintId}
          onClick={blocked ? undefined : onAct}
          className={cn(
            "relative inline-flex h-16 min-w-[13.5rem] select-none items-center justify-center gap-3 rounded-full px-7 text-lg font-bold",
            "outline-none transition-[background-color,color,border-color,box-shadow,transform] duration-200",
            "focus-visible:ring-4 focus-visible:ring-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "motion-reduce:transition-none",
            !blocked && "active:scale-[0.97] motion-reduce:active:scale-100",
            control.kind === "jump" && "bg-accent text-accent-ink shadow-card hover:bg-accent/90",
            holding && "border-2 bg-panel text-ink shadow-card hover:bg-panel-2",
            blocked && "cursor-not-allowed border border-line bg-panel-2 text-ink-2",
          )}
          style={holding ? { borderColor: USER_COLOR } : undefined}
        >
          <Icon aria-hidden className="size-6 shrink-0" />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
          {holding && control.listening && (
            <Equalizer color={USER_COLOR} level={hasMicMeter ? micLevel : undefined} className="h-4" />
          )}
          {!blocked && !sending && (
            <kbd
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-xs font-semibold pointer-coarse:hidden",
                control.kind === "jump"
                  ? "border-accent-ink/35 bg-accent-ink/15 text-accent-ink"
                  : "border-line bg-panel-2 text-ink-2",
              )}
            >
              Space
            </kbd>
          )}
        </button>
      </div>
      <p id={hintId} className="flex min-h-10 max-w-md items-start justify-center gap-1.5 text-balance text-center text-sm text-ink-2">
        {blocked && <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0" />}
        <span>{hint}</span>
      </p>
    </div>
  );
}

/**
 * Audio-reactive ring around the pill while the candidate speaks: it swells with their mic
 * level. Without a live level (no meter) it breathes gently so "we're listening" still shows.
 */
function MicHalo({ level, live }: { level: number; live: boolean }) {
  const reduceMotion = useReducedMotion();
  const boost = Math.min(1, level * 1.3);
  const animate = live
    ? { opacity: 0.55 + boost * 0.45, scale: 1 + boost * 0.16 }
    : reduceMotion
      ? { opacity: 0.7, scale: 1.04 }
      : { opacity: [0.45, 0.85, 0.45], scale: [1.02, 1.09, 1.02] };
  const transition = live
    ? { type: "spring" as const, stiffness: 520, damping: 26 }
    : reduceMotion
      ? { duration: 0 }
      : { duration: 1.8, repeat: Infinity, ease: "easeInOut" as const };

  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0, scale: 0.9 }}
      animate={animate}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={transition}
      className="pointer-events-none absolute -inset-2.5 rounded-full border-2"
      style={{ borderColor: tint(USER_COLOR, 70), background: tint(USER_COLOR, 16) }}
    />
  );
}
