// Pure view-model helpers for the live room: everything the UI derives from an EngineState
// snapshot (seats, airtime, the clock, who may speak, what the caption shows). No React and
// no browser APIs here, so all of it runs in unit tests.

import { MODERATOR, USER_COLOR, type Cast } from "@/lib/personas";
import type { EngineState, GDConfig, InterruptionEvent, PersonaId, SpeakerId, Turn } from "@/lib/types";

/** Everyone at the table except the moderator (the airtime and turn counts cover these). */
export type Participant = PersonaId | "user";

export interface SeatInfo {
  id: SpeakerId;
  name: string;
  role: string;
  emoji: string;
  color: string;
}

/**
 * Seats clockwise from the head of the table (the moderator), the same order as the
 * round-table preview on the setup screen so the room feels familiar.
 */
export const SEAT_ORDER: readonly SpeakerId[] = ["moderator", "dominator", "data", "agreer", "user", "drifter", "smart"];

/**
 * Stacking order of the airtime bar. The candidate comes first, so their share starts at the
 * bar's left edge and reads directly against the fair-share marker. The persona order was
 * checked with the dataviz palette validator against the persona colours: every pair of
 * neighbours stays distinguishable under protanopia and deuteranopia (the dominator's red and
 * the agreer's green, which collapse for colour-blind readers, never touch).
 */
export const AIRTIME_ORDER: readonly Participant[] = ["user", "dominator", "data", "agreer", "smart", "drifter"];

/** Six people share the discussion, so a fair share of the airtime is a sixth. */
export const FAIR_SHARE = 1 / 6;

/** The clock turns amber in the last two minutes and red in the last 30 seconds. */
export const CLOCK_WARN_MS = 120_000;
export const CLOCK_DANGER_MS = 30_000;

/** How long a seat shows its "cut off" tag after that speaker was interrupted. */
export const CUT_OFF_FLASH_MS = 2200;

const CANDIDATE_EMOJI = "🎓";

export function seatInfo(id: SpeakerId, cast: Cast): SeatInfo {
  if (id === "moderator") {
    return { id, name: MODERATOR.name, role: "Runs the GD", emoji: MODERATOR.emoji, color: MODERATOR.color };
  }
  if (id === "user") return { id, name: "You", role: "Candidate", emoji: CANDIDATE_EMOJI, color: USER_COLOR };
  const persona = cast[id];
  return { id, name: persona.name, role: persona.role, emoji: persona.emoji, color: persona.color };
}

/** Display name in the room: the candidate is "You". */
export function nameOf(id: SpeakerId, cast: Cast): string {
  return seatInfo(id, cast).name;
}

// ---------- Before the engine exists ----------

/** The state shown before the engine is created (and before the GD starts). */
export function idleState(config: GDConfig): EngineState {
  return {
    status: "idle",
    phase: "intro",
    floor: "open",
    activeSpeaker: null,
    preparing: null,
    caption: "",
    captionSpokenChars: 0,
    transcript: [],
    interruptions: [],
    nowMs: 0,
    discussionStartMs: null,
    discussionMs: Math.max(0, config.minutes * 60_000),
    canJumpIn: false,
    userPrompt: null,
    userTurnSecondsLeft: null,
    micLevel: 0,
    inputMode: config.inputMode,
    offline: false,
    notice: null,
    error: null,
  };
}

// ---------- Time ----------

/** "m:ss" for a whole number of seconds. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Compact speaking time: "42s", "1m 05s". */
export function formatAirtime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Discussion time left: the full length until the clock starts, never below zero. */
export function timeLeftMs(state: EngineState): number {
  if (state.status === "closing" || state.status === "done") return 0;
  if (state.discussionStartMs === null) return state.discussionMs;
  return Math.max(0, state.discussionMs - (state.nowMs - state.discussionStartMs));
}

/** The discussion clock has run out (the current speaker may still be finishing). */
export function discussionTimeUp(state: EngineState): boolean {
  return state.discussionStartMs !== null && state.nowMs - state.discussionStartMs >= state.discussionMs;
}

export type ClockTone = "calm" | "warn" | "danger";

export function clockTone(msLeft: number): ClockTone {
  if (msLeft <= CLOCK_DANGER_MS) return "danger";
  if (msLeft <= CLOCK_WARN_MS) return "warn";
  return "calm";
}

/** Spoken clock milestones for screen readers (the clock itself is not announced every second). */
export function clockMilestone(state: EngineState): string {
  if (state.discussionStartMs === null || state.status === "error") return "";
  const left = timeLeftMs(state);
  if (left <= 0) return "Discussion time is up.";
  if (left <= CLOCK_DANGER_MS) return "30 seconds of discussion left.";
  if (left <= CLOCK_WARN_MS) return "2 minutes of discussion left.";
  return "";
}

/** "m:ss" of a turn from the start of the discussion; "Intro" for the moderator's opening. */
export function turnStamp(turn: Turn, discussionStartMs: number | null): string {
  if (turn.phase === "intro" || discussionStartMs === null) return "Intro";
  return formatClock((turn.startMs - discussionStartMs) / 1000);
}

