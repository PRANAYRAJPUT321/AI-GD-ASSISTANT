// Deterministic GD metrics, computed from the transcript alone (no AI).
// Used by /api/score (fed to the evaluator as ground truth) and by the scorecard.
// Pure: same record in, same numbers out.

import { castFor } from "./personas";
import type { ComputeMetrics, FillerCount, GDMetrics } from "./scoring";
import { PERSONA_IDS, type GDRecord, type PersonaId, type Turn } from "./types";

/**
 * Filler words and phrases, as listed in the design spec. Multi-word phrases are
 * matched before single words (see FILLER_MATCHERS) so "you know" is never also
 * counted as something shorter.
 */
export const FILLERS = [
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "erm",
  "like",
  "basically",
  "actually",
  "literally",
  "you know",
  "i mean",
  "sort of",
  "kind of",
  "so yeah",
  "right?",
  "okay so",
] as const;

/** Below this much measured speech, a words-per-minute figure is noise. */
const MIN_WPM_SPEECH_SEC = 20;
/** A closing summary needs at least this many words to count as given. */
const MIN_SUMMARY_WORDS = 15;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word/phrase matchers, longest phrases first; ties keep the spec order. */
const FILLER_MATCHERS: { word: string; pattern: RegExp }[] = FILLERS.map((word, order) => {
  const tokens = word.split(" ");
  // Words in a phrase may be separated by spaces or a comma ("okay, so").
  const body = tokens.map(escapeRegExp).join("[\\s,]+");
  // "right?" ends in punctuation, so it needs no trailing word boundary.
  const tail = /\w$/.test(word) ? "(?![\\w'])" : "";
  return { word, order, size: tokens.length, pattern: new RegExp(`(?<![\\w'])${body}${tail}`, "gi") };
})
  .sort((a, b) => b.size - a.size || a.order - b.order)
  .map(({ word, pattern }) => ({ word, pattern }));

/** Words in a piece of speech: whitespace-separated tokens with at least one letter or digit. */
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) n++;
  return n;
}

/** Counts fillers in one text. Each matched span is blanked out so it is never counted twice. */
function countFillersIn(text: string, into: Map<string, number>): void {
  let rest = text.toLowerCase();
  for (const { word, pattern } of FILLER_MATCHERS) {
    rest = rest.replace(pattern, () => {
      into.set(word, (into.get(word) ?? 0) + 1);
      return " \u0000 ";
    });
  }
}

