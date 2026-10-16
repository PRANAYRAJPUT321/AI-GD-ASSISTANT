"use client";

import {
  AudioWaveform,
  ChartPie,
  CircleCheck,
  CircleX,
  Gauge,
  Hand,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Timer,
} from "lucide-react";
import { castFor, speakerName, USER_COLOR } from "@/lib/personas";
import type { GDMetrics, Scorecard } from "@/lib/scoring";
import { formatClock, orderedTurns } from "@/lib/transcript-text";
import type { GDRecord } from "@/lib/types";
import { FAIR_SHARE } from "./AirtimeChart";
import { formatPercent, formatSeconds, plural } from "./format";
import { KpiTile } from "./KpiTile";
import { GrowBar } from "./Reveal";

/** Within this many percentage points of the fair share counts as "about fair". */
const FAIR_SHARE_TOLERANCE = 0.03;
/** The comfortable speaking pace the evaluator coaches towards (words per minute). */
const PACE_RANGE = [120, 160] as const;
/** An entry inside the first minute counts as early. */
const EARLY_ENTRY_SEC = 60;
/** How many of the most frequent fillers to name. */
const TOP_FILLERS = 3;

/** Who opened the discussion: the first participant (not the moderator) to speak in it. */
function openerName(record: GDRecord): string | null {
  const first = orderedTurns(record).find((turn) => turn.phase === "discussion" && turn.speaker !== "moderator");
  if (!first) return null;
  return speakerName(first.speaker, castFor(record.config.userName), record.config.userName);
}

function airtimeComparison(share: number): string {
  if (Math.abs(share - FAIR_SHARE) <= FAIR_SHARE_TOLERANCE) return "About your fair share";
  return share > FAIR_SHARE ? "Above your fair share" : "Below your fair share";
}

function paceDetail(metrics: GDMetrics): string {
  const wpm = metrics.wordsPerMinute;
  if (wpm === null) {
    return metrics.inputMode === "text"
      ? "n/a in text mode: your turns were typed."
      : "Under 20 seconds of speech: too little to measure.";
  }
  const [low, high] = PACE_RANGE;
  if (wpm < low) return `Words a minute: on the slow side. Aim for ${low}–${high}.`;
  if (wpm > high) return `Words a minute: on the fast side. Aim for ${low}–${high}.`;
  return `Words a minute: in the comfortable ${low}–${high} range.`;
}

function firstEntryDetail(metrics: GDMetrics): string {
  if (metrics.firstEntrySec === null) return "You didn't speak in the discussion.";
  if (metrics.openedDiscussion) return "You opened the discussion.";
  if (metrics.firstEntrySec <= EARLY_ENTRY_SEC) return "Inside the first minute: an early entry.";
  return "After the first minute. Earlier entries get noticed.";
}

