"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { castFor, USER_COLOR, type Cast, type Persona } from "@/lib/personas";
import { PERSONA_IDS } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { ringStyle, tint } from "@/components/ui/style";

/** The default cast, to spot personas renamed because the candidate shares their name. */
const DEFAULT_CAST = castFor("");

/** "Meet the room": the five AI participants (live from castFor(name)) plus the candidate. */
export function MeetTheRoom({ cast, userName }: { cast: Cast; userName: string }) {
  const id = useId();
  const firstName = userName.trim().split(/\s+/)[0] ?? "";

  return (
    <Card as="section" aria-labelledby={`${id}-title`} className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
          Meet the room
        </h2>
        <p className="text-sm text-ink-2">
          Five AI participants, each a classic GD type. They speak out loud and react to what you actually say.
        </p>
      </div>
      <ul className="grid gap-2.5 min-[30rem]:grid-cols-2 xl:grid-cols-3">
        {PERSONA_IDS.map((personaId, index) => (
          <PersonaCard
            key={personaId}
            persona={cast[personaId]}
            index={index}
            renamedFor={cast[personaId].name !== DEFAULT_CAST[personaId].name ? firstName : null}
          />
        ))}
        <CandidateCard name={userName.trim()} index={PERSONA_IDS.length} />
      </ul>
    </Card>
  );
}

/** Swaps a name with a small roll, so live edits are visible. */
function LiveName({ name }: { name: string }) {
  return (
    <span className="relative inline-flex max-w-full shrink-0 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={name}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -12, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="truncate"
        >
          {name}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function RoomCard({
  color,
  emoji,
  index,
  children,
}: {
  color: string;
  emoji: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <li
      className="group relative flex gap-3 overflow-hidden rounded-xl border border-line bg-panel p-3 pl-4 transition-shadow hover:shadow-card"
      style={ringStyle(color)}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      {/* Avatars pop in turn as the room scrolls into view (cards themselves render visible). */}
      <motion.span
        aria-hidden
        whileInView={{ scale: [1, 1.2, 1] }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ delay: index * 0.09, duration: 0.45, ease: "easeOut" }}
        className="grid size-11 shrink-0 place-items-center rounded-full text-xl group-hover:[animation:speak-pulse_1.4s_ease-out_infinite] motion-reduce:group-hover:[animation:none]"
        style={{ background: tint(color, 18) }}
      >
        {emoji}
      </motion.span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function PersonaCard({ persona, index, renamedFor }: { persona: Persona; index: number; renamedFor: string | null }) {
  return (
    <RoomCard color={persona.color} emoji={persona.emoji} index={index}>
      <p className="flex flex-wrap items-baseline gap-x-2 font-semibold text-ink">
        <LiveName name={persona.name} />
        <span className="text-xs font-medium text-ink-2">{persona.role}</span>
      </p>
      <p className="mt-0.5 text-sm leading-snug text-ink-2">{persona.blurb}</p>
      <AnimatePresence initial={false}>
        {renamedFor && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-ink-2 italic"
          >
            Renamed: you&apos;re the only {renamedFor} here.
          </motion.p>
        )}
      </AnimatePresence>
    </RoomCard>
  );
}

function CandidateCard({ name, index }: { name: string; index: number }) {
  return (
    <RoomCard color={USER_COLOR} emoji="🎓" index={index}>
      <p className="flex flex-wrap items-baseline gap-x-2 font-semibold text-ink">
        <LiveName name={name || "You"} />
        <span className="text-xs font-medium text-ink-2">The Candidate</span>
      </p>
      <p className="mt-0.5 text-sm leading-snug text-ink-2">Open strong, jump in, pull the drift back, summarise.</p>
    </RoomCard>
  );
}
