"use client";

import {
  AudioLines,
  BookOpen,
  CircleCheck,
  CircleMinus,
  CircleX,
  Compass,
  Hand,
  Lightbulb,
  Link2,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Plus,
  Quote,
  Repeat2,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { castFor } from "@/lib/personas";
import {
  ASSESSMENT_SECTIONS,
  SECTION_LABELS,
  type Assessment,
  type AssessmentSection,
  type GDMetrics,
} from "@/lib/scoring";
import type { GDRecord } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { plural } from "./format";
import { PRINT_SETTLED, Reveal } from "./Reveal";

const SECTION_ICONS: Record<AssessmentSection, LucideIcon> = {
  opening: Megaphone,
  participation: MessagesSquare,
  content: Lightbulb,
  evidence: BookOpen,
  interruptions: Hand,
  drift: Compass,
  summary: ListChecks,
  delivery: AudioLines,
};

/** Sections with two lists side by side get the full width on large screens. */
const WIDE_SECTIONS: ReadonlySet<AssessmentSection> = new Set(["content", "evidence"]);

const RATING_STEPS = Array.from({ length: 10 }, (_, index) => index);

/** The eight assessed areas, each with its rating, comment and any lists. */
export function AssessmentSections({
  assessment,
  metrics,
  record,
}: {
  assessment: Assessment;
  metrics: GDMetrics;
  record: GDRecord;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {ASSESSMENT_SECTIONS.map((section, index) => (
        <Reveal
          key={section}
          delay={(index % 2) * 0.08}
          className={cn("min-w-0", WIDE_SECTIONS.has(section) && "lg:col-span-2")}
        >
          <SectionCard section={section} rating={assessment[section].rating} comment={assessment[section].comment}>
            <SectionExtras section={section} assessment={assessment} metrics={metrics} record={record} />
          </SectionCard>
        </Reveal>
      ))}
    </div>
  );
}

function SectionCard({
  section,
  rating,
  comment,
  children,
}: {
  section: AssessmentSection;
  rating: number;
  comment: string;
  children: ReactNode;
}) {
  const id = useId();
  const Icon = SECTION_ICONS[section];
  return (
    <Card
      as="section"
      aria-labelledby={`${id}-title`}
      className="flex h-full flex-col gap-3 p-4 sm:p-5 print:break-inside-avoid print:shadow-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={`${id}-title`} className="flex items-center gap-2.5 text-base font-semibold text-ink">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Icon aria-hidden className="size-4" />
          </span>
          {SECTION_LABELS[section]}
        </h3>
        <p className="shrink-0 pt-1 text-sm text-ink-2">
          <span className="text-lg font-bold text-ink">{rating}</span>
          <span aria-hidden>/10</span>
          <span className="sr-only"> out of 10</span>
        </p>
      </div>
      <RatingBar rating={rating} />
      <p className="text-[0.9375rem] leading-relaxed text-ink-2 wrap-break-word">{comment}</p>
      {children}
    </Card>
  );
}

/** Ten segments, the first `rating` filled, so the rating also reads as a count. */
function RatingBar({ rating }: { rating: number }) {
  return (
    <div aria-hidden className="grid grid-cols-10 gap-0.5 [print-color-adjust:exact]">
      {RATING_STEPS.map((step) => (
        <span key={step} className="relative h-2 overflow-hidden rounded-[3px] bg-accent-soft">
          {step < rating && (
            <motion.span
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.25, delay: 0.2 + step * 0.06 }}
              className={cn("absolute inset-0 bg-accent", PRINT_SETTLED)}
            />
          )}
        </span>
      ))}
    </div>
  );
}

function SectionExtras({
  section,
  assessment,
  metrics,
  record,
}: {
  section: AssessmentSection;
  assessment: Assessment;
  metrics: GDMetrics;
  record: GDRecord;
}) {
  switch (section) {
    case "content":
      return (
        <ListPair>
          <PointList icon={Plus} title="New points" items={assessment.content.newPoints} />
          <PointList icon={Repeat2} title="Repeated points" items={assessment.content.repeatedPoints} />
        </ListPair>
      );
    case "evidence":
      return (
        <ListPair>
          <PointList icon={Quote} title="Examples & data" items={assessment.evidence.examples} />
          <PointList icon={Link2} title="Building on others" items={assessment.evidence.references} />
        </ListPair>
      );
    case "drift":
      return <DriftOutcome pulledBack={assessment.drift.pulledBack} metrics={metrics} record={record} />;
    default:
      return null;
  }
}

function ListPair({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function PointList({ icon: Icon, title, items }: { icon: LucideIcon; title: string; items: string[] }) {
  return (
    <div className="rounded-xl bg-panel-2 p-3 [print-color-adjust:exact]">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">
        <Icon aria-hidden className="size-3.5" />
        {title} <span className="font-medium normal-case tracking-normal">({items.length})</span>
      </h4>
      {items.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2 text-sm leading-snug text-ink wrap-break-word">
              <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-ink-3" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-2">None noted.</p>
      )}
    </div>
  );
}

function DriftOutcome({
  pulledBack,
  metrics,
  record,
}: {
  pulledBack: boolean | null;
  metrics: GDMetrics;
  record: GDRecord;
}) {
  const drifter = castFor(record.config.userName).drifter.name;
  const outcome =
    pulledBack === null
      ? { icon: CircleMinus, tone: "text-ink-2", label: "Not applicable: there was no drift to pull back" }
      : pulledBack
        ? { icon: CircleCheck, tone: "text-good", label: "Yes, you pulled the group back" }
        : { icon: CircleX, tone: "text-warn", label: "No, the drift went unchallenged" };
  const Icon = outcome.icon;
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-panel-2 p-3 text-sm [print-color-adjust:exact]">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <Icon aria-hidden className={cn("size-4 shrink-0", outcome.tone)} />
        <span>
          <span className="sr-only">Pulled back the drift: </span>
          {outcome.label}
        </span>
      </p>
      <p className="text-ink-2">
        {metrics.driftTurns > 0
          ? `${drifter} went off-topic ${plural(metrics.driftTurns, "time")}.`
          : `${drifter} stayed on topic this time.`}
      </p>
    </div>
  );
}
