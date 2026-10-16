"use client";

import {
  CircleCheck,
  CornerDownRight,
  Flag,
  Keyboard,
  Scissors,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useId, useState } from "react";
import { castFor, speakerColor, speakerName, USER_COLOR, type Cast } from "@/lib/personas";
import { formatClock, orderedTurns, splitFillers } from "@/lib/transcript-text";
import type { GDRecord, InterruptionOutcome, Turn } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import { tint } from "@/components/ui/style";
import { isoDuration, plural } from "./format";
import { PRINT_SETTLED } from "./Reveal";

type Filter = "all" | "me";

const FILLER_MARK = "bg-transparent text-inherit underline decoration-warn decoration-2 underline-offset-[3px]";

/**
 * The full GD, turn by turn: who spoke (colour dot + name), when (m:ss from the start of
 * the discussion), the candidate's turns highlighted with their filler words underlined,
 * and markers for cut-offs, cut-ins, continuations and typed turns. Closing summaries are a
 * section of their own. "Just me" narrows it to the candidate's turns.
 */
export function TranscriptView({ record }: { record: GDRecord }) {
  const id = useId();
  const [filter, setFilter] = useState<Filter>("all");
  const cast = castFor(record.config.userName);
  const turns = orderedTurns(record);
  const mine = turns.filter((turn) => turn.speaker === "user");
  const shown = filter === "me" ? mine : turns;
  const outcomes = new Map(record.interruptions.map((event) => [event.interjectionTurnId, event.outcome]));

  const options: SegmentOption<Filter>[] = [
    { value: "all", label: "All", description: plural(turns.length, "turn") },
    { value: "me", label: "Just me", description: plural(mine.length, "turn") },
  ];
  const groups = [
    {
      title: "Discussion",
      turns: shown.filter((turn) => turn.phase !== "summary"),
      empty: filter === "me" ? "You didn't speak in the discussion." : "Nothing was said in the discussion.",
    },
    {
      title: "Closing summaries",
      turns: shown.filter((turn) => turn.phase === "summary"),
      empty: filter === "me" ? "You didn't give a closing summary." : "The GD ended before the closing summaries.",
    },
  ];

  return (
    <Card
      as="section"
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-5 p-4 sm:p-6 print:shadow-none [print-color-adjust:exact]"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
            Full transcript
          </h2>
          <p className="mt-0.5 text-sm text-ink-2">
            Times run from the start of the discussion. In your turns, <mark className={FILLER_MARK}>filler words</mark>{" "}
            are underlined.
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-72 print:hidden">
          <SegmentedControl label="Show" options={options} value={filter} onChange={setFilter} />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {filter === "me" ? `Showing your ${plural(mine.length, "turn")}.` : `Showing all ${plural(turns.length, "turn")}.`}
      </p>
      <p className="hidden text-xs text-ink-2 print:block">
        {filter === "me" ? "Only the candidate's turns are shown." : "Every turn is shown."}
      </p>

      <motion.div
        key={filter}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={cn("flex flex-col gap-6", PRINT_SETTLED)}
      >
        {groups.map((group, index) => (
          <section key={group.title} aria-labelledby={`${id}-group-${index}`} className="flex flex-col gap-2">
            <h3
              id={`${id}-group-${index}`}
              className="border-b border-line pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-2"
            >
              {group.title}
            </h3>
            {group.turns.length > 0 ? (
              <ol className="flex flex-col gap-1">
                {group.turns.map((turn) => (
                  <TurnItem
                    key={turn.id}
                    turn={turn}
                    record={record}
                    cast={cast}
                    outcome={outcomes.get(turn.id) ?? null}
                  />
                ))}
              </ol>
            ) : (
              <p className="py-2 text-sm text-ink-2">{group.empty}</p>
            )}
          </section>
        ))}
      </motion.div>
    </Card>
  );
}

interface Marker {
  icon: LucideIcon;
  label: string;
}

/** The non-colour markers on a turn: how it started, how it ended, how it was entered. */
function markersFor(turn: Turn, cast: Cast, userName: string, outcome: InterruptionOutcome | null): Marker[] {
  const markers: Marker[] = [];
  if (turn.kind === "interjection") {
    markers.push({ icon: Zap, label: "Cut in on you" });
    if (outcome === "held") markers.push({ icon: CircleCheck, label: "You held the floor" });
    if (outcome === "yielded") markers.push({ icon: Flag, label: "You yielded" });
  }
  if (turn.continuation) markers.push({ icon: CornerDownRight, label: "Carried on" });
  if (turn.typed) markers.push({ icon: Keyboard, label: "Typed" });
  if (turn.interrupted) {
    const by = turn.interruptedBy;
    const label = !by ? "Cut off" : by === "user" ? "Cut off by you" : `Cut off by ${speakerName(by, cast, userName)}`;
    markers.push({ icon: Scissors, label });
  }
  return markers;
}

function TurnItem({
  turn,
  record,
  cast,
  outcome,
}: {
  turn: Turn;
  record: GDRecord;
  cast: Cast;
  outcome: InterruptionOutcome | null;
}) {
  const { userName } = record.config;
  const isUser = turn.speaker === "user";
  const offsetMs = turn.startMs - record.discussionStartMs;
  const markers = markersFor(turn, cast, userName, outcome);

  return (
    <li
      className={cn(
        "grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2.5 rounded-xl py-2.5 pr-3 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-3",
        "print:break-inside-avoid",
        // The candidate's rows: a bar in their colour (borders print, unlike some backgrounds).
        isUser ? "border-l-[3px] pl-[3px]" : "pl-1.5",
      )}
      style={isUser ? { borderLeftColor: USER_COLOR, background: tint(USER_COLOR, 9) } : undefined}
    >
      <time dateTime={isoDuration(offsetMs)} className="pt-0.5 text-right font-mono text-xs tabular-nums text-ink-2">
        {formatClock(offsetMs)}
      </time>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: speakerColor(turn.speaker, cast) }}
          />
          <span className="text-sm font-semibold text-ink">{speakerName(turn.speaker, cast, userName)}</span>
          {isUser && (
            <span className="rounded-full bg-panel px-1.5 py-px text-[0.6875rem] font-bold text-ink shadow-card">You</span>
          )}
          {markers.map((marker) => (
            <span
              key={marker.label}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-px text-[0.6875rem] font-semibold text-ink-2"
            >
              <marker.icon aria-hidden className="size-3" />
              {marker.label}
            </span>
          ))}
        </p>
        <p
          className={cn(
            "mt-1 text-[0.9375rem] leading-relaxed wrap-break-word",
            turn.speaker === "moderator" ? "text-ink-2 italic" : "text-ink",
          )}
        >
          {isUser ? <FillerText text={turn.text} /> : turn.text}
        </p>
      </div>
    </li>
  );
}

/** The candidate's words with filler words and phrases underlined. */
function FillerText({ text }: { text: string }) {
  return (
    <>
      {splitFillers(text).map((segment, index) =>
        segment.filler ? (
          <mark key={index} className={FILLER_MARK}>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
