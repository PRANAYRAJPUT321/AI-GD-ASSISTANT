"use client";

import { Hand, ListChecks, NotebookPen, Quote, Trophy, Users, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { MODERATOR, USER_COLOR, type Cast } from "@/lib/personas";
import { PERSONA_IDS } from "@/lib/types";
import type { SpeakerId } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { ringStyle, tint } from "@/components/ui/style";

const STEPS: readonly { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: ListChecks, title: "Choose a topic", detail: "Business, current affairs or abstract" },
  { icon: NotebookPen, title: "Prep for 2 min", detail: "Jot your angles on a notepad" },
  { icon: Users, title: "Discuss with 5 AIs", detail: "They speak aloud and react to you" },
  { icon: Hand, title: "Jump in", detail: "Press Space to take the floor" },
  { icon: Quote, title: "Summarise", detail: "Close the GD in 90 seconds" },
  { icon: Trophy, title: "Get your scorecard", detail: "Scores, airtime and transcript" },
];

/**
 * Product intro: name, value proposition, a live round-table preview and the six steps.
 * Everything here is server-rendered visible (no fade-in from opacity 0), so the first paint
 * is instant; the motion starts once the page is interactive.
 */
export function Hero({ cast, userName }: { cast: Cast; userName: string }) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate flex flex-col gap-8">
      {/* A soft wash of colour behind the intro (decorative, static). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-16 -top-24 -z-10 h-[28rem] mask-[radial-gradient(ellipse_at_top,black_35%,transparent_75%)] print:hidden"
        style={{
          background:
            "radial-gradient(38% 48% at 18% 32%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)," +
            "radial-gradient(32% 42% at 82% 22%, color-mix(in srgb, #e5484d 15%, transparent), transparent 70%)," +
            "radial-gradient(30% 40% at 58% 78%, color-mix(in srgb, #14b8a6 12%, transparent), transparent 70%)",
        }}
      />
      <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-ink-2 shadow-card">
            <span className="relative flex size-2">
              {/* Pings a few times on load, then rests: nothing on the page moves indefinitely. */}
              <motion.span
                className="absolute inline-flex size-full rounded-full bg-good motion-reduce:hidden"
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{ duration: 1.2, repeat: 3, ease: "easeOut" }}
              />
              <span className="relative inline-flex size-2 rounded-full bg-good" />
            </span>
            Group discussion practice, out loud
          </p>
          <h1 id="hero-title" className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            GD{" "}
            <span className="bg-linear-to-r from-accent to-[#e5484d] bg-clip-text text-transparent forced-colors:bg-none forced-colors:text-[CanvasText]">
              Arena
            </span>
          </h1>
          <p className="max-w-xl text-lg text-ink-2">
            Practise a real group discussion against five AI participants who talk over you, drift off-topic and react
            to what you actually say. Then get a scorecard and the full transcript.
          </p>
          <WaitingRoom cast={cast} />
        </div>
        <RoundTablePreview cast={cast} userName={userName} />
      </div>

      <ol aria-label="How it works" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="group relative flex items-start gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 transition-colors hover:border-accent/50"
          >
            {/* One pass of pops along the steps reads as "this is the flow". */}
            <motion.span
              animate={{ scale: [1, 1.22, 1], rotate: [0, -8, 0] }}
              transition={{ delay: 0.35 + index * 0.16, duration: 0.5, ease: "easeOut" }}
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
            >
              <step.icon aria-hidden className="size-4" />
            </motion.span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight text-ink">{step.title}</span>
              <span className="mt-0.5 hidden text-xs leading-snug text-ink-2 sm:block">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Phones only (the round table needs more room): the five participants, waiting for you. */
