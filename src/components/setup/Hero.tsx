"use client";

import { Hand, ListChecks, NotebookPen, Quote, Trophy, Users, type LucideIcon } from "lucide-react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useState, type PointerEvent } from "react";
import { MODERATOR, USER_COLOR, type Cast } from "@/lib/personas";
import type { SpeakerId } from "@/lib/types";
import { cn } from "@/components/ui/cn";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { ringStyle, tint } from "@/components/ui/style";
import { useTilt } from "@/components/ui/tilt";

const STEPS: readonly { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: ListChecks, title: "Choose a topic", detail: "Business, current affairs or abstract" },
  { icon: NotebookPen, title: "Prep for 2 min", detail: "Jot your angles on a notepad" },
  { icon: Users, title: "Discuss with 5 AIs", detail: "They speak aloud and react to you" },
  { icon: Hand, title: "Jump in", detail: "Press Space to take the floor" },
  { icon: Quote, title: "Summarise", detail: "Close the GD in 90 seconds" },
  { icon: Trophy, title: "Get your scorecard", detail: "Scores, airtime and transcript" },
];

/**
 * Product intro: name, value proposition, a 3D round table and the six steps. Everything here
 * is server-rendered visible (no fade-in from opacity 0), so the first paint is instant; the
 * motion starts once the page is interactive.
 */
export function Hero({ cast, userName }: { cast: Cast; userName: string }) {
  return (
    <section aria-labelledby="hero-title" className="flex flex-col gap-8">
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-8">
        <div className="flex flex-col gap-4">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 text-xs font-semibold text-ink-2 shadow-card backdrop-blur">
            <span className="relative flex size-2">
              <motion.span
                className="absolute inline-flex size-full rounded-full bg-good motion-reduce:hidden"
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 1.6, ease: "easeOut" }}
              />
              <span className="relative inline-flex size-2 rounded-full bg-good" />
            </span>
            Group discussion practice, out loud
          </p>
          <h1 id="hero-title" className="text-5xl font-extrabold tracking-tight text-ink sm:text-6xl">
            GD{" "}
            <span className="text-shimmer bg-linear-to-r from-accent via-[#e5484d] to-accent bg-clip-text text-transparent forced-colors:bg-none forced-colors:text-[CanvasText]">
              Arena
            </span>
          </h1>
          <p className="max-w-xl text-lg text-ink-2">
            Practise a real group discussion against five AI participants who talk over you, drift off-topic and react
            to what you actually say. Then get a scorecard and the full transcript.
          </p>
        </div>
        <RoundTable3D cast={cast} userName={userName} />
      </div>

      <ol aria-label="How it works" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STEPS.map((step, index) => (
          <StepCard key={step.title} step={step} index={index} />
        ))}
      </ol>
    </section>
  );
}

