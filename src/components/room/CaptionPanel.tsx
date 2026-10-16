"use client";

import { Keyboard, Mic, SendHorizontal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Cast } from "@/lib/personas";
import type { EngineState } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { tint } from "@/components/ui/style";
import { inkTint, ThinkingDots } from "./bits";
import { beingInterjected, captionWords, pendingInterruption, seatInfo, spokenWordCount, stageStatus, type SeatInfo } from "./model";

interface CaptionPanelProps {
  state: EngineState;
  cast: Cast;
  /** Text mode: the candidate's draft (owned by the room so the floor button can send it too). */
  draft: string;
  onDraftChange(text: string): void;
  onSubmitDraft(): void;
  /** The composer closed while it had focus: put focus somewhere sensible. */
  onComposerClosed(): void;
}

/**
 * The live caption: the AI line being spoken with the spoken part in full ink (word by word),
 * the candidate's live speech-to-text, or, in text mode, the box they type their turn in.
 * Each new line slides in; the region is announced politely to screen readers.
 */
export function CaptionPanel({ state, cast, draft, onDraftChange, onSubmitDraft, onComposerClosed }: CaptionPanelProps) {
  const speaking = state.activeSpeaker;
  // The same condition as floorControl's "send": while an interjection's hold window runs
  // (possible if the mic failed mid-turn) the engine takes no typed text, so no composer.
  const composing =
    speaking === "user" && state.floor === "user" && state.inputMode === "text" && pendingInterruption(state) === null;
  const seat = speaking ? seatInfo(speaking, cast) : null;
  const turnsSoFar = state.transcript.length;

  let key: string;
  let content: ReactNode;
  if (composing) {
    key = `compose:${turnsSoFar}`;
    content = (
      <Composer
        value={draft}
        onChange={onDraftChange}
        onSubmit={onSubmitDraft}
        onClosed={onComposerClosed}
        summary={state.phase === "summary"}
      />
    );
  } else if (speaking === "user") {
    key = `user:${turnsSoFar}`;
    content = <LiveUserCaption text={state.caption} holding={pendingInterruption(state) !== null} />;
  } else if (speaking && seat && state.caption) {
    key = `${speaking}:${turnsSoFar}`;
    content = <SpokenLine text={state.caption} spokenChars={state.captionSpokenChars} color={seat.color} />;
  } else {
    const status = stageStatus(state, cast);
    key = `idle:${status.text}`;
    content = <IdleCaption text={status.text} preparing={status.tone === "waiting" && status.speaker ? seatInfo(status.speaker, cast) : null} />;
  }

  const badge = captionBadge(state, composing);

  return (
    <section aria-label="Live caption" className="relative overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 transition-colors duration-500"
        style={{ background: seat ? seat.color : "var(--line)" }}
      />
      <div aria-live="polite" className="relative min-h-[12.5rem] px-4 pb-4 pt-4 sm:px-5">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            className="flex flex-col gap-2"
          >
            {seat && <SpeakerHeader seat={seat} badge={badge} />}
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function captionBadge(state: EngineState, composing: boolean): string | null {
  if (composing) return "Typing";
  if (beingInterjected(state)) return "Cutting in";
  if (state.activeSpeaker === "user") return pendingInterruption(state) ? "Hold your ground" : "Listening";
  if (state.activeSpeaker) return state.phase === "summary" && state.activeSpeaker !== "moderator" ? "Summary" : "Speaking";
  return null;
}

function SpeakerHeader({ seat, badge }: { seat: SeatInfo; badge: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full text-base"
        style={{ background: tint(seat.color, 20) }}
      >
        {seat.emoji}
      </span>
      <p className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-semibold" style={{ color: inkTint(seat.color) }}>
          {seat.name}
        </span>
        <span className="truncate text-xs text-ink-2">{seat.role}</span>
      </p>
      {badge && (
        <span className="ml-auto shrink-0 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
          {badge}
        </span>
      )}
    </div>
  );
}

/** Shared scroll box for caption text: fixed height (so the layout doesn't jump), faded edges. */
const SCROLLER =
  "relative h-32 overflow-y-auto overscroll-contain pr-1 text-lg leading-8 sm:h-36 sm:text-xl sm:leading-9 " +
  "[mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-18px),transparent)]";

/**
 * An AI line with the spoken words in full ink and the rest dimmed, at word granularity. The
 * box follows the voice, keeping the current word in view.
 */
function SpokenLine({ text, spokenChars, color }: { text: string; spokenChars: number; color: string }) {
  const words = useMemo(() => captionWords(text), [text]);
  const spoken = spokenWordCount(words, spokenChars);
  const box = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const scroller = box.current;
    const word = scroller?.querySelector<HTMLElement>(`[data-word="${Math.max(0, spoken - 1)}"]`);
    if (!scroller || !word) return;
    const bottom = word.offsetTop + word.offsetHeight;
    const outOfView = bottom > scroller.scrollTop + scroller.clientHeight - 18 || word.offsetTop < scroller.scrollTop;
    if (outOfView) {
      scroller.scrollTo({
        top: Math.max(0, word.offsetTop - scroller.clientHeight / 3),
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
  }, [spoken, reduceMotion]);

  return (
    <div ref={box} className={SCROLLER}>
      <p className="py-1">
        {words.map((word, index) => (
          <Fragment key={index}>
            {index > 0 && " "}
            <span
              data-word={index}
              className={cn(
                "rounded-md transition-[color,background-color] duration-200",
                index < spoken ? "text-ink" : "text-ink-3",
              )}
              style={index === spoken - 1 ? { background: tint(color, 18), boxShadow: `0 0 0 2px ${tint(color, 18)}` } : undefined}
            >
              {word.text}
            </span>
          </Fragment>
        ))}
      </p>
    </div>
  );
}

/** The candidate's live speech-to-text with a caret, following the newest words. */
function LiveUserCaption({ text, holding }: { text: string; holding: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const scroller = box.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [text]);

  return (
    // The candidate hears themselves: their words are not read back to a screen reader.
    <div ref={box} aria-live="off" className={SCROLLER}>
      <p className="py-1 text-ink">
        {text ? (
          text
        ) : (
          <span className="inline-flex items-center gap-2 text-ink-2">
            <Mic aria-hidden className="size-5" />
            {holding ? "Keep talking to hold your ground…" : "Listening… start speaking."}
          </span>
        )}
        <motion.span
          aria-hidden
          className="ml-1 inline-block h-[1.1em] w-[3px] translate-y-[0.18em] rounded-full bg-accent"
          animate={reduceMotion ? { opacity: 1 } : { opacity: [1, 0.15, 1] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
      </p>
    </div>
  );
}

function IdleCaption({ text, preparing }: { text: string; preparing: SeatInfo | null }) {
  return (
    <div className="flex h-36 flex-col items-center justify-center gap-2 text-center sm:h-44">
      {preparing && (
        <span
          aria-hidden
          className="grid size-10 place-items-center rounded-full text-xl"
          style={{ background: tint(preparing.color, 18) }}
        >
          {preparing.emoji}
        </span>
      )}
      <p className="text-base font-semibold text-ink-2 sm:text-lg">{text}</p>
      {preparing && <ThinkingDots color={preparing.color} />}
    </div>
  );
}

interface ComposerProps {
  value: string;
  onChange(text: string): void;
  onSubmit(): void;
  onClosed(): void;
  summary: boolean;
}

/** Text mode: the candidate types their turn. Enter sends, Shift+Enter starts a new line. */
function Composer({ value, onChange, onSubmit, onClosed, summary }: ComposerProps) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const closed = useEffectEvent(onClosed);

  // When the turn ends (sent, or the time cap), the box unmounts: if it had focus, hand focus
  // back instead of dropping it on <body>. A layout cleanup runs while the node is still there.
  useLayoutEffect(() => {
    const node = area.current;
    return () => {
      if (node && node === document.activeElement) closed();
    };
  }, []);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {summary ? "Your closing summary" : "Your turn"}
      </label>
      <textarea
        ref={area}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
        autoFocus
        rows={3}
        aria-describedby={`${id}-hint`}
        placeholder={summary ? "Main points from both sides, then your conclusion…" : "Make your point…"}
        className={cn(
          "w-full resize-none rounded-xl border border-line bg-panel-2/60 p-3 text-base leading-relaxed text-ink placeholder:text-ink-2",
          "outline-none transition-[border-color,box-shadow,background-color] duration-150",
          "focus-visible:border-accent focus-visible:bg-panel focus-visible:ring-4 focus-visible:ring-accent/20",
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-hint`} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
          <Keyboard aria-hidden className="size-3.5" />
          Enter sends · Shift+Enter for a new line
        </p>
        <Button type="submit" variant="primary" size="sm" iconEnd={<SendHorizontal aria-hidden className="size-4" />}>
          Send
        </Button>
      </div>
    </form>
  );
}
