// The live group discussion: a framework-agnostic state machine (DESIGN §4).
//
// One async main loop drives the GD: moderator intro → discussion (AI lines and the
// candidate's turns) → closing summaries. Every await in the loop is a step that races a
// wake-up signal: the candidate taking the floor, the end of their turn, time running out or
// a stop wakes the loop, which re-checks the state before doing anything else. What the
// candidate does (jumpIn, doneSpeaking, submitTyped, speech results) is handled
// synchronously, so the published state is consistent at every moment.
//
// The engine never touches browser APIs itself: speech, the microphone and the network are
// injected (EngineDeps), which is what lets the tests run it in Node with fakes and tiny
// timings.

import { chooseNext, type DirectorChoice } from "./director";
import { castFor, type Cast } from "./personas";
import type { Listener, ListenerCallbacks, ListenerErrorKind, MicMeter, SpeechHandle, Voice } from "./speech/types";
import type {
  Cue,
  EngineState,
  EngineStatus,
  Floor,
  GDConfig,
  GDPhase,
  GDRecord,
  InputMode,
  InterruptionEvent,
  InterruptionOutcome,
  PersonaId,
  SpeakerId,
  Turn,
  TurnKind,
  TurnMode,
  TurnRequest,
  TurnResponse,
  WireTurn,
} from "./types";

// ---------- Public contract ----------

export interface EngineTimings {
  /** After the moderator's intro, how long the floor stays open for the candidate to open the GD. */
  openingWindowMs: number;
  /** Pause between two speakers, random in [min, max], counted from the end of the previous speech. */
  gapMinMs: number;
  gapMaxMs: number;
  /** Pause after a drifter's tangent, so the candidate has a window to pull the group back. */
  postDriftGapMs: number;
  /** The candidate's turn ends after this much silence once they have said something. */
  silenceEndMs: number;
  /** The same, for the closing summary. */
  summarySilenceEndMs: number;
  /** The candidate's turn ends, with nothing recorded, if no words are heard for this long. */
  noSpeechMs: number;
  summaryNoSpeechMs: number;
  /** Hard caps on a discussion turn and on the closing summary. */
  userTurnCapMs: number;
  summaryCapMs: number;
  /** When time runs out while the candidate holds the floor, they get this much longer. */
  timeUpGraceMs: number;
  /** The dominator first considers cutting in at a random time in [min, max] after the candidate takes the floor. */
  interjectFirstMinMs: number;
  interjectFirstMaxMs: number;
  /** Re-check interval while the candidate has said too little to be cut off. */
  interjectRecheckMs: number;
  /** After an interjection: speech within this window means the candidate held their ground. */
  holdWindowMs: number;
  /** Interjections per GD. */
  maxInterjections: number;
  /** Pause after a failed line before another participant is asked. */
  failurePauseMs: number;
  /** Snapshot interval, and the faster one while the candidate speaks (smooth mic meter). */
  tickMs: number;
  fastTickMs: number;
  /** No prefetching when less than this much discussion time remains. */
  prefetchCutoffMs: number;
  /** How long a notice stays up. */
  noticeMs: number;
}

export const DEFAULT_TIMINGS: Readonly<EngineTimings> = Object.freeze({
  openingWindowMs: 6000,
  gapMinMs: 700,
  gapMaxMs: 1300,
  postDriftGapMs: 2500,
  silenceEndMs: 3500,
  summarySilenceEndMs: 4500,
  noSpeechMs: 8000,
  summaryNoSpeechMs: 10000,
  userTurnCapMs: 150000,
  summaryCapMs: 90000,
  timeUpGraceMs: 12000,
  interjectFirstMinMs: 16000,
  interjectFirstMaxMs: 26000,
  interjectRecheckMs: 5000,
  holdWindowMs: 4000,
  maxInterjections: 2,
  failurePauseMs: 1000,
  tickMs: 250,
  fastTickMs: 100,
  prefetchCutoffMs: 8000,
  noticeMs: 6000,
});

export interface EngineDeps {
  voice: Voice;
  /** The Room binds the recognition language. */
  createListener(callbacks: ListenerCallbacks): Listener;
  micMeter?: MicMeter;
  requestTurn(req: TurnRequest, signal?: AbortSignal): Promise<TurnResponse>;
  /** Monotonic clock in ms. Default performance.now(). */
  now?(): number;
  /** Uniform [0, 1). Default Math.random. */
  random?(): number;
  /** Test overrides of DEFAULT_TIMINGS. */
  timings?: Partial<EngineTimings>;
}

// ---------- Constants ----------

/** Turns of context sent with each line request. */
const WIRE_TURNS = 60;
/** The server keeps 2,000 characters of each transcript line. */
const WIRE_TEXT_CHARS = 2000;
/** The server keeps 3,000 characters of the candidate's in-progress turn. */
const PARTIAL_TEXT_CHARS = 3000;
/** A recorded candidate turn stays well under /api/score's 8,000-character limit per line. */
const MAX_TURN_CHARS = 6000;
/** The dominator only cuts in once the candidate has said this much in the turn. */
const MIN_WORDS_BEFORE_INTERJECTION = 20;
const MAX_CONSECUTIVE_FAILURES = 3;
/** Tries at the Silent Smart One's closing summary before the moderator closes without it. */
const SUMMARY_ATTEMPTS = 2;
/** Rough speaking speed, used to project when a line will end (for the director's clock). */
const SPEECH_CHARS_PER_SEC = 14;

const SUMMARY_PROMPT = "Summarise the discussion: main points from both sides, then a conclusion.";
const CONTINUE_AFTER_INTERJECTION: DirectorChoice = { speaker: "dominator", cue: "continue-after-interjection" };