function WaitingRoom({ cast }: { cast: Cast }) {
  const names = PERSONA_IDS.map((id) => cast[id].name);
  return (
    <div className="flex items-center gap-3 sm:hidden">
      <div aria-hidden className="flex -space-x-2">
        {PERSONA_IDS.map((id, index) => (
          <motion.span
            key={id}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.2 + index * 0.08 }}
            className="grid size-9 place-items-center rounded-full border-2 border-bg text-base"
            style={{ background: `color-mix(in srgb, ${cast[id].color} 22%, var(--panel))` }}
          >
            {cast[id].emoji}
          </motion.span>
        ))}
      </div>
      <p className="text-sm font-medium text-ink-2">
        {names[0]}, {names[1]} and 3 others are waiting for you
      </p>
    </div>
  );
}

/** Who "speaks" in the preview, in order; it ends on the candidate. */
const PREVIEW_SEQUENCE: readonly SpeakerId[] = ["moderator", "dominator", "data", "agreer", "drifter", "smart", "user"];
const PREVIEW_STEP_MS = 850;
/** Seats clockwise from the head of the table, where the moderator sits. */
const SEATS: readonly SpeakerId[] = ["moderator", "dominator", "data", "agreer", "user", "drifter", "smart"];

/**
 * Decorative round table: the floor passes once around the room (about six seconds, so it
 * never loops forever) and lands on the candidate. Names follow the live cast.
 */
function RoundTablePreview({ cast, userName }: { cast: Cast; userName: string }) {
  const reduceMotion = usePrefersReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setStep(current);
      if (current >= PREVIEW_SEQUENCE.length - 1) clearInterval(timer);
    }, PREVIEW_STEP_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const speaking = PREVIEW_SEQUENCE[reduceMotion ? PREVIEW_SEQUENCE.length - 1 : step];
  const youName = userName.trim().split(/\s+/)[0] || "You";

  function seatInfo(id: SpeakerId): { name: string; emoji: string; color: string } {
    if (id === "moderator") return { name: MODERATOR.name, emoji: MODERATOR.emoji, color: MODERATOR.color };
    if (id === "user") return { name: youName, emoji: "🎓", color: USER_COLOR };
    return { name: cast[id].name, emoji: cast[id].emoji, color: cast[id].color };
  }

  const speaker = seatInfo(speaking);
  // Once the floor lands on the candidate the preview rests (no infinite pulsing).
  const settled = speaking === "user";

  return (
    <div aria-hidden className="relative mx-auto hidden aspect-[6/5] w-full max-w-[22rem] select-none sm:block">
      <div className="absolute inset-[24%] rounded-[50%] border border-line bg-panel-2 shadow-[inset_0_2px_12px_rgb(0_0_0/0.06)]">
        <div className="flex h-full flex-col items-center justify-center px-4 text-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={speaking}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-xs font-semibold text-ink-2"
            >
              {settled ? "Your turn. Jump in!" : `${speaker.name} is speaking`}
            </motion.span>
          </AnimatePresence>
          {!settled && (
            <span className="thinking-dots mt-1 flex gap-1" style={{ color: speaker.color }}>
              <span className="size-1.5 rounded-full bg-current" />
              <span className="size-1.5 rounded-full bg-current" />
              <span className="size-1.5 rounded-full bg-current" />
            </span>
          )}
        </div>
      </div>
      {SEATS.map((id, index) => {
        // Evenly spaced around an ellipse, starting at the top (the head of the table).
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / SEATS.length;
        const seat = seatInfo(id);
        const active = id === speaking;
        return (
          <div
            key={id}
            className="absolute flex w-[4.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            style={{ left: `${50 + 37 * Math.cos(angle)}%`, top: `${50 + 38 * Math.sin(angle)}%` }}
          >
            <motion.span
              animate={{ scale: active ? 1.12 : 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className={cn(
                "grid size-12 place-items-center rounded-full border-2 text-xl",
                active && !settled && "speaking-ring",
                !active && "opacity-80",
              )}
              style={ringStyle(seat.color, {
                background: tint(seat.color, active ? 26 : 14),
                borderColor: active ? seat.color : "transparent",
              })}
            >
              {seat.emoji}
            </motion.span>
            <span className={cn("max-w-full truncate text-[11px] font-semibold", active ? "text-ink" : "text-ink-2")}>
              {seat.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
