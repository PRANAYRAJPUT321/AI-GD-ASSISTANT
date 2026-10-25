// Shared types used by the browser engine, the UI and the API routes.
// This file is the contract between modules: change it deliberately.

export type PersonaId = "dominator" | "data" | "agreer" | "drifter" | "smart";
export type SpeakerId = PersonaId | "user" | "moderator";

export const PERSONA_IDS: readonly PersonaId[] = [
  "dominator",
  "data",
  "agreer",
  "drifter",
  "smart",
] as const;

export type TopicCategory = "business" | "current-affairs" | "abstract";

export interface Topic {
  id: string;
  title: string;
  category: TopicCategory;
  /** One-line framing shown under the title and given to the AI participants. */
  hint?: string;
}

/** What the director asks a participant to do on a given turn. */
export type Cue =
  | "open" // nobody has opened; this participant opens the GD
  | "respond-user" // the candidate just spoke; react to their point
  | "agree-user" // (agreer) agree with the candidate by name, add nothing
  | "agree-last" // (agreer) agree with the previous speaker, add nothing
  | "drift" // (drifter) wander onto a tangent
  | "follow-drift" // go along with the drifter's tangent
  | "bring-back" // pull the group back to the topic
  | "late-strong" // (smart) first contribution, late, strong point
  | "continue-after-interjection" // (dominator) candidate yielded after being cut off
  | "wrap-up" // final minute: no brand-new threads
  | "normal";

export type TurnKind =
  | "turn" // a normal contribution
  | "interjection" // an AI cutting in while the candidate holds the floor
  | "summary" // a closing summary
  | "moderator"; // scripted moderator line

export type GDPhase = "intro" | "discussion" | "summary";

export interface Turn {
  id: string;
  speaker: SpeakerId;
  /** What was actually said. For a cut-off AI turn, only the part that was spoken. */
  text: string;
  /** ms since the engine started (intro start). */
  startMs: number;
  endMs: number;
  phase: GDPhase;
  kind: TurnKind;
  cue?: Cue;
  /** This turn was cut off before it finished. */
  interrupted?: boolean;
  interruptedBy?: SpeakerId;
  /** A candidate segment that resumes after an interjection (not a new entry). */
  continuation?: boolean;
  /** Candidate turn typed instead of spoken (no-mic fallback). */
  typed?: boolean;
}

export type InterruptionOutcome = "held" | "yielded" | "pending";

/** An AI cutting in while the candidate had the floor. */
export interface InterruptionEvent {
  id: string;
  atMs: number;
  by: PersonaId;
  /** Turn id of the interjection itself. */
  interjectionTurnId: string;
  /** What the candidate had said in that turn when they were cut off. */
  userTextBefore: string;
  outcome: InterruptionOutcome;
}

export type InputMode = "voice" | "text";

/** How fast the AI participants speak, on top of each persona's own pace. */
export type VoiceSpeed = "relaxed" | "natural" | "brisk";

export interface GDConfig {
  topic: Topic;
  userName: string;
  /** Discussion length in minutes (moderator calls time after this). */
  minutes: number;
  /** BCP-47 language for speech recognition, e.g. "en-IN". */
  sttLang: string;
  inputMode: InputMode;
  /** How fast the AI participants speak (a device preference, not sent to the server). */
  voiceSpeed: VoiceSpeed;
  /** Signed session token from POST /api/session. */
  token: string;
  /** The notes the candidate wrote during prep (never sent to the AI). */
  notes: string;
}

export type EngineStatus =
  | "idle"
  | "intro"
  | "discussion"
  | "closing"
  | "done"
  | "error";

export type Floor = "ai" | "user" | "open";

/** Snapshot the engine publishes to the UI on every change (and ~4x/second). */
export interface EngineState {
  status: EngineStatus;
  phase: GDPhase;
  floor: Floor;
  /** Who is audible right now (an AI/moderator speaking, or "user" while they hold the floor). */
  activeSpeaker: SpeakerId | null;
  /** AI participant whose line is being generated (shown as "Meera is about to speak"). */
  preparing: PersonaId | null;
  /** Live caption: the full line of the AI speaking, or the candidate's live speech-to-text. */
  caption: string;
  /** For AI speech: how many characters of `caption` have been spoken so far (for highlighting). */
  captionSpokenChars: number;
  transcript: Turn[];
  interruptions: InterruptionEvent[];
  /** ms since engine start; 0 before start. */
  nowMs: number;
  /** ms since engine start when the discussion clock started (end of moderator intro). null until then. */
  discussionStartMs: number | null;
  /** Discussion length in ms (config.minutes * 60000). */
  discussionMs: number;
  /** True while the candidate may press "Jump in" (discussion, not already holding the floor). */
  canJumpIn: boolean;
  /** Instruction shown to the candidate, e.g. "Summarise the discussion (about 60–90 s)". */
  userPrompt: string | null;
  /** Seconds left in the candidate's capped turn (summary), else null. */
  userTurnSecondsLeft: number | null;
  /** 0..1 microphone level while the candidate holds the floor (for the live meter). */
  micLevel: number;
  /** Input mode in effect: the configured one, or "text" after a microphone failure. */
  inputMode: InputMode;
  /** The participant line being (or last) spoken is a built-in practice line (no AI service available). */
  offline: boolean;
  /** Non-fatal notice for the UI (e.g. "Couldn't reach the AI; retrying"). */
  notice: string | null;
  /** Fatal error (status === "error"). */
  error: string | null;
}

/** The final record handed from the room to scoring. */
export interface GDRecord {
  config: Omit<GDConfig, "token" | "notes" | "voiceSpeed">;
  transcript: Turn[];
  interruptions: InterruptionEvent[];
  discussionStartMs: number;
  discussionEndMs: number;
}

// ---------- API contracts ----------

export interface SessionResponse {
  token: string;
  /** GDs left today for this device after this one; null = unlimited. */
  remainingToday: number | null;
}

export interface ApiError {
  error: string;
  /** Machine-readable reason, e.g. "daily_limit", "bad_token", "turn_limit". */
  code?: string;
}

export type TurnMode = "turn" | "interject" | "summary";

/** A compact transcript line sent to the server (no timing needed there). */
export interface WireTurn {
  speaker: SpeakerId;
  text: string;
  interrupted?: boolean;
  kind?: TurnKind;
  continuation?: boolean;
}

export interface TurnRequest {
  token: string;
  topic: Topic;
  userName: string;
  speaker: PersonaId;
  mode: TurnMode;
  cue: Cue;
  /** Seconds since the discussion started and the total, so speakers know where they are. */
  elapsedSec: number;
  totalSec: number;
  /** Most recent turns (the client keeps this to the last ~60). */
  transcript: WireTurn[];
  /** For mode "interject": what the candidate has said so far in their current turn. */
  partialUserText?: string;
}

export interface TurnResponse {
  /** The line to speak. null if the model declined or produced nothing usable. */
  text: string | null;
  /** True when no AI service was available and this is a built-in practice line. */
  offline?: boolean;
}