export function phaseLabel(state: EngineState): string {
  switch (state.status) {
    case "idle":
      return "Ready";
    case "intro":
      return "Intro";
    case "discussion":
      return "Discussion";
    case "closing":
      return "Summaries";
    case "done":
      return "Finished";
    case "error":
      return "Stopped";
  }
}

// ---------- Airtime and turns ----------

export type ByParticipant = Record<Participant, number>;

function zeros(): ByParticipant {
  return { user: 0, dominator: 0, data: 0, agreer: 0, drifter: 0, smart: 0 };
}

/** Whoever is audible now in the discussion phase (not the moderator), or null. */
function liveParticipant(state: EngineState): Participant | null {
  const live = state.activeSpeaker;
  return state.phase === "discussion" && live !== null && live !== "moderator" ? live : null;
}

/**
 * Discussion-phase speaking time per participant, in ms. Recorded turns count end minus
 * start (interjections count for the dominator), plus the time the current speaker has been
 * talking since `speakerSinceMs`, so the bar grows while they speak.
 */
export function airtimeMs(state: EngineState, speakerSinceMs: number): ByParticipant {
  const totals = zeros();
  for (const turn of state.transcript) {
    if (turn.phase !== "discussion" || turn.speaker === "moderator") continue;
    totals[turn.speaker] += Math.max(0, turn.endMs - turn.startMs);
  }
  const live = liveParticipant(state);
  if (live) totals[live] += Math.max(0, state.nowMs - speakerSinceMs);
  return totals;
}

export function totalOf(values: ByParticipant): number {
  return AIRTIME_ORDER.reduce((sum, id) => sum + values[id], 0);
}

/** True when the candidate is waiting out an interjection's hold window (their turn resumes as a continuation). */
function resumingAfterInterjection(state: EngineState): boolean {
  const last = state.transcript.at(-1);
  return last?.kind === "interjection";
}

/**
 * Discussion-phase turns per participant. The candidate's continuations after an
 * interjection are not new turns. The line being spoken right now already counts.
 */
export function turnCounts(state: EngineState): ByParticipant {
  const counts = zeros();
  for (const turn of state.transcript) {
    if (turn.phase !== "discussion" || turn.speaker === "moderator" || turn.continuation) continue;
    counts[turn.speaker] += 1;
  }
  const live = liveParticipant(state);
  if (live && !(live === "user" && resumingAfterInterjection(state))) counts[live] += 1;
  return counts;
}

/**
 * Speakers whose latest turn was cut off within the last CUT_OFF_FLASH_MS. The cut moment is
 * the start of whatever followed (the cutter's speech), else the cut turn's end.
 */
export function recentlyCutOff(state: EngineState): ReadonlySet<SpeakerId> {
  const cut = new Set<SpeakerId>();
  const seen = new Set<SpeakerId>();
  const turns = state.transcript;
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (seen.has(turn.speaker)) continue;
    seen.add(turn.speaker);
    if (!turn.interrupted) continue;
    const cutAt = turns[index + 1]?.startMs ?? turn.endMs;
    if (state.nowMs - cutAt < CUT_OFF_FLASH_MS) cut.add(turn.speaker);
  }
  return cut;
}

// ---------- The floor ----------

/** The latest interruption still waiting for its held/yielded outcome. */
export function pendingInterruption(state: EngineState): InterruptionEvent | null {
  const last = state.interruptions.at(-1);
  return last?.outcome === "pending" ? last : null;
}

/** An AI is talking over the candidate while they hold the floor. */
export function beingInterjected(state: EngineState): boolean {
  return state.floor === "user" && state.activeSpeaker !== null && state.activeSpeaker !== "user";
}

export type FloorControl =
  /** The candidate may take the floor. */
  | { kind: "jump"; hint: string; urgent: boolean }
  /** The candidate holds the floor: the button ends the turn ("send" submits the typed text). */
  | { kind: "hold"; action: "done" | "send"; hint: string; listening: boolean }
  /** Jumping in isn't allowed right now, and this says why. */
  | { kind: "blocked"; reason: string }
  /** The GD is over (or stopped): no floor control. */
  | { kind: "none" };