const MESSAGES = {
  noSpeech: "Didn't catch that. Check your mic.",
  nothingTyped: "Nothing was typed, so the floor is open again.",
  lineFailed: (name: string) => `Couldn't get ${name}'s line. Asking someone else.`,
  noResponse:
    "The AI participants stopped responding (3 attempts in a row failed). Check your connection, then end now to score what you have.",
  badToken: "This GD session is no longer valid (it may have expired). Please start a new GD.",
  turnLimit: "This GD has used up its AI turns. End now to get your score.",
  dailyLimit: "You've reached today's GD limit. End now to score what you have.",
  crashed: "Something went wrong in the discussion. End now to score what you have.",
  summarySkipped: "Couldn't get the closing summary. Wrapping up.",
  textMode: (reason: string) => `${sentence(reason)} Switched to typing for the rest of this GD.`,
};

const ABANDONED = Symbol("abandoned");

// ---------- Internal types ----------

type LineResult = { ok: true; text: string } | LineFailure;
interface LineFailure {
  ok: false;
  /** Set for errors that end the GD (bad token, exhausted limits). */
  fatal: string | null;
  /** We cancelled the request ourselves. */
  aborted: boolean;
}

interface LineRequest {
  speaker: PersonaId;
  cue: Cue;
  controller: AbortController;
  /** Never rejects. */
  result: Promise<LineResult>;
}

/** A line written ahead of time. Usable only while `basisId` is still the transcript's last turn, uncut. */
interface Prefetch extends LineRequest {
  basisId: string;
}

/** A line being spoken by an AI participant or the moderator. */
interface ActiveSpeech {
  turnId: string;
  speaker: PersonaId | "moderator";
  text: string;
  startMs: number;
  phase: GDPhase;
  kind: TurnKind;
  cue?: Cue;
  handle: SpeechHandle;
}

/**
 * The candidate's turn in progress (internal and mutable; never published).
 * - speaking: collecting speech (or waiting for typed text)
 * - interjecting: the dominator is talking over them; recognition results are ignored
 * - holding: the interjection ended; speech within the hold window means they held their ground
 */
interface UserDraft {
  /** Id of the segment being collected (a new one after an interjection). */
  id: string;
  phase: GDPhase;
  kind: TurnKind;
  typed: boolean;
  stage: "speaking" | "interjecting" | "holding";
  /** Start of this segment: the jump-in, or the moment they carried on after an interjection. */
  startMs: number;
  finals: string;
  interim: string;
  /** At least one word heard in this segment. */
  heard: boolean;
  lastActivityMs: number;
  /** This segment resumes after an interjection. */
  continuation: boolean;
  /** The turn ends here at the latest: the hard cap, or the time-up grace. */
  deadlineMs: number;
  silenceEndMs: number;
  noSpeechMs: number;
  holdUntilMs: number;
  /** Pressed Done while being interjected: they yield once it finishes. */
  yieldRequested: boolean;
  /** The interruption awaiting its held/yielded outcome. */
  eventId: string | null;
}

// ---------- Helpers ----------

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function withDefaults(overrides: Partial<EngineTimings> = {}): EngineTimings {
  const timings: EngineTimings = { ...DEFAULT_TIMINGS };
  for (const key of Object.keys(overrides) as (keyof EngineTimings)[]) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value)) timings[key] = value;
  }
  return timings;
}

