"use client";

import { ArrowDown, ChevronDown, CornerDownRight, Keyboard, NotebookPen, Scissors, ScrollText } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, memo, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { Cast } from "@/lib/personas";
import type { EngineState, GDPhase, Turn } from "@/lib/types";
import { Notepad } from "@/components/prep/Notepad";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { tint } from "@/components/ui/style";
import { inkTint, ThinkingDots } from "./bits";
import { nameOf, seatInfo, turnStamp } from "./model";

type Tab = "notes" | "transcript";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "notes", label: "Notes" },
  { id: "transcript", label: "Transcript" },
];

interface SidePanelProps {
  state: EngineState;
  cast: Cast;
  notes: string;
  onNotesChange(notes: string): void;
  className?: string;
}

/**
 * Notes and the live transcript. A sticky column beside the table on large screens; on
 * smaller ones a collapsible section under the controls.
 */
export function SidePanel({ state, cast, notes, onNotesChange, className }: SidePanelProps) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("notes");
  const [expanded, setExpanded] = useState(false);
  /** Transcript turns seen when the candidate last left the Transcript tab. */
  const [seen, setSeen] = useState(0);
  const turns = state.transcript.length;
  const unread = tab === "transcript" ? 0 : Math.max(0, turns - seen);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ notes: null, transcript: null });

  function choose(next: Tab) {
    if (tab === "transcript" && next !== "transcript") setSeen(turns);
    setTab(next);
  }

  /** Arrow keys, Home and End move between the tabs (the WAI-ARIA tabs pattern). */
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((item) => item.id === tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next].id;
    choose(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <aside aria-label="Notes and transcript" className={cn("lg:relative", className)}>
      {/* On large screens the panel fills the grid area without adding height to it, and
          sticks to the viewport while the room scrolls. */}
      <div className="lg:absolute lg:inset-0">
        <Card className="flex flex-col overflow-hidden lg:sticky lg:top-4 lg:h-full lg:max-h-[calc(100dvh-2rem)]">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${id}-body`}
            onClick={() => setExpanded((open) => !open)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent lg:hidden"
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <NotebookPen aria-hidden className="size-4 text-ink-2" />
              Notes &amp; transcript
            </span>
            <span className="inline-flex items-center gap-2 text-xs text-ink-2">
              {turns > 0 && (
                <span className="tabular-nums">
                  {turns} turn{turns === 1 ? "" : "s"}
                </span>
              )}
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")}
              />
            </span>
          </button>

          <div
            id={`${id}-body`}
            className={cn(
              "min-h-0 flex-1 flex-col border-t border-line lg:flex lg:border-t-0",
              expanded ? "flex" : "hidden",
            )}
          >
            <div role="tablist" aria-label="Side panel" className="m-3 mb-0 grid grid-cols-2 gap-1 rounded-xl bg-panel-2 p-1">
              {TABS.map((item) => {
                const selected = item.id === tab;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      tabRefs.current[item.id] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${item.id}`}
                    aria-selected={selected}
                    aria-controls={`${id}-panel-${item.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => choose(item.id)}
                    onKeyDown={onTabKey}
                    className={cn(
                      "relative flex min-h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-accent",
                      selected ? "text-ink" : "text-ink-2 hover:text-ink",
                    )}
                  >
                    {selected && (
                      <motion.span
                        aria-hidden
                        layoutId={`${id}-tab-thumb`}
                        className="absolute inset-0 rounded-lg border border-line bg-panel shadow-card"
                        transition={{ type: "spring", stiffness: 520, damping: 40 }}
                      />
                    )}
                    <span className="relative inline-flex items-center gap-1.5">
                      {item.id === "notes" ? (
                        <NotebookPen aria-hidden className="size-3.5" />
                      ) : (
                        <ScrollText aria-hidden className="size-3.5" />
                      )}
                      {item.label}
                      {item.id === "transcript" && unread > 0 && (
                        <span className="rounded-full bg-accent px-1.5 text-[11px] leading-4 text-accent-ink tabular-nums">
                          {unread}
                          <span className="sr-only"> new</span>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              role="tabpanel"
              id={`${id}-panel-notes`}
              aria-labelledby={`${id}-tab-notes`}
              hidden={tab !== "notes"}
              className="flex min-h-0 flex-1 flex-col p-3"
            >
              <Notepad compact value={notes} onChange={onNotesChange} />
            </div>
            <div
              role="tabpanel"
              id={`${id}-panel-transcript`}
              aria-labelledby={`${id}-tab-transcript`}
              hidden={tab !== "transcript"}
              className="relative flex min-h-0 flex-1 flex-col"
            >
              <Transcript state={state} cast={cast} shown={tab === "transcript"} expanded={expanded} />
            </div>
          </div>
        </Card>
      </div>
    </aside>
  );
}

const PHASE_TITLES: Record<GDPhase, string> = { intro: "Intro", discussion: "Discussion", summary: "Summaries" };

/** Pixels from the bottom that still count as "at the latest line". */
const PINNED_SLACK = 40;

/**
 * The live transcript. It follows new lines unless the candidate has scrolled up to read,
 * in which case a "Latest" button brings them back.
 */
function Transcript({ state, cast, shown, expanded }: { state: EngineState; cast: Cast; shown: boolean; expanded: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const [pinned, setPinned] = useState(true);
  const turns = state.transcript;
  const live = state.activeSpeaker ?? state.preparing;

  useEffect(() => {
    const element = list.current;
    if (element && pinned) element.scrollTop = element.scrollHeight;
  }, [turns.length, live, pinned, shown, expanded]);

  function onScroll() {
    const element = list.current;
    if (!element) return;
    setPinned(element.scrollHeight - element.scrollTop - element.clientHeight < PINNED_SLACK);
  }

  function toLatest() {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
    setPinned(true);
  }

  return (
    <>
      <ol
        ref={list}
        onScroll={onScroll}
        aria-label="Transcript so far"
        className="flex max-h-[24rem] min-h-40 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-3 lg:max-h-none"
      >
        {turns.length === 0 && (
          <li className="m-auto max-w-56 py-8 text-center text-sm text-ink-2">
            The transcript fills in as people speak.
          </li>
        )}
        {turns.map((turn, index) => (
          <Fragment key={turn.id}>
            {turn.phase !== turns[index - 1]?.phase && <PhaseDivider phase={turn.phase} />}
            <TranscriptLine turn={turn} cast={cast} discussionStartMs={state.discussionStartMs} />
          </Fragment>
        ))}
        {live && (
          <li className="flex items-center gap-2 px-2 py-1.5 text-xs text-ink-2">
            <span className="font-semibold" style={{ color: inkTint(seatInfo(live, cast).color) }}>
              {nameOf(live, cast)}
            </span>
            {state.activeSpeaker ? (live === "user" ? "has the floor" : "is speaking") : "is about to speak"}
            <ThinkingDots color={seatInfo(live, cast).color} />
          </li>
        )}
      </ol>
      {!pinned && turns.length > 0 && (
        <button
          type="button"
          onClick={toLatest}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink shadow-card outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowDown aria-hidden className="size-3.5" />
          Latest
        </button>
      )}
    </>
  );
}

function PhaseDivider({ phase }: { phase: GDPhase }) {
  return (
    <li className="flex items-center gap-2 px-1 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2">
      <span aria-hidden className="h-px flex-1 bg-line" />
      {PHASE_TITLES[phase]}
      <span aria-hidden className="h-px flex-1 bg-line" />
    </li>
  );
}

/**
 * One transcript line. Memoised: the room re-renders on every engine tick, but recorded turns
 * are immutable, so only new lines render.
 */
const TranscriptLine = memo(function TranscriptLine({
  turn,
  cast,
  discussionStartMs,
}: {
  turn: Turn;
  cast: Cast;
  discussionStartMs: number | null;
}) {
  const seat = seatInfo(turn.speaker, cast);
  const interjection = turn.kind === "interjection";
  const you = turn.speaker === "user";
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("rounded-lg px-2 py-1.5", interjection && "ml-5 border-l-2 pl-3", you && "bg-accent-soft/60")}
      style={interjection ? { borderColor: seat.color } : undefined}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
        {interjection && <CornerDownRight aria-hidden className="size-3 self-center text-ink-2" />}
        <span className="font-semibold" style={{ color: inkTint(seat.color) }}>
          {seat.name}
        </span>
        <span className="tabular-nums text-ink-2">{turnStamp(turn, discussionStartMs)}</span>
        {interjection && <span className="text-ink-2">cut in</span>}
        {turn.continuation && <span className="text-ink-2">continuing</span>}
        {turn.typed && (
          <span className="inline-flex items-center gap-1 self-center text-ink-2">
            <Keyboard aria-hidden className="size-3" />
            typed
          </span>
        )}
      </p>
      <p className="mt-0.5 text-sm leading-snug text-ink">{turn.text}</p>
      {turn.interrupted && (
        <p
          className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-bad"
          style={{ background: tint("var(--bad)", 12) }}
        >
          <Scissors aria-hidden className="size-3" />
          Cut off{turn.interruptedBy ? ` by ${nameOf(turn.interruptedBy, cast)}` : ""}
        </p>
      )}
    </motion.li>
  );
});
