"use client";

import { Hand, Headphones, Keyboard, Play, Users, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { Cast } from "@/lib/personas";
import type { InputMode, Topic } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Card";
import { tint } from "@/components/ui/style";
import { SEAT_ORDER, seatInfo } from "./model";

interface StartOverlayProps {
  topic: Topic;
  cast: Cast;
  minutes: number;
  inputMode: InputMode;
  onStart(): void;
}

/** The six people in the discussion (the moderator chairs it). */
const PARTICIPANT_SEATS = SEAT_ORDER.filter((id) => id !== "moderator");

/**
 * "Take your seat": shown over the room until the candidate starts the GD. Browsers (iOS
 * Safari above all) only allow the first speech inside a user gesture, and the room may have
 * opened from the prep timer, so the moderator starts speaking from this button's click. It
 * covers the room (not the page), so it is absolutely positioned rather than fixed and needs
 * no portal; the button is autofocused so Enter or Space starts the GD.
 */
export function StartOverlay({ topic, cast, minutes, inputMode, onStart }: StartOverlayProps) {
  const tips: readonly { icon: LucideIcon; text: string }[] = [
    inputMode === "text"
      ? { icon: Keyboard, text: "You'll type your turns: press Jump in (or Space), type your point, then Enter." }
      : { icon: Headphones, text: "Wear headphones, so your mic hears you and not the other voices." },
    { icon: Hand, text: "Press Space or Jump in to speak. Cutting in is allowed." },
    { icon: Users, text: "If you wait, others take the space. Nobody waits for you." },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="absolute inset-0 z-30 flex justify-center rounded-3xl bg-bg/75 pt-4 backdrop-blur-[6px] sm:pt-8"
    >
      <motion.section
        aria-labelledby="take-your-seat-title"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="h-fit w-full max-w-xl rounded-3xl border border-line bg-panel p-5 text-center shadow-card sm:p-7"
      >
        <Eyebrow>Take your seat · {minutes}-minute GD</Eyebrow>
        <h2 id="take-your-seat-title" className="mt-2 text-balance text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {topic.title}
        </h2>
        {topic.hint && <p className="mt-1 text-sm text-ink-2 sm:text-base">{topic.hint}</p>}

        <ul aria-label="At the table" className="mt-5 flex flex-wrap justify-center gap-x-3 gap-y-3">
          {PARTICIPANT_SEATS.map((id, index) => {
            const seat = seatInfo(id, cast);
            return (
              <motion.li
                key={id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + index * 0.06, type: "spring", stiffness: 380, damping: 24 }}
                className="flex w-16 flex-col items-center gap-1"
              >
                <span
                  aria-hidden
                  className="grid size-12 place-items-center rounded-full border-2 text-xl"
                  style={{ background: tint(seat.color, 16), borderColor: id === "user" ? seat.color : "transparent" }}
                >
                  {seat.emoji}
                </span>
                <span className="max-w-full truncate text-xs font-semibold text-ink">{seat.name}</span>
              </motion.li>
            );
          })}
        </ul>

        <ul className="mx-auto mt-5 flex max-w-md flex-col gap-2 text-left">
          {tips.map((tip) => (
            <li key={tip.text} className="flex items-start gap-2.5 text-sm leading-snug text-ink-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <tip.icon aria-hidden className="size-3.5" />
              </span>
              <span className="pt-1">{tip.text}</span>
            </li>
          ))}
        </ul>

        <Button
          variant="primary"
          size="lg"
          autoFocus
          onClick={onStart}
          className="mt-6 w-full sm:w-auto sm:min-w-72"
          icon={<Play aria-hidden className="size-5" />}
        >
          Start the discussion
        </Button>
        <p className="mt-2 text-xs text-ink-2">The moderator introduces the topic, then the floor is open.</p>
      </motion.section>
    </motion.div>
  );
}
