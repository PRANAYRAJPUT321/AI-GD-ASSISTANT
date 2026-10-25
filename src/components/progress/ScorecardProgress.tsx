"use client";

import { Flame, Minus, Sparkles, TrendingDown, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useId } from "react";
import { BADGE_IDS, BADGES, type BadgeId, type ResultProgress } from "@/lib/progress";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { tint } from "@/components/ui/style";
import { PRINT_SETTLED } from "@/components/scorecard/Reveal";
import { BADGE_LOOK, BadgeIcon } from "./BadgeIcon";

/** How many locked badges to suggest for next time. */
const NEXT_TIME = 3;

/** Small chips under the verdict: a new best, the change since last time, the streak. */
export function ProgressChips({ progress }: { progress: ResultProgress }) {
  const chips: { key: string; icon: LucideIcon; text: string; color: string }[] = [];
  if (progress.personalBest) chips.push({ key: "best", icon: Trophy, text: "New personal best!", color: "#eab308" });
  if (progress.firstGD) chips.push({ key: "first", icon: Sparkles, text: "First GD done", color: "var(--accent)" });
  if (progress.delta !== null) {
    const { delta } = progress;
    chips.push(
      delta > 0
        ? { key: "delta", icon: TrendingUp, text: `+${delta} vs your last GD`, color: "var(--good)" }
        : delta < 0
          ? { key: "delta", icon: TrendingDown, text: `${delta} vs your last GD`, color: "var(--ink-2)" }
          : { key: "delta", icon: Minus, text: "Same as your last GD", color: "var(--ink-2)" },
    );
  }
  if (progress.streakDays >= 2) {
    chips.push({ key: "streak", icon: Flame, text: `${progress.streakDays}-day streak`, color: "#f97316" });
  }
  if (chips.length === 0) return null;

  return (
    <ul aria-label="Your progress" className="flex flex-wrap justify-center gap-2 sm:justify-start">
      {chips.map((chip, index) => (
        <motion.li
          key={chip.key}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 1.2 + index * 0.12 }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold text-ink",
            PRINT_SETTLED,
          )}
          style={{ borderColor: tint(chip.color, 45), background: tint(chip.color, 12) }}
        >
          <chip.icon aria-hidden className="size-3.5" style={{ color: chip.color }} />
          {chip.text}
        </motion.li>
      ))}
    </ul>
  );
}

/**
 * The badges this GD earned, popping in one by one (with a "New" tag the first time), and a
 * few locked ones with what to do to earn them next time.
 */
export function BadgesEarned({ earned, fresh }: { earned: readonly BadgeId[]; fresh: readonly BadgeId[] }) {
  const id = useId();
  const have = new Set(earned);
  const isNew = new Set(fresh);
  const locked = BADGE_IDS.filter((badge) => !have.has(badge));

  return (
    <Card as="section" aria-labelledby={id} className="flex flex-col gap-4 p-4 sm:p-6 print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {earned.length > 0 ? "Badges earned" : "No badges this time"}
        </h2>
        <p className="text-sm text-ink-2">
          {earned.length} of {BADGE_IDS.length} in this GD
        </p>
      </div>

      {earned.length > 0 && (
        <ul className="grid gap-3 min-[30rem]:grid-cols-2 lg:grid-cols-3">
          {earned.map((badge, index) => (
            <motion.li
              key={badge}
              // Each badge flips over like a card being turned face up.
              initial={{ opacity: 0, rotateY: -100, scale: 0.85 }}
              whileInView={{ opacity: 1, rotateY: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.2 + index * 0.16 }}
              className={cn("relative flex items-center gap-3 rounded-xl border p-3 backface-hidden", PRINT_SETTLED)}
              style={{
                transformPerspective: 900,
                borderColor: tint(BADGE_LOOK[badge].color, 40),
                background: `linear-gradient(135deg, ${tint(BADGE_LOOK[badge].color, 14)}, ${tint(BADGE_LOOK[badge].color, 4)})`,
                boxShadow: `0 10px 24px -14px ${tint(BADGE_LOOK[badge].color, 80)}`,
              }}
            >
              <BadgeIcon id={badge} earned size="lg" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 font-semibold text-ink">
                  {BADGES[badge].title}
                  {isNew.has(badge) && (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink">
                      New
                    </span>
                  )}
                </p>
                <p className="text-sm leading-snug text-ink-2">{BADGES[badge].earned}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {locked.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">
            {earned.length > 0 ? "Go for next time" : "Try for these next time"}
          </p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {locked.slice(0, NEXT_TIME).map((badge) => (
              <li key={badge} className="flex items-center gap-3 rounded-xl border border-dashed border-line p-2.5">
                <BadgeIcon id={badge} earned={false} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{BADGES[badge].title}</p>
                  <p className="text-xs leading-snug text-ink-2">{BADGES[badge].hint}</p>
                </div>
              </li>
            ))}
          </ul>
          {locked.length > NEXT_TIME && (
            <p className="mt-2 text-xs text-ink-2">
              +{locked.length - NEXT_TIME} more to collect. See them all on the start screen.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