const round = (n: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const durationMs = (t: Turn) => Math.max(0, t.endMs - t.startMs);

/** Transcript in time order; ties keep the recorded order (stable sort). */
function chronological(transcript: Turn[]): Turn[] {
  return transcript
    .map((turn, index) => ({ turn, index }))
    .sort((a, b) => a.turn.startMs - b.turn.startMs || a.index - b.index)
    .map(({ turn }) => turn);
}

/** Longest stretch of the discussion window not covered by any candidate turn (ms). */
function longestGapMs(windowStart: number, windowEnd: number, userTurns: Turn[]): number {
  if (windowEnd <= windowStart) return 0;
  const spans = userTurns
    .map((t) => [Math.max(t.startMs, windowStart), Math.min(t.endMs, windowEnd)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let longest = 0;
  let cursor = windowStart;
  for (const [s, e] of spans) {
    if (s > cursor) longest = Math.max(longest, s - cursor);
    cursor = Math.max(cursor, e);
  }
  return Math.max(longest, windowEnd - cursor);
}

export const computeMetrics: ComputeMetrics = (record: GDRecord): GDMetrics => {
  const cast = castFor(record.config.userName);
  const transcript = chronological(record.transcript);
  const isAi = (t: Turn): t is Turn & { speaker: PersonaId } =>
    t.speaker !== "user" && t.speaker !== "moderator";

  const discussion = transcript.filter((t) => t.phase === "discussion");
  const participants = discussion.filter((t) => t.speaker !== "moderator");
  const userDiscussion = discussion.filter((t) => t.speaker === "user");
  const userTurns = transcript.filter((t) => t.speaker === "user");
  const entryTurns = userDiscussion.filter((t) => t.continuation !== true);

  // ---- Entries ----
  const openedDiscussion = participants[0]?.speaker === "user";
  const firstEntry = userDiscussion[0];
  const firstEntrySec = firstEntry
    ? round(Math.max(0, firstEntry.startMs - record.discussionStartMs) / 1000)
    : null;
  // A cut-in: the candidate's entry comes straight after an AI turn they cut off.
  let cutIns = 0;
  transcript.forEach((turn, i) => {
    if (!entryTurns.includes(turn)) return;
    const before = transcript[i - 1];
    if (before && isAi(before) && before.interruptedBy === "user") cutIns++;
  });

  // ---- Airtime (discussion phase; interjections count for whoever made them) ----
  const airtimeMs: Record<PersonaId | "user", number> = { user: 0, dominator: 0, data: 0, agreer: 0, drifter: 0, smart: 0 };
  for (const t of participants) airtimeMs[t.speaker as PersonaId | "user"] += durationMs(t);
  const totalAirtimeMs = Object.values(airtimeMs).reduce((a, b) => a + b, 0);
  const airtimeBySpeaker: GDMetrics["airtimeBySpeaker"] = { user: round(airtimeMs.user / 1000) };
  for (const id of PERSONA_IDS) airtimeBySpeaker[id] = round(airtimeMs[id] / 1000);

  // ---- Words, pace, fillers (all candidate turns, summary included) ----
  const userWords = userTurns.reduce((n, t) => n + countWords(t.text), 0);
  const allTyped = userTurns.length > 0 && userTurns.every((t) => t.typed === true);
  const inputMode = record.config.inputMode === "text" || allTyped ? "text" : "voice";
  const spoken = userTurns.filter((t) => t.typed !== true);
  const spokenSec = spoken.reduce((n, t) => n + durationMs(t), 0) / 1000;
  const spokenWords = spoken.reduce((n, t) => n + countWords(t.text), 0);
  const wordsPerMinute =
    inputMode === "text" || spokenSec < MIN_WPM_SPEECH_SEC ? null : Math.round(spokenWords / (spokenSec / 60));

  const fillerCounts = new Map<string, number>();
  for (const t of userTurns) countFillersIn(t.text, fillerCounts);
  const fillers: FillerCount[] = FILLERS.filter((word) => fillerCounts.has(word))
    .map((word) => ({ word, count: fillerCounts.get(word) ?? 0 }))
    .sort((a, b) => b.count - a.count); // stable: equal counts keep the spec order
  const fillerTotal = fillers.reduce((n, f) => n + f.count, 0);

  // ---- Interruptions, references, summary, drift ----
  const outcomes = record.interruptions.map((e) => e.outcome);
  const namePatterns = PERSONA_IDS.map(
    (id) => new RegExp(`(?<![\\p{L}])${escapeRegExp(cast[id].name)}(?![\\p{L}])`, "iu"),
  );
  const referencesToOthers = userTurns.filter((t) => namePatterns.some((p) => p.test(t.text))).length;
  const summaryWords = userTurns
    .filter((t) => t.phase === "summary")
    .reduce((n, t) => n + countWords(t.text), 0);

  return {
    inputMode,
    openedDiscussion,
    firstEntrySec,
    entries: entryTurns.length,
    cutIns,
    userAirtimeSec: round(airtimeMs.user / 1000),
    totalAirtimeSec: round(totalAirtimeMs / 1000),
    airtimeShare: totalAirtimeMs > 0 ? round(airtimeMs.user / totalAirtimeMs, 3) : 0,
    airtimeBySpeaker,
    longestSilenceSec: round(
      longestGapMs(record.discussionStartMs, record.discussionEndMs, userDiscussion) / 1000,
    ),
    userWords,
    wordsPerMinute,
    fillers,
    fillerTotal,
    fillersPer100: userWords > 0 ? round((fillerTotal / userWords) * 100) : 0,
    interruptionsFaced: outcomes.length,
    interruptionsHeld: outcomes.filter((o) => o === "held").length,
    interruptionsYielded: outcomes.filter((o) => o === "yielded").length,
    referencesToOthers,
    summaryGiven: summaryWords >= MIN_SUMMARY_WORDS,
    summaryWords,
    driftTurns: discussion.filter((t) => t.speaker === "drifter").length,
  };
};
