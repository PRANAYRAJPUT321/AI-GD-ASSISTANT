"use client";

import {
  CalendarDays,
  Keyboard,
  Mic,
  Printer,
  RotateCcw,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  ThumbsUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { earnedBadges, type ResultProgress } from "@/lib/progress";
import type { Scorecard } from "@/lib/scoring";
import { formatClock, topicCategoryLabel } from "@/lib/transcript-text";
import { Button } from "@/components/ui/Button";
import { Card, Eyebrow } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { tint } from "@/components/ui/style";
import { Confetti } from "@/components/progress/Confetti";
import { BadgesEarned, ProgressChips } from "@/components/progress/ScorecardProgress";
import { AirtimeChart, FAIR_SHARE } from "./AirtimeChart";
import { AssessmentSections } from "./AssessmentSections";
import { DownloadTranscriptButton } from "./DownloadTranscriptButton";
import { formatDateLabel, formatPercent } from "./format";
import { KeyNumbers } from "./KeyNumbers";
import { PrintStyles } from "./PrintStyles";
import { EASE_OUT, Reveal } from "./Reveal";
import { ScoreRing } from "./ScoreRing";
import { TranscriptView } from "./TranscriptView";

interface ScoreBand {
  min: number;
  label: string;
  /** CSS colour for the ring and glow. */
  color: string;
  /** Text colour class for the band icon. */
  iconClass: string;
  icon: LucideIcon;
}

/** Score bands, highest first. The label always accompanies the colour. */
const SCORE_BANDS: readonly ScoreBand[] = [
  { min: 75, label: "Strong", color: "var(--good)", iconClass: "text-good", icon: Trophy },
  { min: 60, label: "Solid", color: "var(--accent)", iconClass: "text-accent", icon: ThumbsUp },
  { min: 45, label: "Developing", color: "var(--warn)", iconClass: "text-warn", icon: TrendingUp },
  { min: 0, label: "Needs work", color: "var(--bad)", iconClass: "text-bad", icon: Target },
];

function bandFor(score: number): ScoreBand {
  return SCORE_BANDS.find((band) => score >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

/** Score from which a GD is worth celebrating even without a new best or badge. */
const CELEBRATE_SCORE = 75;

/**
 * The scorecard: overall verdict, progress since last time, badges, measured numbers,
 * airtime, feedback by area and the transcript.
 */
export function ScorecardView({
  card,
  progress = null,
  onRestart,
}: {
  card: Scorecard;
  /** What this GD changed in the device's practice history; null when it wasn't recorded. */
  progress?: ResultProgress | null;
  onRestart(): void;
}) {
  const id = useId();
  // The record carries no wall-clock time; the scorecard appears moments after the GD ends.
  const [date] = useState(() => new Date());
  const { assessment, metrics, record } = card;
  const { config } = record;
  const band = bandFor(assessment.overall.score);
  const BandIcon = band.icon;
  const typed = metrics.inputMode === "text";
  const badges = earnedBadges(metrics, assessment);
  const celebrate =
    assessment.overall.score >= CELEBRATE_SCORE ||
    (progress !== null && (progress.personalBest || progress.newBadges.length > 0));

  const actions = (
    <>
      <DownloadTranscriptButton record={record} date={date} size="sm" />
      <Button size="sm" icon={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>
        Print / save as PDF
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-6 sm:gap-8 print:gap-5">
      <PrintStyles />
      {celebrate && <Confetti />}

      <header className="flex flex-col gap-3">
        <Eyebrow>Your scorecard · {topicCategoryLabel(config.topic)}</Eyebrow>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          className="text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl"
        >
          {config.topic.title}
        </motion.h1>
        <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
          <Meta icon={UserRound} term="Candidate">
            {config.userName}
          </Meta>
          <Meta icon={CalendarDays} term="Date">
            {formatDateLabel(date)}
          </Meta>
          <Meta icon={Timer} term="Discussion length">
            {config.minutes} min planned · {formatClock(record.discussionEndMs - record.discussionStartMs)} recorded
          </Meta>
          <Meta icon={typed ? Keyboard : Mic} term="Input">
            {typed ? "Typed turns" : "Spoken turns"}
          </Meta>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1 print:hidden">
          {actions}
          <Button
            size="sm"
            variant="primary"
            icon={<RotateCcw aria-hidden className="size-4" />}
            onClick={onRestart}
          >
            Practise again
          </Button>
        </div>
      </header>

      <Reveal>
        <Card
          as="section"
          aria-labelledby={`${id}-overall`}
          className="relative overflow-hidden p-5 sm:p-8 print:break-inside-avoid print:shadow-none"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full blur-3xl print:hidden"
            style={{ background: tint(band.color, 22) }}
          />
          <div className="relative flex flex-col items-center gap-6 text-center sm:flex-row sm:gap-8 sm:text-left">
            <ScoreRing score={assessment.overall.score} color={band.color} />
            <div className="flex min-w-0 flex-col items-center gap-3 sm:items-start">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink"
                style={{ background: tint(band.color, 12) }}
              >
                <BandIcon aria-hidden className={cn("size-3.5", band.iconClass)} />
                {band.label}
              </span>
              <h2 id={`${id}-overall`} className="text-balance text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                <span className="sr-only">Overall verdict: </span>
                {assessment.overall.headline}
              </h2>
              <p className="text-base leading-relaxed text-ink-2 wrap-break-word">{assessment.overall.verdict}</p>
              {progress && <ProgressChips progress={progress} />}
              <p className="text-xs text-ink-2">
                Scored out of 100 across the eight areas below. Most practice GDs land between 45 and 65.
              </p>
              {card.offline && (
                <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-ink">
                  Practice mode: no AI evaluator was available, so this scorecard is built from your measured numbers
                  and simple checks of what you said.
                </p>
              )}
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal>
        <BadgesEarned earned={badges} fresh={progress?.newBadges ?? []} />
      </Reveal>

      <section aria-labelledby={`${id}-numbers`} className="flex flex-col gap-3">
        <SectionHeading id={`${id}-numbers`} title="Key numbers">
          Measured from the transcript, not judged by the AI.
        </SectionHeading>
        <KeyNumbers card={card} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <Reveal>
          <Card
            as="section"
            aria-labelledby={`${id}-airtime`}
            className="flex flex-col gap-4 p-4 sm:p-6 print:break-inside-avoid print:shadow-none"
          >
            <div>
              <h2 id={`${id}-airtime`} className="text-lg font-semibold text-ink">
                Who held the floor
              </h2>
              <p className="mt-0.5 text-sm text-ink-2">
                Speaking time in the discussion, longest first. You took {formatPercent(metrics.airtimeShare)}; a
                fair share is about {formatPercent(FAIR_SHARE)}.
              </p>
            </div>
            <AirtimeChart metrics={metrics} record={record} />
          </Card>
        </Reveal>
        <div className="flex flex-col gap-4">
          <Reveal delay={0.08}>
            <ListCard
              icon={ThumbsUp}
              iconClass="bg-good/12 text-good"
              title="Strengths"
              items={assessment.strengths}
            />
          </Reveal>
          <Reveal delay={0.16}>
            <ListCard
              icon={TrendingUp}
              iconClass="bg-accent-soft text-accent"
              title="To work on next time"
              items={assessment.improvements}
            />
          </Reveal>
        </div>
      </div>

      <section aria-labelledby={`${id}-feedback`} className="flex flex-col gap-3">
        <SectionHeading id={`${id}-feedback`} title="Feedback by area">
          Each area is rated from 0 to 10 by the AI evaluator, with the numbers above as evidence.
        </SectionHeading>
        <AssessmentSections assessment={assessment} metrics={metrics} record={record} />
      </section>

      <Reveal>
        <TranscriptView record={record} />
      </Reveal>

      <Reveal className="print:hidden">
        <Card className="flex flex-col items-center gap-4 p-6 text-center sm:p-8">
          <div>
            <p className="text-lg font-semibold text-ink">Ready for another round?</p>
            <p className="mt-1 text-sm text-ink-2">
              Pick the improvement that matters most to you and practise just that.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" size="lg" icon={<RotateCcw aria-hidden className="size-5" />} onClick={onRestart}>
              Practise again
            </Button>
            {actions}
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

function Meta({ icon: Icon, term, children }: { icon: LucideIcon; term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-3" />
      <dt className="sr-only">{term}</dt>
      <dd className="min-w-0 wrap-break-word">{children}</dd>
    </div>
  );
}

function SectionHeading({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div>
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      <p className="text-sm text-ink-2">{children}</p>
    </div>
  );
}

function ListCard({
  icon: Icon,
  iconClass,
  title,
  items,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  items: string[];
}) {
  const id = useId();
  return (
    <Card
      as="section"
      aria-labelledby={id}
      className="flex flex-col gap-3 p-4 sm:p-5 print:break-inside-avoid print:shadow-none"
    >
      <h2 id={id} className="flex items-center gap-2.5 text-base font-semibold text-ink">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", iconClass)}>
          <Icon aria-hidden className="size-4" />
        </span>
        {title}
      </h2>
      {items.length > 0 ? (
        <ol className="flex flex-col gap-2.5">
          {items.map((item, index) => (
            <li key={index} className="flex gap-3 text-sm leading-relaxed text-ink">
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-full bg-panel-2 text-xs font-bold text-ink-2"
              >
                {index + 1}
              </span>
              <span className="min-w-0 pt-0.5 wrap-break-word">{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-2">None noted this time.</p>
      )}
    </Card>
  );
}