/** Freezes an array before it is published; changes always replace it with a new one. */
function frozen<T>(items: T[]): T[] {
  Object.freeze(items);
  return items;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function joinText(...parts: string[]): string {
  return squash(parts.join(" "));
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** Ends the text with a full stop unless it already ends a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * What was actually said of `text` when speech stopped after `spokenChars` characters: cut
 * back to a word boundary, with an em dash marking the cut. null when the line was finished.
 */
function cutAtWord(text: string, spokenChars: number): string | null {
  const full = text.trimEnd();
  const n = Number.isFinite(spokenChars) ? Math.max(0, Math.floor(spokenChars)) : 0;
  if (n >= full.length) return null;
  let head = full.slice(0, n);
  // Stopped mid-word: drop the partial word.
  if (/\S$/.test(head) && /\S/.test(full.charAt(n))) head = head.replace(/\S+$/, "");
  head = head.replace(/[\s,;:.!?…—–-]+$/, "");
  return `${head}—`;
}

function toWire(turn: Turn): WireTurn {
  const wire: WireTurn = { speaker: turn.speaker, text: clip(turn.text, WIRE_TEXT_CHARS), kind: turn.kind };
  if (turn.interrupted) wire.interrupted = true;
  if (turn.continuation) wire.continuation = true;
  return wire;
}

function turnOf(speech: ActiveSpeech, text: string, endMs: number): Turn {
  const turn: Turn = {
    id: speech.turnId,
    speaker: speech.speaker,
    text,
    startMs: speech.startMs,
    endMs,
    phase: speech.phase,
    kind: speech.kind,
  };
  if (speech.cue) turn.cue = speech.cue;
  return turn;
}

/** Reads `status` and `code` off any thrown value (ApiCallError or lookalikes). */
function errorFields(err: unknown): { status?: number; code?: string } {
  if (typeof err !== "object" || err === null) return {};
  const { status, code } = err as { status?: unknown; code?: unknown };
  return {
    status: typeof status === "number" ? status : undefined,
    code: typeof code === "string" ? code : undefined,
  };
}

/** The message for errors that end the GD; null for errors worth retrying with someone else. */
function fatalMessage(err: unknown): string | null {
  const { status, code } = errorFields(err);
  if (code === "bad_token" || status === 401 || status === 403) return MESSAGES.badToken;
  if (code === "turn_limit") return MESSAGES.turnLimit;
  if (code === "daily_limit") return MESSAGES.dailyLimit;
  return null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function partOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function introLine(config: GDConfig): string {
  const minutes = config.minutes === 1 ? "1 minute" : `${config.minutes} minutes`;
  return `Good ${partOfDay(new Date())}, everyone. Today's topic is: ${sentence(config.topic.title)} You have ${minutes}. Whoever is ready may begin.`;
}

const closingLine = (name: string) =>
  `Thank you, everyone, that's time. Let's close with summaries. ${name.trim()}, would you summarise the discussion for us?`;
const MOVE_ON_LINE = "Alright, let's move on.";
const END_LINE = "Thank you all. That brings us to the end of the discussion.";

// ---------- The engine ----------

export class GDEngine {
  private readonly config: GDConfig;
  private readonly deps: EngineDeps;
  private readonly timings: EngineTimings;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly cast: Cast;
  private readonly discussionMs: number;

  private readonly subscribers = new Set<(state: EngineState) => void>();
  private readonly doneHandlers = new Set<(record: GDRecord) => void>();
  private state: EngineState;

  // Lifecycle
  private started = false;
  /** Nothing may run any more (error, done, stop). Every async step re-checks it. */
  private stopped = false;
  /** stop() was called: torn down for good, never reports a record. */
  private disposed = false;
  private record: GDRecord | null = null;
  private t0 = 0;

  // What the snapshot shows
  private status: EngineStatus = "idle";
  private phase: GDPhase = "intro";
  private floor: Floor = "open";
  private activeSpeaker: SpeakerId | null = null;
  private preparing: PersonaId | null = null;
  private caption = "";
  private transcript: Turn[] = frozen([]);
  private interruptions: InterruptionEvent[] = frozen([]);
  private discussionStartMs: number | null = null;
  private discussionEndMs: number | null = null;
  private userPrompt: string | null = null;
  private notice: { text: string; untilMs: number } | null = null;
  private error: string | null = null;
  private mode: InputMode;

  // Discussion bookkeeping
  private timeUp = false;
  private speech: ActiveSpeech | null = null;
  private user: UserDraft | null = null;
  /** The line the main loop is waiting for. */
  private pending: LineRequest | null = null;
  private prefetch: Prefetch | null = null;
  private interjectRequest: LineRequest | null = null;
  private interjectTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private forced: DirectorChoice | null = null;
  private avoid: PersonaId | undefined;
  private failures = 0;
  private interjectionsUsed = 0;
  private lastSpeechEndMs = 0;
  private seq = 0;
  private listener: Listener | null = null;

  // Teardown
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly controllers = new Set<AbortController>();
  private wakeup = deferred();

  private readonly listenerCallbacks: ListenerCallbacks = {
    onInterim: (text) => this.recognized(text, false),
    onFinal: (text) => this.recognized(text, true),
    onActivity: () => this.voiceActivity(),
    onError: (kind, message) => this.listenerError(kind, message),
  };

  constructor(config: GDConfig, deps: EngineDeps) {
    this.config = config;
    this.deps = deps;
    this.timings = withDefaults(deps.timings);
    this.clock = () => (deps.now ? deps.now() : performance.now());
    this.random = () => (deps.random ? deps.random() : Math.random());
    this.cast = castFor(config.userName);
    this.discussionMs = Math.max(0, config.minutes * 60_000);
    this.mode = config.inputMode;
    this.state = this.snapshot();
  }

  // ---------- Public API ----------

  /** Calls `fn` now with the current state, then with every new state. */
  subscribe(fn: (state: EngineState) => void): () => void {
    this.subscribers.add(fn);
    fn(this.state);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  getState(): EngineState {
    return this.state;
  }

  /** The input mode in effect: the configured one, or "text" after a microphone failure (also in EngineState). */
  get inputMode(): InputMode {
    return this.mode;
  }

  /** Starts the GD. Call from a user gesture: the moderator's first words are spoken synchronously. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.t0 = this.clock();
    this.status = "intro";
    this.scheduleTick();
    this.run().catch((err: unknown) => this.crash(err));
  }

  /** The candidate takes the floor, cutting off whoever is speaking. */
  jumpIn(): void {
    if (!this.canJumpIn()) return;
    const now = this.elapsed();
    if (this.speech?.kind === "turn") this.cutSpeech(this.speech, "user");
    this.dropLineRequests();
    this.beginUserTurn("discussion", now);
    this.wake();
    this.publish();
  }

  /** The candidate ends their turn. While being interjected, it means they yield. */
  doneSpeaking(): void {
    const draft = this.user;
    if (this.stopped || !draft) return;
    if (draft.stage === "interjecting") draft.yieldRequested = true;
    else this.endUserTurn();
  }

  /** Text mode: the candidate's typed turn (empty counts as saying nothing). */
  submitTyped(text: string): void {
    const draft = this.user;
    if (this.stopped || !draft || !draft.typed || draft.stage !== "speaking") return;
    draft.finals = squash(text);
    this.endUserTurn();
  }

  /** "End & score now": closes the record with what was said so far and fires onDone. */
  endNow(): void {
    if (!this.started || this.disposed || this.record) return;
    if (!this.stopped) {
      this.closeOpenTurns();
      this.markDiscussionEnd();
    }
    this.finish();
  }

  /** Tears everything down (timers, speech, mic, requests) without firing onDone. */
  stop(): void {
    this.disposed = true;
    this.halt();
  }

  /** Called once with the finished record (immediately, if the GD is already done). */
  onDone(fn: (record: GDRecord) => void): () => void {
    this.doneHandlers.add(fn);
    if (this.record) fn(this.record);
    return () => {
      this.doneHandlers.delete(fn);
    };
  }

  // ---------- Main loop ----------

  private async run(): Promise<void> {
    // 1. The moderator introduces the topic. Nobody can jump in yet.
    if (!(await this.say("moderator", introLine(this.config), "intro", "moderator"))) return;

    // 2. The discussion clock starts when the moderator finishes.
    this.discussionStartMs = this.elapsed();
    this.lastSpeechEndMs = this.discussionStartMs;
    this.status = "discussion";
    this.phase = "discussion";
    this.setTimer(this.discussionMs, () => this.onTimeUp());
    this.publish();
    await this.discussion();
    if (this.stopped) return;

    // 3. Summaries.
    await this.closing();
  }

  private async discussion(): Promise<void> {
    // The floor is open for the candidate to open the GD; the opener's line is written meanwhile.
    this.prefetchNext(this.transcript, this.elapsed());
    await this.waitFor(this.sleep(this.timings.openingWindowMs), () => this.lineInterrupted());

    while (!this.stopped) {
      if (this.floor === "user") {
        await this.waitUntil(() => this.stopped || this.floor !== "user");
        continue;
      }
      if (this.timeUp) return;
      await this.aiTurn();
    }
  }

  /** While fetching or about to speak a line, these abandon it. */
  private lineInterrupted(): boolean {
    return this.stopped || this.floor === "user" || this.timeUp;
  }

  /** One AI line: get it (prefetched or fresh), pause naturally, speak it. */
  private async aiTurn(): Promise<void> {
    const request = this.takePrefetch() ?? this.requestNext();
    this.pending = request;
    this.preparing = request.speaker;
    this.publish();

    const result = await this.waitFor(request.result, () => this.lineInterrupted());
    if (this.pending === request) this.pending = null;
    if (result === ABANDONED) {
      request.controller.abort(); // jumpIn()/onTimeUp() already cleared `preparing`
      return;
    }
    if (!result.ok) {
      await this.lineFailed(request.speaker, result);
      return;
    }
    this.failures = 0;
    this.avoid = undefined;

    // A natural pause since the previous speech ended (longer after a drift). A jump-in wins.
    const wait = this.lastSpeechEndMs + this.gapAfter(this.transcript.at(-1)) - this.elapsed();
    if (wait > 0 && (await this.waitFor(this.sleep(wait), () => this.lineInterrupted())) === ABANDONED) return;

    await this.say(request.speaker, result.text, "discussion", "turn", request.cue);
  }

  private async lineFailed(speaker: PersonaId, failure: LineFailure): Promise<void> {
    this.preparing = null;
    if (failure.aborted) return;
    if (failure.fatal) {
      this.fail(failure.fatal);
      return;
    }
    this.failures += 1;
    if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
      this.fail(MESSAGES.noResponse);
      return;
    }
    this.avoid = speaker;
    this.setNotice(MESSAGES.lineFailed(this.cast[speaker].name));
    this.publish();
    await this.waitFor(this.sleep(this.timings.failurePauseMs), () => this.lineInterrupted());
  }

  private gapAfter(last: Turn | undefined): number {
    const { gapMinMs, gapMaxMs, postDriftGapMs } = this.timings;
    if (last?.speaker === "drifter") return postDriftGapMs;
    return gapMinMs + this.random() * Math.max(0, gapMaxMs - gapMinMs);
  }

  private onTimeUp(): void {
    this.timeUp = true;
    // The line being spoken may finish; nothing new is fetched or started.
    this.dropLineRequests();
    const draft = this.user;
    if (draft) {
      this.cancelInterjection();
      draft.deadlineMs = Math.min(draft.deadlineMs, this.elapsed() + this.timings.timeUpGraceMs);
    }
    this.wake();
    this.publish();
  }

  private async closing(): Promise<void> {
    this.dropLineRequests();
    this.forced = null;
    this.markDiscussionEnd();
    this.status = "closing";
    this.phase = "summary";
    this.publish();
    if (!(await this.say("moderator", closingLine(this.config.userName), "summary", "moderator"))) return;

    // The candidate's summary starts automatically.
    const before = this.transcript.length;
    this.beginUserTurn("summary", this.elapsed());
    this.publish();
    await this.waitUntil(() => this.stopped || this.user === null);
    if (this.stopped) return;
    const summarised = this.transcript.slice(before).some((turn) => turn.speaker === "user");
    if (!summarised && !(await this.say("moderator", MOVE_ON_LINE, "summary", "moderator"))) return;

    await this.smartSummary();
    if (this.stopped) return;
    if (!(await this.say("moderator", END_LINE, "summary", "moderator"))) return;
    this.finish();
  }

  /** The Silent Smart One's closing summary. If it can't be had, the moderator closes without it. */
  private async smartSummary(): Promise<void> {
    for (let attempt = 1; attempt <= SUMMARY_ATTEMPTS; attempt++) {
      const request = this.requestLine("smart", "summary", "wrap-up", this.transcript, this.elapsed());
      this.pending = request;
      this.preparing = "smart";
      this.publish();
      const result = await this.waitFor(request.result, () => this.stopped);
      this.pending = null;
      this.preparing = null;
      if (result === ABANDONED) return;
      if (result.ok) {
        await this.say("smart", result.text, "summary", "summary");
        return;
      }
      if (result.fatal) break;
      if (attempt < SUMMARY_ATTEMPTS) {
        const paused = await this.waitFor(this.sleep(this.timings.failurePauseMs), () => this.stopped);
        if (paused === ABANDONED) return;
      }
    }
    this.setNotice(MESSAGES.summarySkipped);
    this.publish();
  }

  // ---------- AI speech ----------

  /**
   * Speaks a line with the floor and records it once it has played. Returns false if it was
   * cut off (jumpIn/endNow recorded the spoken part) or the engine stopped.
   */
  private async say(
    speaker: PersonaId | "moderator",
    text: string,
    phase: GDPhase,
    kind: TurnKind,
    cue?: Cue,
  ): Promise<boolean> {
    this.floor = "ai";
    this.preparing = null;
    const speech = this.beginSpeech(speaker, text, phase, kind, cue);
    if (kind === "turn") {
      // While this line plays, write the next one as if this one finishes uncut.
      const endsAt = speech.startMs + (text.length / SPEECH_CHARS_PER_SEC) * 1000;
      this.prefetchNext([...this.transcript, turnOf(speech, text, endsAt)], endsAt);
    }
    this.publish();

    await this.waitFor(speech.handle.done, () => this.stopped || this.speech !== speech);
    if (this.stopped || this.speech !== speech) return false;
    this.finishSpeech(speech);
    this.floor = "open";
    this.publish();
    return true;
  }

  private beginSpeech(
    speaker: PersonaId | "moderator",
    text: string,
    phase: GDPhase,
    kind: TurnKind,
    cue?: Cue,
  ): ActiveSpeech {
    const handle = this.deps.voice.speak(text, speaker);
    const speech: ActiveSpeech = { turnId: this.nextId("t"), speaker, text, startMs: this.elapsed(), phase, kind, cue, handle };
    this.speech = speech;
    this.activeSpeaker = speaker;
    this.caption = text;
    return speech;
  }

  /** Records a line that played to the end. */
  private finishSpeech(speech: ActiveSpeech): void {
    const end = this.elapsed();
    this.speech = null;
    this.addTurn(turnOf(speech, speech.text, end));
    this.lastSpeechEndMs = end;
    this.activeSpeaker = null;
    this.caption = "";
  }

  /** Stops a line mid-way and records only what was spoken. */
  private cutSpeech(speech: ActiveSpeech, by?: SpeakerId): void {
    const now = this.elapsed();
    const spoken = speech.handle.spokenChars();
    this.speech = null;
    this.safely(() => speech.handle.cancel());
    const cut = cutAtWord(speech.text, spoken);
    const turn = turnOf(speech, cut ?? speech.text, now);
    if (cut !== null) {
      turn.interrupted = true;
      if (by) turn.interruptedBy = by;
    }
    this.addTurn(turn);
    this.lastSpeechEndMs = now;
    this.activeSpeaker = null;
    this.caption = "";
  }

  // ---------- Line requests ----------

  private requestLine(
    speaker: PersonaId,
    mode: TurnMode,
    cue: Cue,
    transcript: readonly Turn[],
    atMs: number,
    partialUserText?: string,
  ): LineRequest {
    const controller = new AbortController();
    this.controllers.add(controller);
    const req: TurnRequest = {
      token: this.config.token,
      topic: this.config.topic,
      userName: this.config.userName,
      speaker,
      mode,
      cue,
      elapsedSec: Math.round(Math.max(0, atMs - (this.discussionStartMs ?? atMs)) / 1000),
      totalSec: Math.round(this.discussionMs / 1000),
      transcript: transcript.slice(-WIRE_TURNS).map(toWire),
    };
    if (partialUserText !== undefined) req.partialUserText = partialUserText.slice(-PARTIAL_TEXT_CHARS);

    const result = Promise.resolve()
      .then(() => this.deps.requestTurn(req, controller.signal))
      .then(
        (res): LineResult => {
          const text = typeof res?.text === "string" ? squash(res.text) : "";
          return text ? { ok: true, text } : { ok: false, fatal: null, aborted: controller.signal.aborted };
        },
        (err: unknown): LineResult => {
          const aborted = controller.signal.aborted;
          return { ok: false, fatal: aborted ? null : fatalMessage(err), aborted };
        },
      )
      .finally(() => this.controllers.delete(controller));
    return { speaker, cue, controller, result };
  }

  /** Chooses the next speaker for the current transcript and asks for their line. */
  private requestNext(): LineRequest {
    const now = this.elapsed();
    const choice = chooseNext(this.transcript, {
      elapsedFrac: this.elapsedFrac(now),
      forced: this.forced ?? undefined,
      random: this.random,
      avoid: this.avoid,
    });
    this.forced = null;
    return this.requestLine(choice.speaker, "turn", choice.cue, this.transcript, now);
  }

  /** Starts writing the line that should follow `basis` (a transcript that may include a line still being spoken). */
  private prefetchNext(basis: Turn[], atMs: number, forced?: DirectorChoice): void {
    this.dropPrefetch();
    const last = basis.at(-1);
    if (!last || this.stopped || this.timeUp || this.status !== "discussion" || this.discussionStartMs === null) return;
    const remaining = this.discussionStartMs + this.discussionMs - this.elapsed();
    if (remaining < this.timings.prefetchCutoffMs) return;
    const choice = chooseNext(basis, {
      elapsedFrac: this.elapsedFrac(atMs),
      forced: forced ?? this.forced ?? undefined,
      random: this.random,
    });
    this.prefetch = { ...this.requestLine(choice.speaker, "turn", choice.cue, basis, atMs), basisId: last.id };
  }

  /** The prefetched line, if it was written for the transcript as it stands (and any forced choice). */
  private takePrefetch(): LineRequest | null {
    const prefetch = this.prefetch;
    this.prefetch = null;
    if (!prefetch) return null;
    const last = this.transcript.at(-1);
    const forced = this.forced;
    const fits =
      last !== undefined &&
      last.id === prefetch.basisId &&
      !last.interrupted &&
      (!forced || (forced.speaker === prefetch.speaker && forced.cue === prefetch.cue));
    if (!fits) {
      prefetch.controller.abort();
      return null;
    }
    this.forced = null;
    return prefetch;
  }

  private dropPrefetch(): void {
    this.prefetch?.controller.abort();
    this.prefetch = null;
  }

  /** Abandons the line being fetched and the prefetch (the transcript is about to change). */
  private dropLineRequests(): void {
    this.dropPrefetch();
    this.pending?.controller.abort();
    this.pending = null;
    this.preparing = null;
  }

  // ---------- The candidate's turn ----------

  private beginUserTurn(phase: GDPhase, startMs: number): void {
    const summary = phase === "summary";
    const t = this.timings;
    const draft: UserDraft = {
      id: this.nextId("t"),
      phase,
      kind: summary ? "summary" : "turn",
      typed: this.mode === "text",
      stage: "speaking",
      startMs,
      finals: "",
      interim: "",
      heard: false,
      lastActivityMs: startMs,
      continuation: false,
      deadlineMs: startMs + (summary ? t.summaryCapMs : t.userTurnCapMs),
      silenceEndMs: summary ? t.summarySilenceEndMs : t.silenceEndMs,
      noSpeechMs: summary ? t.summaryNoSpeechMs : t.noSpeechMs,
      holdUntilMs: 0,
      yieldRequested: false,
      eventId: null,
    };
    this.user = draft;
    this.floor = "user";
    this.activeSpeaker = "user";
    this.caption = "";
    this.preparing = null;
    this.userPrompt = summary ? SUMMARY_PROMPT : null;
    if (!draft.typed) {
      this.scheduleInterjection(draft, this.randomBetween(t.interjectFirstMinMs, t.interjectFirstMaxMs));
      // Last: a microphone failure reported synchronously switches this turn to typing.
      this.startMic();
    }
    this.scheduleTick();
  }

  private startMic(): void {
    const meter = this.deps.micMeter;
    if (meter) {
      try {
        meter.start().catch(() => undefined);
      } catch {
        // The meter is cosmetic: without it the level just reads 0.
      }
    }
    this.startListener();
  }

  private startListener(): void {
    try {
      this.listener ??= this.deps.createListener(this.listenerCallbacks);
      this.listener.start();
    } catch (err) {
      this.listenerError("other", errorText(err, "Couldn't start speech recognition."));
    }
  }

  /** Ends the candidate's turn (Done, silence, no speech, a cap or a typed submission). */
  private endUserTurn(): void {
    const draft = this.user;
    if (!draft || draft.stage === "interjecting") return; // settled when the interjection finishes
    if (draft.stage === "holding") {
      this.yieldToInterjection(draft);
      return;
    }
    const turn = this.closeUserTurn();
    if (!turn && !draft.continuation) this.setNotice(draft.typed ? MESSAGES.nothingTyped : MESSAGES.noSpeech);
    this.afterUserTurn();
  }

  /**
   * Stops listening, records the segment being collected (if anything was said) and opens the
   * floor. Returns the recorded turn.
   */
  private closeUserTurn(): Turn | null {
    const draft = this.user;
    if (!draft) return null;
    // Detach first: the listener's flush on stop() repeats the interim text we already hold.
    this.user = null;
    this.cancelInterjection();
    if (!draft.typed) {
      this.safely(() => this.listener?.stop());
      this.safely(() => this.deps.micMeter?.stop());
    }
    const now = this.elapsed();
    this.floor = "open";
    this.activeSpeaker = null;
    this.caption = "";
    this.userPrompt = null;
    this.lastSpeechEndMs = now;
    if (draft.stage !== "speaking") return null; // an interjection already split off what they said

    const text = clip(joinText(draft.finals, draft.interim), MAX_TURN_CHARS);
    if (!text) return null;
    const turn: Turn = {
      id: draft.id,
      speaker: "user",
      text,
      startMs: draft.startMs,
      // Spoken turns end at the last speech heard, not when the silence timer fired.
      endMs: draft.typed ? now : Math.max(draft.startMs, draft.lastActivityMs),
      phase: draft.phase,
      kind: draft.kind,
    };
    if (draft.continuation) turn.continuation = true;
    if (draft.typed) turn.typed = true;
    this.addTurn(turn);
    return turn;
  }

  private afterUserTurn(): void {
    this.scheduleTick();
    this.wake();
    this.publish();
  }

  /** Runs on every tick while the candidate holds the floor. */
  private checkUserTurn(): void {
    const draft = this.user;
    if (!draft || draft.stage === "interjecting") return; // timers are suspended while the interjection plays
    const now = this.elapsed();
    if (draft.stage === "holding") {
      if (now >= draft.holdUntilMs || now >= draft.deadlineMs) this.yieldToInterjection(draft);
      return;
    }
    if (now >= draft.deadlineMs) {
      this.endUserTurn();
      return;
    }
    if (draft.typed) return; // text mode: no silence timer
    const silent = draft.heard ? now - draft.lastActivityMs >= draft.silenceEndMs : now - draft.startMs >= draft.noSpeechMs;
    if (silent) this.endUserTurn();
  }

  // ---------- Speech recognition ----------

  /** The draft taking recognition results right now, if any. */
  private listeningDraft(): UserDraft | null {
    const draft = this.user;
    return !this.stopped && draft && !draft.typed && draft.stage !== "interjecting" ? draft : null;
  }

  private voiceActivity(): void {
    const draft = this.listeningDraft();
    if (!draft) return;
    if (draft.stage === "holding") this.holdGround(draft);
    draft.lastActivityMs = this.elapsed();
  }

  private recognized(text: string, final: boolean): void {
    const draft = this.listeningDraft();
    if (!draft) return;
    const words = squash(text);
    if (draft.stage === "holding") {
      if (!words) return;
      this.holdGround(draft);
    }
    if (final) {
      draft.finals = joinText(draft.finals, words);
      draft.interim = "";
    } else {
      draft.interim = words;
    }
    if (words) {
      draft.heard = true;
      draft.lastActivityMs = this.elapsed();
    }
    this.caption = joinText(draft.finals, draft.interim);
    this.publish();
  }

  private listenerError(kind: ListenerErrorKind, message: string): void {
    if (this.stopped) return;
    const draft = this.user;
    // A listener that stopped itself during a spoken turn has given up for good.
    const gaveUp = draft !== null && !draft.typed && this.listener !== null && !this.listener.active;
    if (kind === "not-allowed" || kind === "no-mic" || gaveUp) {
      this.switchToText(message);
      return;
    }
    this.setNotice(message); // transient (e.g. network): the listener keeps retrying
    this.publish();
  }

  /** No usable microphone: the rest of the GD is typed. */
  private switchToText(reason: string): void {
    const wasVoice = this.mode === "voice";
    this.mode = "text";
    this.setNotice(MESSAGES.textMode(reason.trim() || "The microphone isn't available."), this.timings.noticeMs * 2);
    const draft = this.user;
    if (wasVoice && draft && !draft.typed && draft.stage === "speaking") {
      if (draft.heard) {
        this.endUserTurn(); // keep what was heard; the floor reopens
        return;
      }
      // Nothing heard yet: they keep the floor and type instead.
      this.cancelInterjection();
      this.safely(() => this.listener?.stop());
      this.safely(() => this.deps.micMeter?.stop());
      draft.typed = true;
      this.scheduleTick();
    }
    // While interjecting or holding, the hold window simply runs out without a listener.
    this.publish();
  }

  // ---------- The dominator's interjections ----------

  private scheduleInterjection(draft: UserDraft, delayMs: number): void {
    this.cancelInterjection();
    if (draft.typed || draft.phase !== "discussion" || this.timeUp) return;
    if (this.interjectionsUsed >= this.timings.maxInterjections) return;
    this.interjectTimer = this.setTimer(delayMs, () => this.considerInterjecting(draft));
  }

  private cancelInterjection(): void {
    this.clearTimer(this.interjectTimer);
    this.interjectTimer = undefined;
    this.interjectRequest?.controller.abort();
    this.interjectRequest = null;
  }

  private considerInterjecting(draft: UserDraft): void {
    this.interjectTimer = undefined;
    if (this.user !== draft || draft.stage !== "speaking" || this.timeUp || this.status !== "discussion") return;
    const said = joinText(draft.finals, draft.interim);
    if (countWords(said) < MIN_WORDS_BEFORE_INTERJECTION) {
      this.scheduleInterjection(draft, this.timings.interjectRecheckMs);
      return;
    }
    this.interject(draft, said).catch((err: unknown) => this.crash(err));
  }

  private async interject(draft: UserDraft, said: string): Promise<void> {
    const request = this.requestLine("dominator", "interject", "respond-user", this.transcript, this.elapsed(), said);
    this.interjectRequest = request;
    const result = await request.result;
    if (this.stopped || this.interjectRequest !== request) return; // the turn ended meanwhile
    this.interjectRequest = null;
    if (this.user !== draft || draft.stage !== "speaking" || this.timeUp) return;
    if (!result.ok) {
      // A missed interjection costs nothing; only a dead session or exhausted limits matter.
      if (result.fatal) this.fail(result.fatal);
      return;
    }
    await this.talkOver(draft, result.text);
  }

  /** The dominator cuts in: split the candidate's turn, speak over them, then see if they hold. */
  private async talkOver(draft: UserDraft, line: string): Promise<void> {
    const now = this.elapsed();
    const before = joinText(draft.finals, draft.interim);

    // 1. What they said so far becomes a turn of its own, cut off by the dominator.
    const cutTurn: Turn = {
      id: draft.id,
      speaker: "user",
      text: clip(before, MAX_TURN_CHARS),
      startMs: draft.startMs,
      endMs: Math.max(draft.startMs, draft.lastActivityMs),
      phase: draft.phase,
      kind: draft.kind,
      interrupted: true,
      interruptedBy: "dominator",
    };
    if (draft.continuation) cutTurn.continuation = true;
    this.addTurn(cutTurn);

    // 2. The dominator talks over them. Recognition results are ignored meanwhile (the mic
    //    hears the speakers) and the silence timers are suspended.
    draft.stage = "interjecting";
    draft.finals = "";
    draft.interim = "";
    this.interjectionsUsed += 1;
    const speech = this.beginSpeech("dominator", line, "discussion", "interjection");
    const event: InterruptionEvent = {
      id: this.nextId("i"),
      atMs: now,
      by: "dominator",
      interjectionTurnId: speech.turnId,
      userTextBefore: before,
      outcome: "pending",
    };
    draft.eventId = event.id;
    this.interruptions = frozen([...this.interruptions, Object.freeze(event)]);
    this.publish();

    await this.waitFor(speech.handle.done, () => this.stopped || this.speech !== speech);
    if (this.stopped || this.speech !== speech) return; // endNow()/fail() recorded what was said
    this.finishSpeech(speech);
    if (this.user !== draft) return;
    if (draft.yieldRequested || this.mode === "text") {
      this.yieldToInterjection(draft);
      return;
    }

    // 3. Watch whether they carry on. A fresh recognition session drops any echo of the
    //    interjection (stopped while still "interjecting", so its flush is ignored).
    this.safely(() => this.listener?.stop());
    draft.stage = "holding";
    draft.holdUntilMs = this.elapsed() + this.timings.holdWindowMs;
    this.activeSpeaker = "user";
    // If they yield, the dominator carries on: write that line now.
    this.prefetchNext(this.transcript, this.elapsed(), CONTINUE_AFTER_INTERJECTION);
    this.startListener();
    this.publish();
  }

  /** Speech after an interjection: they held their ground, and a continuation segment starts. */
  private holdGround(draft: UserDraft): void {
    const now = this.elapsed();
    this.settleInterruption(draft, "held");
    this.dropPrefetch(); // the dominator's follow-up assumed they would yield
    draft.id = this.nextId("t");
    draft.stage = "speaking";
    draft.continuation = true;
    draft.startMs = now;
    draft.lastActivityMs = now;
    draft.finals = "";
    draft.interim = "";
    draft.heard = false;
    const t = this.timings;
    this.scheduleInterjection(draft, this.randomBetween(t.interjectFirstMinMs, t.interjectFirstMaxMs));
    this.publish();
  }

  /** No speech after the interjection (or Done): the turn ends and the dominator carries on. */
  private yieldToInterjection(draft: UserDraft): void {
    this.settleInterruption(draft, "yielded");
    if (!this.timeUp) this.forced = CONTINUE_AFTER_INTERJECTION;
    this.closeUserTurn();
    this.afterUserTurn();
  }

  private settleInterruption(draft: UserDraft, outcome: InterruptionOutcome): void {
    const id = draft.eventId;
    draft.eventId = null;
    if (!id) return;
    this.interruptions = frozen(
      this.interruptions.map((event) => (event.id === id ? Object.freeze({ ...event, outcome }) : event)),
    );
  }

  // ---------- Ending ----------

  /** Records whatever is in progress (a line being spoken, the candidate's speech) as it stands. */
  private closeOpenTurns(): void {
    if (this.speech) this.cutSpeech(this.speech);
    this.closeUserTurn();
  }

  private markDiscussionEnd(): void {
    if (this.discussionStartMs !== null && this.discussionEndMs === null) this.discussionEndMs = this.elapsed();
  }

  /** A fatal error: stop everything but keep the transcript (endNow() still produces a record). */
  private fail(message: string): void {
    if (this.stopped) return;
    this.closeOpenTurns();
    this.markDiscussionEnd();
    this.halt();
    this.status = "error";
    this.error = message;
    this.resetLive();
    this.publish();
  }

  private crash(err: unknown): void {
    console.error("GD engine error:", err);
    this.fail(MESSAGES.crashed);
  }

  private finish(): void {
    if (this.record) return;
    this.halt();
    const now = this.elapsed();
    const { topic, userName, minutes, sttLang } = this.config;
    const record: GDRecord = Object.freeze({
      config: Object.freeze({ topic, userName, minutes, sttLang, inputMode: this.mode }),
      transcript: this.transcript,
      interruptions: this.interruptions,
      discussionStartMs: this.discussionStartMs ?? now,
      discussionEndMs: this.discussionEndMs ?? now,
    });
    this.record = record;
    this.status = "done";
    this.error = null;
    this.resetLive();
    this.publish();
    for (const fn of [...this.doneHandlers]) this.safely(() => fn(record));
  }

  /** Clears what only makes sense while the GD is live. */
  private resetLive(): void {
    this.floor = "open";
    this.activeSpeaker = null;
    this.preparing = null;
    this.caption = "";
    this.userPrompt = null;
  }

  /** Stops every timer, request, voice and the microphone. Idempotent. */
  private halt(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.tickTimer = undefined;
    this.interjectTimer = undefined;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.pending = null;
    this.prefetch = null;
    this.interjectRequest = null;
    const speech = this.speech;
    this.speech = null;
    this.user = null; // detached before the listener stops, so its flush is ignored
    if (speech) this.safely(() => speech.handle.cancel());
    this.safely(() => this.deps.voice.cancelAll());
    this.safely(() => this.listener?.stop());
    this.safely(() => this.deps.micMeter?.stop());
    this.wake(); // every pending step re-checks `stopped` and returns
  }

  // ---------- Publishing ----------

  private canJumpIn(): boolean {
    return (
      !this.stopped &&
      this.status === "discussion" &&
      !this.timeUp &&
      this.floor !== "user" &&
      this.speech?.kind !== "interjection"
    );
  }

  private snapshot(): EngineState {
    const now = this.elapsed();
    if (this.notice && now >= this.notice.untilMs) this.notice = null;
    const speech = this.speech;
    const draft = this.user;
    let captionSpokenChars = this.caption.length; // the candidate's live caption is all spoken
    if (speech && this.caption === speech.text) {
      const spoken = speech.handle.spokenChars();
      captionSpokenChars = Number.isFinite(spoken) ? Math.min(speech.text.length, Math.max(0, Math.floor(spoken))) : 0;
    }
    const level = draft && !draft.typed && !this.stopped ? (this.deps.micMeter?.level() ?? 0) : 0;
    return Object.freeze({
      status: this.status,
      phase: this.phase,
      floor: this.floor,
      activeSpeaker: this.activeSpeaker,
      preparing: this.preparing,
      caption: this.caption,
      captionSpokenChars,
      transcript: this.transcript,
      interruptions: this.interruptions,
      nowMs: now,
      discussionStartMs: this.discussionStartMs,
      discussionMs: this.discussionMs,
      canJumpIn: this.canJumpIn(),
      userPrompt: this.userPrompt,
      userTurnSecondsLeft:
        draft && draft.phase === "summary" ? Math.max(0, Math.ceil((draft.deadlineMs - now) / 1000)) : null,
      micLevel: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0,
      inputMode: this.mode,
      notice: this.notice?.text ?? null,
      error: this.error,
    });
  }

  private publish(): void {
    this.state = this.snapshot();
    for (const fn of [...this.subscribers]) this.safely(() => fn(this.state));
  }

  private scheduleTick(): void {
    this.clearTimer(this.tickTimer);
    this.tickTimer = undefined;
    if (this.stopped || !this.started) return;
    const listening = this.floor === "user" && this.user !== null && !this.user.typed;
    this.tickTimer = this.setTimer(listening ? this.timings.fastTickMs : this.timings.tickMs, () => this.tick());
  }

  private tick(): void {
    this.tickTimer = undefined;
    this.checkUserTurn();
    this.publish();
    this.scheduleTick();
  }

  // ---------- Small utilities ----------

  private addTurn(turn: Turn): void {
    this.transcript = frozen([...this.transcript, Object.freeze(turn)]);
  }

  private setNotice(text: string, ms = this.timings.noticeMs): void {
    this.notice = { text, untilMs: this.elapsed() + ms };
  }

  /** ms since start(), rounded; 0 before. */
  private elapsed(): number {
    return this.started ? Math.round(this.clock() - this.t0) : 0;
  }

  private elapsedFrac(atMs: number): number {
    if (this.discussionStartMs === null) return 0;
    if (this.discussionMs <= 0) return 1;
    return Math.min(1, Math.max(0, (atMs - this.discussionStartMs) / this.discussionMs));
  }

  private randomBetween(min: number, max: number): number {
    return min + this.random() * Math.max(0, max - min);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  /** Wakes every step waiting in waitFor()/waitUntil() so it re-checks the state. */
  private wake(): void {
    const current = this.wakeup;
    this.wakeup = deferred();
    current.resolve();
  }

  /**
   * Awaits `promise` unless `abandon()` becomes true first. `abandon` is re-checked on every
   * wake-up and again once `promise` settles, so a step never acts on a state that changed
   * while it waited.
   */
  private async waitFor<T>(promise: Promise<T>, abandon: () => boolean): Promise<T | typeof ABANDONED> {
    const settled = promise.then((value) => ({ value }));
    // If `promise` rejects after the step was abandoned, nobody awaits it: mark it handled. A
    // rejection that wins the race below still throws to the caller.
    settled.catch(() => undefined);
    for (;;) {
      if (abandon()) return ABANDONED;
      const outcome = await Promise.race([settled, this.wakeup.promise.then(() => null)]);
      if (outcome) return abandon() ? ABANDONED : outcome.value;
    }
  }

  private async waitUntil(done: () => boolean): Promise<void> {
    while (!done()) await this.wakeup.promise;
  }

  /** A timer that is cleared on halt and never fires afterwards. */
  private setTimer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        if (this.stopped) return;
        try {
          fn();
        } catch (err) {
          this.crash(err);
        }
      },
      Math.max(0, ms),
    );
    this.timers.add(timer);
    return timer;
  }

  private clearTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimer(ms, resolve);
    });
  }

  /** Runs a callback into other code (subscribers, speech, the mic) so its failure can't derail the engine. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error("GD engine: a callback failed:", err);
    }
  }
}
