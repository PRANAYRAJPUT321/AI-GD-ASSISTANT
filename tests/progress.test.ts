import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BADGE_IDS,
  BADGES,
  dayNumber,
  earnedBadges,
  MAX_HISTORY,
  parseHistory,
  progressStats,
  resultProgress,
  serializeHistory,
  type PracticeResult,
} from "@/lib/progress";
import type { Assessment, GDMetrics } from "@/lib/scoring";

const METRICS: GDMetrics = {
  inputMode: "voice",
  openedDiscussion: false,
  firstEntrySec: 40,
  entries: 1,
  cutIns: 0,
  userAirtimeSec: 20,
  totalAirtimeSec: 400,
  airtimeShare: 0.05,
  airtimeBySpeaker: {},
  longestSilenceSec: 200,
  userWords: 50,
  wordsPerMinute: 140,
  fillers: [],
  fillerTotal: 4,
  fillersPer100: 8,
  interruptionsFaced: 0,
  interruptionsHeld: 0,
  interruptionsYielded: 0,
  referencesToOthers: 0,
  summaryGiven: false,
  summaryWords: 0,
  driftTurns: 1,
};

const section = { rating: 5, comment: "Fine." };
const ASSESSMENT: Assessment = {
  overall: { score: 50, headline: "Steady", verdict: "Fine." },
  opening: section,
  participation: section,
  content: { ...section, newPoints: [], repeatedPoints: [] },
  evidence: { ...section, examples: ["one"], references: [] },
  interruptions: section,
  drift: { ...section, pulledBack: false },
  summary: section,
  delivery: section,
  strengths: [],
  improvements: [],
};

/** Local time on 2026-10-<day> at <hour>:00. */
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();

const result = (score: number, when: number, badges: PracticeResult["badges"] = []): PracticeResult => ({
  at: when,
  topic: "Quick commerce: boon or bane?",
  category: "business",
  score,
  badges,
  offline: false,
});

describe("badges", () => {
  test("every badge has its texts", () => {
    for (const id of BADGE_IDS) {
      assert.ok(BADGES[id].title && BADGES[id].earned && BADGES[id].hint, id);
    }
  });

  test("a quiet GD earns nothing", () => {
    assert.deepEqual(earnedBadges(METRICS, ASSESSMENT), []);
  });

  test("each badge follows what the candidate did", () => {
    const metrics: GDMetrics = {
      ...METRICS,
      openedDiscussion: true,
      cutIns: 2,
      entries: 4,
      airtimeShare: 0.2,
      referencesToOthers: 1,
      interruptionsHeld: 1,
      summaryGiven: true,
      summaryWords: 60,
      userWords: 300,
      fillersPer100: 1.5,
    };
    const assessment: Assessment = {
      ...ASSESSMENT,
      evidence: { ...section, examples: ["a", "b"], references: [] },
      drift: { ...section, pulledBack: true },
    };
    assert.deepEqual(earnedBadges(metrics, assessment), [...BADGE_IDS]);
  });

  test("near misses don't count", () => {
    const metrics: GDMetrics = {
      ...METRICS,
      entries: 1, // one entry is not a fair share even at 20%
      airtimeShare: 0.2,
      summaryGiven: true,
      summaryWords: 25, // too short to be a summary
      userWords: 60, // too few words to judge fillers
      fillersPer100: 0,
    };
    assert.deepEqual(earnedBadges(metrics, ASSESSMENT), []);
    assert.deepEqual(earnedBadges({ ...METRICS, entries: 3, airtimeShare: 0.45 }, ASSESSMENT), []);
  });
});

describe("history storage", () => {
  test("round-trips, sorts oldest first and keeps the newest MAX_HISTORY", () => {
    const many = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => result(i, 1000 + i));
    const parsed = parseHistory(serializeHistory([...many].reverse()));
    assert.equal(parsed.length, MAX_HISTORY);
    assert.equal(parsed[0].score, 5);
    assert.equal(parsed.at(-1)?.score, MAX_HISTORY + 4);
  });

  test("drops anything unreadable and unknown badges", () => {
    assert.deepEqual(parseHistory(null), []);
    assert.deepEqual(parseHistory("not json"), []);
    assert.deepEqual(parseHistory('{"score": 5}'), []);
    const raw = JSON.stringify([
      { ...result(70, 5), badges: ["opener", "made-up"] },
      { at: 6, topic: "x", category: "sports", score: 50, badges: [], offline: false },
      { at: 7, topic: "x", category: "abstract", score: 140, badges: [], offline: false },
    ]);
    const parsed = parseHistory(raw);
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0].badges, ["opener"]);
  });
});

describe("stats", () => {
  test("empty history", () => {
    const stats = progressStats([], at(25));
    assert.equal(stats.total, 0);
    assert.equal(stats.bestScore, null);
    assert.equal(stats.lastScore, null);
    assert.equal(stats.streakDays, 0);
    assert.equal(stats.practicedToday, false);
  });

  test("a streak counts consecutive days ending today, or yesterday until today has a GD", () => {
    const history = [result(40, at(21)), result(45, at(23, 9)), result(52, at(23, 21)), result(48, at(24))];
    const yesterday = progressStats(history, at(25, 8));
    assert.equal(yesterday.streakDays, 2, "23rd and 24th; today is still open");
    assert.equal(yesterday.practicedToday, false);
    const today = progressStats([...history, result(60, at(25, 9))], at(25, 10));
    assert.equal(today.streakDays, 3);
    assert.equal(today.practicedToday, true);
    assert.equal(progressStats(history, at(26)).streakDays, 0, "a missed day breaks it");
  });

  test("days are calendar days, not 24-hour windows", () => {
    assert.equal(dayNumber(at(24, 23)) + 1, dayNumber(at(25, 0)));
    assert.equal(progressStats([result(50, at(24, 23)), result(55, at(25, 0))], at(25, 1)).streakDays, 2);
  });

  test("best, last, previous, recent scores and collected badges", () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      result(30 + i * 3, at(1 + i), i === 3 ? ["closer", "opener"] : []),
    );
    const stats = progressStats(history, at(13));
    assert.equal(stats.total, 12);
    assert.equal(stats.bestScore, 63);
    assert.equal(stats.lastScore, 63);
    assert.equal(stats.previousScore, 60);
    assert.equal(stats.recentScores.length, 10);
    assert.equal(stats.recentScores[0], 36);
    assert.deepEqual(stats.badges, ["opener", "closer"]);
  });
});

describe("what a finished GD changed", () => {
  test("the first GD", () => {
    const progress = resultProgress([], result(44, at(25), ["opener"]));
    assert.deepEqual(progress, {
      delta: null,
      personalBest: false,
      firstGD: true,
      total: 1,
      streakDays: 1,
      newBadges: ["opener"],
    });
  });

  test("delta against the last GD, personal best against all of them, only new badges", () => {
    const before = [result(62, at(23), ["opener"]), result(48, at(24), ["closer"])];
    const progress = resultProgress(before, result(63, at(25), ["opener", "fearless", "closer"]));
    assert.equal(progress.delta, 15);
    assert.equal(progress.personalBest, true);
    assert.equal(progress.firstGD, false);
    assert.equal(progress.total, 3);
    assert.equal(progress.streakDays, 3);
    assert.deepEqual(progress.newBadges, ["fearless"]);

    const tie = resultProgress(before, result(62, at(25)));
    assert.equal(tie.personalBest, false, "equalling the best is not a new best");
    assert.equal(tie.delta, 14);
  });
});
