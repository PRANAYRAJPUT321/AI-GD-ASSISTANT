// Plain-text helpers for the finished transcript: clock labels, the downloadable .txt
// and the filler-word marking used by the scorecard. Pure (no DOM), so they are unit tested.

import { FILLERS } from "./metrics";
import { castFor, speakerName } from "./personas";
import { CATEGORY_LABELS } from "./topics";
import { PERSONA_IDS, type GDRecord, type SpeakerId, type Topic, type Turn } from "./types";

/** "m:ss" for a duration in ms, rounded down to the second. Negative or invalid → "0:00". */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Custom topics carry a `custom:` id (see customTopic in topics.ts). */
export function topicCategoryLabel(topic: Topic): string {
  return topic.id.startsWith("custom:") ? "Your own topic" : CATEGORY_LABELS[topic.category];
}

/** The transcript in time order; turns that start together keep their recorded order (sort is stable). */
export function orderedTurns(record: GDRecord): Turn[] {
  return [...record.transcript].sort((a, b) => a.startMs - b.startMs);
}

/** Where a turn sits on the discussion clock ("m:ss" from the end of the moderator's intro). */
function turnClock(turn: Turn, record: GDRecord): string {
  return formatClock(turn.startMs - record.discussionStartMs);
}

// ---------- Downloadable transcript ----------

export interface TranscriptTextOptions {
  /** When the GD took place, already formatted for the reader. Omitted → no date line. */
  dateLabel?: string;
}

/** Collapses line breaks and runs of spaces so every turn stays on one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sectionHeading(title: string): string[] {
  return [title.toUpperCase(), "-".repeat(title.length)];
}

/**
 * The whole GD as plain text for download: a header (topic, candidate, date, length,
 * participants, how to read the markers), then every turn as "[m:ss] Name: text", with
 * the closing summaries in a section of their own.
 */
export function transcriptToText(record: GDRecord, options: TranscriptTextOptions = {}): string {
  const { config } = record;
  const cast = castFor(config.userName);
  const nameOf = (speaker: SpeakerId) => speakerName(speaker, cast, config.userName);

  const outcomes = new Map(record.interruptions.map((event) => [event.interjectionTurnId, event.outcome]));
  const candidate = config.userName;

  const turnLine = (turn: Turn): string => {
    const notes = [
      turn.kind === "interjection" && "cutting in",
      turn.continuation && "continuing",
      turn.typed && "typed",
    ].filter(Boolean);
    const who = notes.length > 0 ? `${nameOf(turn.speaker)} (${notes.join(", ")})` : nameOf(turn.speaker);
    const cutOff = turn.interrupted
      ? ` [cut off${turn.interruptedBy ? ` by ${nameOf(turn.interruptedBy)}` : ""}]`
      : "";
    const outcome = outcomes.get(turn.id);
    const response =
      outcome === "held" ? ` [${candidate} held the floor]` : outcome === "yielded" ? ` [${candidate} yielded]` : "";
    return `[${turnClock(turn, record)}] ${who}: ${oneLine(turn.text)}${cutOff}${response}`;
  };

  const turns = orderedTurns(record);
  const discussion = turns.filter((turn) => turn.phase !== "summary");
  const summaries = turns.filter((turn) => turn.phase === "summary");
  const recorded = formatClock(record.discussionEndMs - record.discussionStartMs);

  const lines = [
    "GD Arena: group discussion transcript",
    "",
    `Topic: ${config.topic.title}`,
    `Category: ${topicCategoryLabel(config.topic)}`,
    `Candidate: ${config.userName}`,
    ...(options.dateLabel ? [`Date: ${options.dateLabel}`] : []),
    `Discussion length: ${config.minutes} minutes planned, ${recorded} recorded`,
    `Participants: ${PERSONA_IDS.map((id) => `${cast[id].name} (${cast[id].role})`).join(", ")}`,
    "",
    "Times are minutes:seconds from the start of the discussion.",
    "Markers: [cut off by X] the speaker was cut off by X; (cutting in) spoke over someone who held the floor;",
    "(continuing) carried on after being cut in on; (typed) typed instead of spoken.",
    "",
    ...sectionHeading("Discussion"),
    ...(discussion.length > 0 ? discussion.map(turnLine) : ["(Nothing was said.)"]),
    "",
    ...sectionHeading("Closing summaries"),
    ...(summaries.length > 0 ? summaries.map(turnLine) : ["(None: the GD ended before the closing summaries.)"]),
  ];
  return `${lines.join("\n")}\n`;
}

const MAX_SLUG_LENGTH = 48;

/**
 * A file name for the downloaded transcript, e.g. "gd-arena-quick-commerce-boon-or-bane-2026-10-16.txt",
 * dated in the reader's local time.
 */
export function transcriptFileName(topicTitle: string, date: Date): string {
  const words = topicTitle
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Keep it short, cutting at a word boundary when there is one.
  const cut = words.slice(0, MAX_SLUG_LENGTH);
  const slug =
    words.length <= MAX_SLUG_LENGTH || words[MAX_SLUG_LENGTH] === "-"
      ? cut
      : cut.replace(/-[^-]*$/, "") || cut;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `gd-arena-${slug || "transcript"}-${day}.txt`;
}

// ---------- Filler words ----------

export interface TextSegment {
  text: string;
  /** This segment is a filler word or phrase (DESIGN section 7). */
  filler: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One matcher per filler, built exactly like the counting matchers in metrics.ts so what the
 * transcript underlines is what the scorecard counted: whole words or phrases only, words of
 * a phrase separated by spaces or a comma, and multi-word phrases tried before single words.
 */
const FILLER_PATTERNS: RegExp[] = FILLERS.map((word, order) => {
  const tokens = word.split(" ");
  const body = tokens.map(escapeRegExp).join("[\\s,]+");
  // "right?" ends in punctuation, so it needs no trailing word boundary.
  const tail = /\w$/.test(word) ? "(?![\\w'])" : "";
  return { order, size: tokens.length, pattern: new RegExp(`(?<![\\w'])${body}${tail}`, "gi") };
})
  .sort((a, b) => b.size - a.size || a.order - b.order)
  .map(({ pattern }) => pattern);

/** Stands in for an already-matched span: neither a word character nor a space or comma. */
const MASK = "\u0000";

/**
 * Splits text into plain and filler segments, in order, for underlining. Phrases win over
 * the single words inside them ("you know", never "you" + "know"), and a filler never
 * matches inside another word ("likely", "umbrella"). Joining the segments' text gives
 * back the input exactly.
 */
export function splitFillers(text: string): TextSegment[] {
  const spans: [start: number, end: number][] = [];
  let masked = text;
  for (const pattern of FILLER_PATTERNS) {
    masked = masked.replace(pattern, (match: string, offset: number) => {
      spans.push([offset, offset + match.length]);
      // Same length, so offsets in `masked` stay offsets in `text`.
      return MASK.repeat(match.length);
    });
  }
  spans.sort((a, b) => a[0] - b[0]);

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), filler: false });
    segments.push({ text: text.slice(start, end), filler: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), filler: false });
  return segments;
}
