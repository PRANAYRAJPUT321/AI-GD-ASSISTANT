// Practice progress kept on this device: a short history of finished GDs, the badges each one
// earned, and what the setup screen and scorecard show from it (streak, best, trend, new
// badges). Pure functions only; reading and writing localStorage lives in components/progress.

import { z } from "zod";
import type { Assessment, GDMetrics } from "./scoring";
import type { TopicCategory } from "./types";

// ---------- Badges ----------

export const BADGE_IDS = [
  "opener",
  "fearless",
  "fair-share",
  "data-driven",
  "bridge-builder",
  "held-ground",
  "anchor",
  "closer",
  "smooth",
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

export interface BadgeText {
  title: string;
  /** What the candidate did to earn it, shown when earned. */
  earned: string;
  /** How to earn it, shown while it is still locked. */
  hint: string;
}

export const BADGES: Record<BadgeId, BadgeText> = {
  opener: {
    title: "Opener",
    earned: "You opened the discussion.",
    hint: "Speak first when the moderator says you may begin.",
  },
  fearless: {
    title: "Fearless",
    earned: "You cut in on a speaker to take the floor.",
    hint: "Press Jump in while someone else is talking.",
  },
  "fair-share": {
    title: "Fair share",
    earned: "Your airtime was close to a fair share.",
    hint: "Enter at least twice and take 12–30% of the speaking time.",
  },
  "data-driven": {
    title: "Data-driven",
    earned: "You backed your points with examples or data.",
    hint: "Use at least two examples, numbers or cases.",
  },
  "bridge-builder": {
    title: "Bridge builder",
    earned: "You built on what others said.",
    hint: "Refer to someone by name, e.g. “As Meera said…”.",
  },
  "held-ground": {
    title: "Held your ground",
    earned: "You kept the floor when someone talked over you.",
    hint: "Keep talking when someone interrupts you.",
  },
  anchor: {
    title: "Anchor",
    earned: "You pulled the discussion back on topic.",
    hint: "When the talk drifts, steer it back to the topic.",
  },
  closer: {
    title: "Closer",
    earned: "You gave a proper closing summary.",
    hint: "Sum up both sides and conclude when the moderator asks.",
  },
  smooth: {
    title: "Smooth talker",
    earned: "You kept filler words to a minimum.",
    hint: "Say at least 80 words with under 3 fillers per 100.",
  },
};

/** The badges a finished GD earned, in BADGE_IDS order. */
export function earnedBadges(metrics: GDMetrics, assessment: Assessment): BadgeId[] {
  const earned: Record<BadgeId, boolean> = {
    opener: metrics.openedDiscussion,
    fearless: metrics.cutIns >= 1,
    "fair-share": metrics.entries >= 2 && metrics.airtimeShare >= 0.12 && metrics.airtimeShare <= 0.3,
    "data-driven": assessment.evidence.examples.length >= 2,
    "bridge-builder": metrics.referencesToOthers >= 1 || assessment.evidence.references.length >= 1,
    "held-ground": metrics.interruptionsHeld >= 1,
    anchor: assessment.drift.pulledBack === true,
    closer: metrics.summaryGiven && metrics.summaryWords >= 40,
    smooth: metrics.userWords >= 80 && metrics.fillersPer100 < 3,
  };
  return BADGE_IDS.filter((id) => earned[id]);
}

// ---------- History ----------

/** One finished GD, as remembered on this device. */
export interface PracticeResult {
  /** When it was scored (epoch ms). */
  at: number;
  topic: string;
  category: TopicCategory;
  /** Overall score, 0..100. */
  score: number;
  badges: BadgeId[];
  /** Scored in practice mode (no AI evaluator). */
  offline: boolean;
}

/** How many results are kept; older ones drop off. */
export const MAX_HISTORY = 60;

const ResultSchema = z.object({
  at: z.number().finite(),
  topic: z.string().max(300),
  category: z.enum(["business", "current-affairs", "abstract"]),
  score: z.number().min(0).max(100),
  badges: z.array(z.string()).transform((ids) => BADGE_IDS.filter((id) => ids.includes(id))),
  offline: z.boolean(),
});

/** The stored history, oldest first. Anything unreadable is dropped rather than thrown. */
export function parseHistory(raw: string | null): PracticeResult[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const results: PracticeResult[] = [];
  for (const item of data) {
    const parsed = ResultSchema.safeParse(item);
    if (parsed.success) results.push(parsed.data);
  }
  return results.sort((a, b) => a.at - b.at).slice(-MAX_HISTORY);
}

/** The history as stored: oldest first, the newest MAX_HISTORY results. */
export function serializeHistory(results: readonly PracticeResult[]): string {
  return JSON.stringify([...results].sort((a, b) => a.at - b.at).slice(-MAX_HISTORY));
}

// ---------- Stats ----------

/** A local calendar day as a whole number, so consecutive days differ by one (DST-safe). */
export function dayNumber(ms: number): number {
  const date = new Date(ms);
  return Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);
}

export interface ProgressStats {
  total: number;
  bestScore: number | null;
  lastScore: number | null;
  /** The score before the last one, for its trend; null with fewer than two GDs. */
  previousScore: number | null;
  /** Up to the last 10 scores, oldest first. */
  recentScores: number[];
  /** Consecutive days with a GD, ending today, or yesterday if today has none yet. */
  streakDays: number;
  practicedToday: boolean;
  /** Every badge earned at least once, in BADGE_IDS order. */
  badges: BadgeId[];
}

export function progressStats(history: readonly PracticeResult[], now: number): ProgressStats {
  const days = new Set(history.map((result) => dayNumber(result.at)));
  const today = dayNumber(now);
  const practicedToday = days.has(today);
  let streakDays = 0;
  for (let day = practicedToday ? today : today - 1; days.has(day); day--) streakDays++;

  const scores = history.map((result) => result.score);
  const collected = new Set(history.flatMap((result) => result.badges));
  return {
    total: history.length,
    bestScore: scores.length ? Math.max(...scores) : null,
    lastScore: scores.at(-1) ?? null,
    previousScore: scores.length >= 2 ? scores[scores.length - 2] : null,
    recentScores: scores.slice(-10),
    streakDays,
    practicedToday,
    badges: BADGE_IDS.filter((id) => collected.has(id)),
  };
}

/** What a just-finished GD changed, for the scorecard. */
export interface ResultProgress {
  /** Change from the previous GD's score; null on the first GD. */
  delta: number | null;
  /** Beat every earlier score (never on the first GD). */
  personalBest: boolean;
  firstGD: boolean;
  /** GDs finished on this device, including this one. */
  total: number;
  /** The streak including this GD. */
  streakDays: number;
  /** Badges this GD earned for the first time. */
  newBadges: BadgeId[];
}

export function resultProgress(before: readonly PracticeResult[], result: PracticeResult): ResultProgress {
  const previous = before.at(-1);
  const bestBefore = before.length ? Math.max(...before.map((r) => r.score)) : null;
  const collected = new Set(before.flatMap((r) => r.badges));
  return {
    delta: previous ? Math.round(result.score - previous.score) : null,
    personalBest: bestBefore !== null && result.score > bestBefore,
    firstGD: before.length === 0,
    total: before.length + 1,
    streakDays: progressStats([...before, result], result.at).streakDays,
    newBadges: result.badges.filter((id) => !collected.has(id)),
  };
}
