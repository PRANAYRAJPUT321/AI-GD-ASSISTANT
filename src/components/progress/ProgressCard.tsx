"use client";

import { Flame, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { BADGE_IDS, BADGES, progressStats, type BadgeId, type ProgressStats } from "@/lib/progress";
import { Card, Eyebrow } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { BadgeIcon } from "./BadgeIcon";
import { Sparkline } from "./Sparkline";
import { useHistory } from "./storage";

/**
 * The candidate's progress on this device: streak, scores and badges collected, or an invite
 * to start one before the first GD. Renders a same-size placeholder until hydrated, since the
 * history only exists in the browser.
 */
export function ProgressCard() {
  const history = useHistory();
  // The clock is read once: the card doesn't need to roll over at midnight while open.
  const [now] = useState(() => Date.now());
  const id = useId();

  if (history === null) {
    return <Card aria-hidden className="h-[13.5rem] animate-pulse bg-panel/60 motion-reduce:animate-none sm:h-40" />;
  }
  const stats = progressStats(history, now);

  return (
    <Card as="section" aria-labelledby={`${id}-title`} className="relative overflow-hidden p-4 sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-accent/10 blur-3xl"
      />
      {stats.total === 0 ? <FirstVisit id={id} /> : <Returning id={id} stats={stats} />}
      <BadgeShelf earned={stats.badges} />
    </Card>
  );
}

function FirstVisit({ id }: { id: string }) {
  return (
    <div className="relative flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <Sparkles aria-hidden className="size-5" />
      </span>
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
          Your progress lives here
        </h2>
        <p className="text-sm text-ink-2">
          Finish your first GD to start a streak, track your score and collect the nine badges below.
        </p>
      </div>
    </div>
  );
}

function streakLine(stats: ProgressStats): string {
  if (stats.streakDays === 0) return "Practise today to start a new streak.";
  if (!stats.practicedToday) return `Practise today to make it ${stats.streakDays + 1} days.`;
  return stats.streakDays === 1 ? "Come back tomorrow to build a streak." : "You've practised today. Keep it going!";
}

function Returning({ id, stats }: { id: string; stats: ProgressStats }) {
  const trend = stats.lastScore !== null && stats.previousScore !== null ? stats.lastScore - stats.previousScore : null;
  const alive = stats.streakDays > 0;
  return (
    <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex items-center gap-3 sm:min-w-56">
        <motion.span
          initial={{ scale: 0.6, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 14, delay: 0.1 }}
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-2xl",
            alive ? "bg-linear-to-br from-[#f97316] to-[#e5484d] text-white shadow-card" : "bg-panel-2 text-ink-3",
          )}
        >
          <Flame aria-hidden className="size-6" fill={alive ? "currentColor" : "none"} />
        </motion.span>
        <div className="min-w-0">
          <Eyebrow>Your progress</Eyebrow>
          <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight text-ink">
            {stats.streakDays}-day streak
          </h2>
          <p className="text-xs text-ink-2">{streakLine(stats)}</p>
        </div>
      </div>

      <dl className="grid flex-1 grid-cols-3 gap-2">
        <Stat term="GDs done" value={String(stats.total)} />
        <Stat term="Best" value={stats.bestScore === null ? "–" : String(stats.bestScore)} />
        <Stat
          term="Last"
          value={stats.lastScore === null ? "–" : String(stats.lastScore)}
          extra={trend !== null && trend !== 0 ? <Trend delta={trend} /> : null}
        />
      </dl>

      {stats.recentScores.length > 1 && (
        <div className="flex flex-col gap-1 sm:w-36">
          <span className="text-xs font-semibold text-ink-2">Score trend</span>
          <Sparkline scores={stats.recentScores} className="h-11 w-full max-w-48 sm:max-w-none" />
        </div>
      )}
    </div>
  );
}

function Stat({ term, value, extra }: { term: string; value: string; extra?: ReactNode }) {
  return (
    <div className="rounded-xl bg-panel-2/70 px-3 py-2">
      <dt className="text-xs font-semibold text-ink-2">{term}</dt>
      <dd className="flex items-baseline gap-1.5 text-2xl font-bold tabular-nums tracking-tight text-ink">
        {value}
        {extra}
      </dd>
    </div>
  );
}

function Trend({ delta }: { delta: number }) {
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", up ? "text-good" : "text-ink-2")}>
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{up ? "up" : "down"} </span>
      {Math.abs(delta)}
    </span>
  );
}

/** All nine badges: collected ones in colour, the rest locked with how to earn them. */
function BadgeShelf({ earned }: { earned: readonly BadgeId[] }) {
  const id = useId();
  const have = new Set(earned);
  return (
    <div className="relative mt-4 border-t border-line pt-3">
      <p id={id} className="mb-2 text-xs font-semibold text-ink-2">
        Badges collected · {earned.length} of {BADGE_IDS.length}
      </p>
      <ul aria-labelledby={id} className="grid grid-cols-5 gap-x-1 gap-y-3 sm:grid-cols-9">
        {BADGE_IDS.map((badge, index) => {
          const got = have.has(badge);
          const text = BADGES[badge];
          return (
            <motion.li
              key={badge}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + index * 0.04, duration: 0.3 }}
              title={`${text.title}: ${got ? text.earned : text.hint}`}
              className="flex min-w-0 flex-col items-center gap-1 text-center"
            >
              <BadgeIcon id={badge} earned={got} />
              <span className={cn("w-full truncate text-[11px] font-medium", got ? "text-ink" : "text-ink-3")}>
                {text.title}
              </span>
              <span className="sr-only">{got ? "Collected." : `Locked. ${text.hint}`}</span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