/** 2.4 → "2.4", 3 → "3". */
const oneDecimal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The measured numbers from the transcript, as a row of KPI tiles. */
export function KeyNumbers({ card }: { card: Scorecard }) {
  const { metrics, record } = card;
  const opener = openerName(record);
  const pendingInterruptions =
    metrics.interruptionsFaced - metrics.interruptionsHeld - metrics.interruptionsYielded;
  const topFillers = metrics.fillers
    .slice(0, TOP_FILLERS)
    .map((filler) => `“${filler.word}” ×${filler.count}`)
    .join(" · ");

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
      <KpiTile
        delay={0}
        icon={Megaphone}
        label="Opened the discussion"
        value={metrics.openedDiscussion ? "Yes" : "No"}
        status={
          metrics.openedDiscussion ? { icon: CircleCheck, tone: "good" } : { icon: CircleX, tone: "warn" }
        }
        detail={
          metrics.openedDiscussion
            ? "You spoke first, before any participant."
            : opener
              ? `${opener} opened the discussion.`
              : "Nobody opened the discussion."
        }
      />
      <KpiTile
        delay={0.05}
        icon={MessagesSquare}
        label="Entries"
        value={metrics.entries}
        detail={
          metrics.entries === 0
            ? "You never took the floor in the discussion."
            : metrics.cutIns > 0
              ? `Including ${plural(metrics.cutIns, "cut-in")}, where you cut off a speaker.`
              : "All in open gaps; no cut-ins."
        }
      />
      <KpiTile
        delay={0.1}
        icon={ChartPie}
        label="Airtime share"
        value={formatPercent(metrics.airtimeShare)}
        detail={`${airtimeComparison(metrics.airtimeShare)} (about 17%). You spoke for ${formatSeconds(metrics.userAirtimeSec)}.`}
      >
        <AirtimeMeter share={metrics.airtimeShare} />
      </KpiTile>
      <KpiTile
        delay={0.15}
        icon={Timer}
        label="First entry"
        value={metrics.firstEntrySec === null ? "Never" : formatClock(metrics.firstEntrySec * 1000)}
        detail={firstEntryDetail(metrics)}
      />
      <KpiTile
        delay={0.2}
        icon={Gauge}
        label="Speaking pace"
        value={metrics.wordsPerMinute ?? "n/a"}
        unit={metrics.wordsPerMinute === null ? undefined : "wpm"}
        detail={paceDetail(metrics)}
      />
      <KpiTile
        delay={0.25}
        icon={AudioWaveform}
        label="Filler words"
        value={oneDecimal(metrics.fillersPer100)}
        unit="per 100 words"
        detail={
          metrics.userWords === 0
            ? "No words of yours to count."
            : metrics.fillerTotal === 0
              ? "None detected."
              : `Most used: ${topFillers}`
        }
        footnote={
          metrics.inputMode === "text"
            ? "Counted in your typed turns."
            : "Browser speech-to-text often drops “um” and “uh”, so treat this as a floor."
        }
      />
      <KpiTile
        delay={0.3}
        icon={Hand}
        label="Interruptions held"
        value={metrics.interruptionsFaced === 0 ? "None" : `${metrics.interruptionsHeld}/${metrics.interruptionsFaced}`}
        unit={metrics.interruptionsFaced === 0 ? undefined : "held"}
        detail={
          metrics.interruptionsFaced === 0
            ? metrics.inputMode === "text"
              ? "Nobody cuts in on typed turns."
              : "Nobody cut in on you this time."
            : [
                metrics.interruptionsYielded > 0
                  ? `You yielded ${plural(metrics.interruptionsYielded, "time")}.`
                  : "You kept the floor every time.",
                pendingInterruptions > 0 ? `${pendingInterruptions} undecided when the GD ended.` : "",
              ]
                .filter(Boolean)
                .join(" ")
        }
      />
      <KpiTile
        delay={0.35}
        icon={ListChecks}
        label="Closing summary"
        value={metrics.summaryGiven ? "Given" : "None"}
        status={metrics.summaryGiven ? { icon: CircleCheck, tone: "good" } : { icon: CircleX, tone: "warn" }}
        detail={
          metrics.summaryWords === 0
            ? "You didn't summarise."
            : metrics.summaryGiven
              ? `${plural(metrics.summaryWords, "word")}.`
              : `${plural(metrics.summaryWords, "word")}: too short to count as a summary.`
        }
      />
    </dl>
  );
}

/** The candidate's share on a 0–50% track (or wider when needed), with the fair share marked. */
function AirtimeMeter({ share }: { share: number }) {
  const max = Math.max(0.5, share);
  return (
    <span aria-hidden className="relative mt-0.5 block h-1.5 rounded-full bg-panel-2 [print-color-adjust:exact]">
      {share > 0 && (
        <GrowBar
          delay={0.3}
          className="h-full rounded-full"
          style={{ width: `max(4px, ${(share / max) * 100}%)`, background: USER_COLOR }}
        />
      )}
      <span className="absolute -inset-y-1 w-0.5 rounded-full bg-ink" style={{ left: `${(FAIR_SHARE / max) * 100}%` }} />
    </span>
  );
}
