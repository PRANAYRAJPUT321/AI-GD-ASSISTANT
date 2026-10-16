"use client";

import { ArrowLeft, ArrowRight, Compass, Hash, Lightbulb, ListPlus, Megaphone, Scale } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MODERATOR } from "@/lib/personas";
import { isRecognitionSupported } from "@/lib/speech/stt";
import { CATEGORY_LABELS } from "@/lib/topics";
import type { Topic } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { useClientValue, useHydrated } from "@/components/ui/hooks";
import { ringStyle, tint } from "@/components/ui/style";
import { MicCheck } from "./MicCheck";
import { Notepad } from "./Notepad";
import { PrepCountdown } from "./PrepCountdown";

const PREP_SECONDS = 120;
/** How long "The moderator is about to begin" shows when prep time runs out. */
const MODERATOR_MOMENT_MS = 2200;

const STRUCTURE_TIPS = [
  { icon: Lightbulb, text: "Define the topic, or say how you interpret it." },
  { icon: Compass, text: "Pick 2–3 angles: economic, social, ethical, stakeholders." },
  { icon: Hash, text: "Have one example or number ready to quote." },
  { icon: Scale, text: "Take a stance. You can refine it as the GD moves." },
  { icon: Megaphone, text: "Plan your opening line, so you can open the GD." },
] as const;

/** Headings the "Add these headings" button inserts (each ready to type after). */
const TEMPLATE_HEADINGS = [
  "Meaning / interpretation: ",
  "Angle 1: ",
  "Angle 2: ",
  "Example or number: ",
  "My stance: ",
  "Opening line: ",
];
const NOTES_TEMPLATE = TEMPLATE_HEADINGS.join("\n");
/** Present once the template is in the notes (the button then hides). */
const TEMPLATE_MARKER = "Opening line:";

interface PrepScreenProps {
  topic: Topic;
  userName: string;
  minutes: number;
  notes: string;
  onNotesChange(notes: string): void;
  /** Prep timer hit 0 (after the moderator moment) or "Start the GD now". */
  onReady(): void;
  onBack(): void;
}

export function PrepScreen({ topic, userName, minutes, notes, onNotesChange, onReady, onBack }: PrepScreenProps) {
  const [moderatorMoment, setModeratorMoment] = useState(false);
  const recognition = useClientValue(isRecognitionSupported, null);
  const ready = useEffectEvent(onReady);
  const notepadArea = useRef<HTMLDivElement>(null);
  const firstName = userName.split(" ")[0];

  // Time's up: hold "The moderator is about to begin" briefly, then hand over to the room.
  useEffect(() => {
    if (!moderatorMoment) return;
    const timer = window.setTimeout(() => ready(), MODERATOR_MOMENT_MS);
    return () => window.clearTimeout(timer);
  }, [moderatorMoment]);

  /** Appends the headings, then puts the caret after the first one so they can type at once. */
  function addTemplate() {
    const prefix = notes.trim() ? `${notes.trimEnd()}\n\n` : "";
    onNotesChange(`${prefix}${NOTES_TEMPLATE}`);
    const caret = prefix.length + TEMPLATE_HEADINGS[0].length;
    // Wait a frame for the new value to reach the textarea.
    requestAnimationFrame(() => {
      const textarea = notepadArea.current?.querySelector("textarea");
      textarea?.focus();
      textarea?.setSelectionRange(caret, caret);
    });
  }

  const isCustom = topic.id.startsWith("custom:");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />} onClick={onBack}>
          Back
        </Button>
        <p className="text-sm text-ink-2">{minutes}-minute GD · six people at the table, including you</p>
      </div>

      <header className="flex flex-col gap-2">
        <Eyebrow>Prep time · {isCustom ? "Your own topic" : CATEGORY_LABELS[topic.category]}</Eyebrow>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl"
        >
          {topic.title}
        </motion.h1>
        {topic.hint && <p className="text-lg text-ink-2">{topic.hint}</p>}
        <p className="text-sm text-ink-2">
          {firstName}, you have two minutes. When the moderator says &ldquo;you may begin&rdquo;, you get a few seconds
          to open the GD yourself.
        </p>
      </header>

      {/* DOM order is the phone order (clock, notes, mic, tips); on desktop the grid places
          the clock and mic in a narrow left column beside the notes and tips. */}
      <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr] lg:items-start">
        <Card className="flex flex-col items-center gap-4 p-5 lg:col-start-1 lg:row-start-1">
          <PrepCountdown totalSeconds={PREP_SECONDS} onElapsed={() => setModeratorMoment(true)} />
          <Button
            variant="primary"
            size="lg"
            className="group w-full"
            disabled={moderatorMoment}
            onClick={onReady}
            iconEnd={
              <ArrowRight
                aria-hidden
                className="size-5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            }
          >
            Start the GD now
          </Button>
        </Card>

        <Card className="p-4 sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div ref={notepadArea}>
            <Notepad value={notes} onChange={onNotesChange} autoFocus />
          </div>
        </Card>

        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-2">
          <MicCheck recognition={recognition} />
        </div>

        <Card
          as="section"
          aria-labelledby="structure-title"
          className="flex flex-col gap-3 p-4 sm:p-5 lg:col-start-2 lg:row-start-3"
        >
          <h2 id="structure-title" className="text-sm font-semibold text-ink">
            A quick structure
          </h2>
          <ol className="grid gap-2 sm:grid-cols-2">
            {STRUCTURE_TIPS.map((tip, index) => (
              <motion.li
                key={tip.text}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + index * 0.06 }}
                className="flex items-start gap-2.5 text-sm leading-snug text-ink-2"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <tip.icon aria-hidden className="size-3.5" />
                </span>
                <span className="pt-1">{tip.text}</span>
              </motion.li>
            ))}
          </ol>
          {!notes.includes(TEMPLATE_MARKER) && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              icon={<ListPlus aria-hidden className="size-4" />}
              onClick={addTemplate}
            >
              Add these headings to my notes
            </Button>
          )}
        </Card>
      </div>

      <ModeratorMoment show={moderatorMoment} topicTitle={topic.title} />
    </div>
  );
}

/**
 * Full-screen beat between prep and the room when the prep timer runs out. Portalled to
 * <body> so the phase transition's transform can't re-anchor the fixed overlay mid-fade.
 */
function ModeratorMoment({ show, topicTitle }: { show: boolean; topicTitle: string }) {
  const hydrated = useHydrated();
  return (
    <>
      <p className="sr-only" aria-live="assertive">
        {show ? "Time's up. The moderator is about to begin." : ""}
      </p>
      {hydrated && createPortal(<ModeratorOverlay show={show} topicTitle={topicTitle} />, document.body)}
    </>
  );
}

function ModeratorOverlay({ show, topicTitle }: { show: boolean; topicTitle: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-bg/85 px-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            className="w-full max-w-sm rounded-3xl border border-line bg-panel p-6 text-center shadow-card"
          >
            <span
              className="speaking-ring mx-auto grid size-16 place-items-center rounded-full text-3xl"
              style={ringStyle(MODERATOR.color, { background: tint(MODERATOR.color, 18) })}
            >
              {MODERATOR.emoji}
            </span>
            <p className="mt-4 text-lg font-semibold text-ink">The moderator is about to begin</p>
            <p className="mt-1 line-clamp-2 text-sm text-ink-2">{topicTitle}</p>
            <p className="mt-3 text-sm text-ink-2">Listen for &ldquo;you may begin&rdquo;, then jump in to open.</p>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <motion.div
                className="h-full origin-left rounded-full bg-accent"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: MODERATOR_MOMENT_MS / 1000, ease: "linear" }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