/** What the Jump in / Done button does now, and the line of help shown under it. */
export function floorControl(state: EngineState, cast: Cast): FloorControl {
  const speaking = state.activeSpeaker;
  switch (state.status) {
    case "idle":
      return { kind: "blocked", reason: "The discussion hasn't started yet." };
    case "intro":
      return { kind: "blocked", reason: "The moderator is introducing the topic. Jump in once they finish." };
    case "done":
    case "error":
      return { kind: "none" };
    case "discussion":
    case "closing":
      break;
  }

  if (state.floor === "user") {
    const text = state.inputMode === "text";
    if (beingInterjected(state) && speaking) {
      return {
        kind: "hold",
        action: "done",
        listening: false,
        hint: `${nameOf(speaking, cast)} is cutting in. Keep talking once they stop to hold your ground, or press Done to yield.`,
      };
    }
    if (pendingInterruption(state)) {
      return {
        kind: "hold",
        action: "done",
        listening: true,
        hint: "Keep talking to hold your ground, or press Done to yield the floor.",
      };
    }
    if (text) {
      return { kind: "hold", action: "send", listening: false, hint: "Type your point, then press Enter or Send." };
    }
    return {
      kind: "hold",
      action: "done",
      listening: true,
      hint:
        state.phase === "summary"
          ? "Summarise, then press Done. A long pause also ends your summary."
          : "You have the floor. Press Done when you finish; a pause also ends your turn.",
    };
  }

  if (state.status === "closing") {
    if (speaking === "moderator") return { kind: "blocked", reason: "Summaries: the moderator is speaking." };
    const summarised = state.transcript.some((turn) => turn.phase === "summary" && turn.speaker === "user");
    if (speaking) return { kind: "blocked", reason: `Summaries: ${nameOf(speaking, cast)} is closing the discussion.` };
    return {
      kind: "blocked",
      reason: summarised ? "Summaries: listen to the closing summary." : "Summaries: the moderator will hand you the floor.",
    };
  }

  if (state.canJumpIn) {
    if (speaking && speaking !== "moderator") {
      return { kind: "jump", urgent: false, hint: `Cut in on ${nameOf(speaking, cast)}. Interrupting is part of a real GD.` };
    }
    if (state.preparing) {
      return { kind: "jump", urgent: true, hint: `Get in before ${nameOf(state.preparing, cast)} speaks.` };
    }
    const opened = state.transcript.some((turn) => turn.phase === "discussion" && turn.speaker !== "moderator");
    return {
      kind: "jump",
      urgent: true,
      hint: opened ? "The floor is open. Take it." : "The floor is open. Open the GD yourself!",
    };
  }

  if (discussionTimeUp(state)) {
    return { kind: "blocked", reason: "Time's up. The moderator will call for summaries next." };
  }
  // The engine allows a jump-in whenever the discussion runs and nobody holds the floor, so
  // this only covers the instant between its own state changes.
  return { kind: "blocked", reason: "Jumping in isn't available right now." };
}

// ---------- What the table says ----------

export type StageTone = "speaking" | "open" | "waiting" | "you" | "alert";

export interface StageStatus {
  /** The participant the status is about (their avatar and colour go with it). */
  speaker: SpeakerId | null;
  text: string;
  tone: StageTone;
}

/** One line for the middle of the table (and the top of the phone layout). */
export function stageStatus(state: EngineState, cast: Cast): StageStatus {
  const speaking = state.activeSpeaker;
  const name = (id: SpeakerId) => nameOf(id, cast);
  switch (state.status) {
    case "idle":
      return { speaker: "moderator", text: "Waiting for you to take your seat", tone: "waiting" };
    case "intro":
      return { speaker: "moderator", text: "The moderator is introducing the topic", tone: "speaking" };
    case "done":
      return { speaker: null, text: "The discussion is over", tone: "waiting" };
    case "error":
      return { speaker: null, text: "The discussion stopped", tone: "alert" };
    case "discussion":
    case "closing":
      break;
  }

  if (beingInterjected(state) && speaking) {
    return { speaker: speaking, text: `${name(speaking)} is cutting in on you`, tone: "alert" };
  }
  if (speaking === "user") {
    if (pendingInterruption(state)) return { speaker: "user", text: "Hold your ground: keep talking", tone: "you" };
    return {
      speaker: "user",
      text: state.phase === "summary" ? "Your closing summary" : "You have the floor",
      tone: "you",
    };
  }
  if (speaking === "moderator") {
    return { speaker: "moderator", text: "The moderator is speaking", tone: "speaking" };
  }
  if (speaking) {
    const verb = state.phase === "summary" ? "is summarising" : "is speaking";
    return { speaker: speaking, text: `${name(speaking)} ${verb}`, tone: "speaking" };
  }
  if (state.preparing) {
    const what = state.phase === "summary" ? "summarise" : "speak";
    return { speaker: state.preparing, text: `${name(state.preparing)} is about to ${what}`, tone: "waiting" };
  }
  if (state.status === "closing") return { speaker: "moderator", text: "Summaries", tone: "waiting" };
  if (discussionTimeUp(state)) return { speaker: "moderator", text: "Time's up", tone: "waiting" };
  return { speaker: null, text: "The floor is open", tone: "open" };
}

// ---------- Captions ----------

export interface CaptionWord {
  text: string;
  /** Offset of the word's first character in the caption. */
  start: number;
}

export function captionWords(caption: string): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const match of caption.matchAll(/\S+/g)) words.push({ text: match[0], start: match.index });
  return words;
}

/** How many words have started being spoken (the word being spoken counts). */
export function spokenWordCount(words: readonly CaptionWord[], spokenChars: number): number {
  let count = 0;
  while (count < words.length && words[count].start < spokenChars) count++;
  return count;
}
