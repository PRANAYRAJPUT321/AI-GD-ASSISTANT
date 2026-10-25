"use client";

import { useMemo } from "react";
import {
  earnedBadges,
  parseHistory,
  resultProgress,
  serializeHistory,
  type PracticeResult,
  type ResultProgress,
} from "@/lib/progress";
import type { Scorecard } from "@/lib/scoring";
import { readStored, useHydrated, useStoredString, writeStored } from "@/components/ui/hooks";

/** Where this device keeps its practice history. */
export const HISTORY_KEY = "gd-arena:history";

/** The practice history on this device, oldest first; null on the server and during hydration. */
export function useHistory(): PracticeResult[] | null {
  const raw = useStoredString(HISTORY_KEY);
  const hydrated = useHydrated();
  return useMemo(() => (hydrated ? parseHistory(raw) : null), [hydrated, raw]);
}

/**
 * Remembers a scored GD on this device and returns what it changed, or null when the
 * candidate never spoke (nothing worth tracking). Call it once, when the scorecard opens.
 */
export function recordResult(card: Scorecard, now = Date.now()): ResultProgress | null {
  if (card.metrics.userWords === 0) return null;
  const { topic } = card.record.config;
  const result: PracticeResult = {
    at: now,
    topic: topic.title.slice(0, 300),
    category: topic.category,
    score: Math.min(100, Math.max(0, Math.round(card.assessment.overall.score))),
    badges: earnedBadges(card.metrics, card.assessment),
    offline: card.offline === true,
  };
  const before = parseHistory(readStored(HISTORY_KEY));
  writeStored(HISTORY_KEY, serializeHistory([...before, result]));
  return resultProgress(before, result);
}