function StepCard({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  const tilt = useTilt(8);
  return (
    <motion.li
      {...tilt.bind}
      className="group relative flex items-start gap-3 rounded-xl border border-line bg-panel/85 px-3 py-2.5 shadow-card transition-colors hover:border-accent/50"
    >
      {/* One pass of pops along the steps reads as "this is the flow". */}
      <motion.span
        animate={{ scale: [1, 1.22, 1], rotate: [0, -8, 0] }}
        transition={{ delay: 0.35 + index * 0.16, duration: 0.5, ease: "easeOut" }}
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-2 text-accent-ink shadow-glow"
      >
        <step.icon aria-hidden className="size-4" />
      </motion.span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight text-ink">{step.title}</span>
        <span className="mt-0.5 hidden text-xs leading-snug text-ink-2 sm:block">{step.detail}</span>
      </span>
      {tilt.glare}
    </motion.li>
  );
}

/** Who "speaks" in the preview, in order; it ends on the candidate. */
const PREVIEW_SEQUENCE: readonly SpeakerId[] = ["moderator", "dominator", "data", "agreer", "drifter", "smart", "user"];
const PREVIEW_STEP_MS = 900;
/** Seats clockwise from the head of the table (the far side), where the moderator sits. */
const SEATS: readonly SpeakerId[] = ["moderator", "dominator", "data", "agreer", "user", "drifter", "smart"];
/** How far the table leans back from the viewer, in degrees. */
const TABLE_TILT = 52;
/** Seat distance from the centre of the table plane, in % of its size. */
const SEAT_RADIUS = 46;
/** Layers under the table top that give it a visible edge (px below the surface). */
const TABLE_EDGE = [3, 6, 9, 12] as const;

function seatPoint(index: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / SEATS.length;
  return { x: 50 + SEAT_RADIUS * Math.cos(angle), y: 50 + SEAT_RADIUS * Math.sin(angle) };
}

/**
 * Decorative 3D round table: the table leans back in perspective and the participants stand
 * around it like cut-outs that always face you. It sways gently and, with a mouse, turns to
 * follow the pointer. The floor passes once around the room and lands on the candidate.
 * Static with reduced motion. Names follow the live cast.
 */
function RoundTable3D({ cast, userName }: { cast: Cast; userName: string }) {
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

  // The table's orientation: a slow idle sway plus whatever the pointer adds.
  const sway = useMotionValue(0);
  const steerSpin = useSpring(0, { stiffness: 70, damping: 16 });
  const steerTilt = useSpring(0, { stiffness: 70, damping: 16 });
  const spin = useTransform(() => sway.get() + steerSpin.get());
  const tilt = useTransform(() => TABLE_TILT + steerTilt.get());
  // Undoing the table's rotation (in reverse order) keeps each figure facing the viewer.
  const counterSpin = useTransform(spin, (value) => -value);
  const counterTilt = useTransform(tilt, (value) => -value);
  const standUp = useMotionTemplate`rotateZ(${counterSpin}deg) rotateX(${counterTilt}deg)`;
  const floatAbove = useMotionTemplate`translateZ(46px) rotateZ(${counterSpin}deg) rotateX(${counterTilt}deg)`;

  useEffect(() => {
    if (reduceMotion) return;
    const controls = animate(sway, [-7, 7], {
      duration: 7,
      repeat: Infinity,
      repeatType: "mirror",
      ease: "easeInOut",
    });
    return () => controls.stop();
  }, [reduceMotion, sway]);

  function steer(event: PointerEvent<HTMLDivElement>) {
    if (reduceMotion || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    steerSpin.set(((event.clientX - rect.left) / rect.width - 0.5) * 26);
    steerTilt.set(((event.clientY - rect.top) / rect.height - 0.5) * -14);
  }

  function release() {
    steerSpin.set(0);
    steerTilt.set(0);
  }

  const speaking = PREVIEW_SEQUENCE[reduceMotion ? PREVIEW_SEQUENCE.length - 1 : step];
  const youName = userName.trim().split(/\s+/)[0] || "You";

  function seatInfo(id: SpeakerId): { name: string; emoji: string; color: string } {
    if (id === "moderator") return { name: MODERATOR.name, emoji: MODERATOR.emoji, color: MODERATOR.color };
    if (id === "user") return { name: youName, emoji: "🎓", color: USER_COLOR };
    return { name: cast[id].name, emoji: cast[id].emoji, color: cast[id].color };
  }

  const speaker = seatInfo(speaking);
  // Once the floor lands on the candidate the dots stop.
  const settled = speaking === "user";
  const spot = seatPoint(SEATS.indexOf(speaking));

  return (
    <div
      aria-hidden
      onPointerMove={steer}
      onPointerLeave={release}
      className="relative mx-auto aspect-[5/4] w-full max-w-[21rem] select-none perspective-[1000px] sm:max-w-[26rem]"
    >
      {/* The table plane: a square (so the table is round) centred in the wider box. */}
      <motion.div
        className="absolute left-[8%] top-1/2 aspect-square w-[84%] -translate-y-1/2 transform-3d"
        style={{ rotateX: tilt, rotateZ: spin }}
      >
        {/* The table: a stack of discs under the top gives it a solid edge. */}
        {TABLE_EDGE.map((depth, index) => (
          <div
            key={depth}
            className="absolute inset-[20%] rounded-full"
            style={{
              transform: `translateZ(-${depth}px)`,
              background: `color-mix(in srgb, var(--accent) ${62 - index * 7}%, black)`,
            }}
          />
        ))}
        <div
          className="absolute inset-[20%] rounded-full border border-white/20"
          style={{
            background:
              "radial-gradient(circle at 34% 28%, color-mix(in srgb, white 55%, transparent), transparent 42%)," +
              "radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 22%, var(--panel)), color-mix(in srgb, var(--accent-2) 26%, var(--panel-2)))",
            boxShadow: "inset 0 0 30px rgb(0 0 0 / 0.12), 0 30px 50px -20px rgb(0 0 0 / 0.45)",
          }}
        />
        {/* A spotlight on the table in front of whoever is speaking. */}
        <motion.div
          className="absolute size-[34%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          animate={{ left: `${50 + (spot.x - 50) * 0.55}%`, top: `${50 + (spot.y - 50) * 0.55}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
          style={{ background: `radial-gradient(closest-side, ${tint(speaker.color, 45)}, transparent)` }}
        />

        {SEATS.map((id, index) => {
          const seat = seatInfo(id);
          const active = id === speaking;
          const point = seatPoint(index);
          return (
            <div key={id} className="absolute transform-3d" style={{ left: `${point.x}%`, top: `${point.y}%` }}>
              {/* The figure's shadow, flat on the table. */}
              <span className="absolute size-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25 blur-[5px]" />
              <motion.div
                className="absolute bottom-0 left-0 flex w-[4.75rem] -translate-x-1/2 origin-bottom flex-col items-center gap-1"
                style={{ transform: standUp }}
              >
                <motion.span
                  animate={{ scale: active ? 1.16 : 1, y: active ? -4 : 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className={cn(
                    "grid size-11 place-items-center rounded-full border-2 text-xl shadow-card sm:size-12",
                    active && !settled && "speaking-ring",
                  )}
                  style={ringStyle(seat.color, {
                    background: `radial-gradient(circle at 35% 30%, ${tint(seat.color, active ? 45 : 30)}, color-mix(in srgb, ${seat.color} 14%, var(--panel)))`,
                    borderColor: active ? seat.color : "color-mix(in srgb, white 35%, transparent)",
                  })}
                >
                  {seat.emoji}
                </motion.span>
                <span
                  className={cn(
                    "max-w-full truncate rounded-full px-1.5 text-[11px] font-semibold",
                    active ? "bg-panel text-ink shadow-card" : "text-ink-2",
                  )}
                >
                  {seat.name}
                </span>
              </motion.div>
            </div>
          );
        })}

        {/* Who has the floor, floating over the middle of the table. */}
        <div className="absolute left-1/2 top-1/2 transform-3d">
          <motion.div
            className="absolute bottom-0 left-0 flex -translate-x-1/2 origin-bottom flex-col items-center"
            style={{ transform: floatAbove }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={speaking}
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.9 }}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-panel/90 px-2.5 py-1 text-[11px] font-semibold text-ink shadow-card backdrop-blur"
              >
                {settled ? "Your turn. Jump in!" : `${speaker.name} is speaking`}
                {!settled && (
                  <span className="thinking-dots flex gap-0.5" style={{ color: speaker.color }}>
                    <span className="size-1 rounded-full bg-current" />
                    <span className="size-1 rounded-full bg-current" />
                    <span className="size-1 rounded-full bg-current" />
                  </span>
                )}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
