// Text-to-speech for the AI participants and the moderator (browser speechSynthesis).
//
// Browser quirks this module works around:
// - Chrome cuts long utterances (~15 s) on some platforms, so every line is split into
//   sentence-sized chunks that are queued one after another.
// - Chrome garbage-collects an utterance that only its own event handlers reference, and its
//   `onend` then never fires: live utterances are kept in a module-level set.
// - `onend` can still go missing, so each chunk has a watchdog (estimated duration + 3 s).
// - The global queue can be left stuck (from a previous page or a lost `onend`), so it is
//   cleared before the first line and whenever something is queued that is not ours.
// - Voices load asynchronously (`voiceschanged`), or never; `ready()` waits at most 1.5 s.
// - Without speechSynthesis, `speak()` simulates the reading time so captions still advance.
//
// For an Indian GD the panel should sound Indian: English (India) voices are used whenever the
// browser has any; failing that, a Hindi voice that reads English with an Indian accent (with
// numbers spelled out in English, see spoken.ts); only then British, American or other English.
//
// Nothing here touches `window` at import time, so the module is safe to import during SSR.

import { MODERATOR, type Cast, type VoiceProfile } from "../personas";
import type { SpeakerId, VoiceSpeed } from "../types";
import { isEnglishLang, speechText } from "./spoken";
import type { SpeechHandle, Voice } from "./types";

/** Average speaking speed at rate 1, used for timing estimates and fallbacks. */
const CHARS_PER_SECOND = 14;
/** Longest chunk handed to the engine in one utterance (stays under Chrome's ~15 s cut-off). */
const MAX_CHUNK_CHARS = 220;
/** When a long sentence is broken up, no piece is made shorter than this. */
const MIN_PIECE_CHARS = 40;
/** A short breath between sentences, so a line isn't rattled off in one go. */
export const SENTENCE_PAUSE_MS = 180;
/** Rate multiplier for each speed setting, applied to every persona's own rate. */
export const VOICE_SPEED_SCALE: Readonly<Record<VoiceSpeed, number>> = { relaxed: 0.85, natural: 1, brisk: 1.12 };
/** Extra time a chunk gets beyond its estimate before we assume `onend` was lost. */
const WATCHDOG_GRACE_MS = 3000;
/** How long `ready()` waits for `voiceschanged` before giving up. */
const VOICES_TIMEOUT_MS = 1500;
/** Language requested when no specific system voice is assigned. */
const DEFAULT_LANG = "en-IN";
/** Pitch spacing between speakers that have to share one system voice. */
const SHARED_PITCH_STEP = 0.14;
/** Pitch adjustment when a voice's apparent gender differs from the persona's. */
const GENDER_PITCH_CORRECTION = 0.15;
const MIN_PITCH = 0.6;
const MAX_PITCH = 1.5;

type VoicedSpeaker = Exclude<SpeakerId, "user">;
type Gender = VoiceProfile["gender"];
type SpeechResult = Awaited<SpeechHandle["done"]>;

/** Assignment order: the moderator opens the GD, so it gets first pick of the voices. */
const VOICED_SPEAKERS: readonly VoicedSpeaker[] = [
  "moderator",
  "dominator",
  "data",
  "agreer",
  "drifter",
  "smart",
];

/** Strong references to utterances in flight (see the Chrome GC note above). */
const LIVE_UTTERANCES = new Set<SpeechSynthesisUtterance>();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

/** A piece of a line, with its position in the full line so progress maps back to it. */
export interface TextChunk {
  /** Exactly `source.slice(start, end)`: never empty, no surrounding whitespace. */
  text: string;
  start: number;
  end: number;
}

/** Sentence terminators (optionally followed by closing quotes/brackets) before whitespace, or line breaks. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)|\n+/g;
/** A period after these words (or after a single letter, as in "e.g." or "U.S.") does not end a sentence. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "rs", "approx", "govt", "dept", "inc", "ltd", "etc",
]);
const CLAUSE_PUNCTUATION = /[,;:—–-]/;
const WHITESPACE = /\s/;

function isAbbreviation(text: string, sentenceStart: number, match: RegExpExecArray): boolean {
  if (match[0].replace(/["'”’)\]]+$/, "") !== ".") return false;
  const word = /([A-Za-z]+)$/.exec(text.slice(sentenceStart, match.index))?.[1];
  return word !== undefined && (word.length === 1 || ABBREVIATIONS.has(word.toLowerCase()));
}

/**
 * Where to cut an over-long sentence `text[start, end)`: the end offset of the first piece.
 * Prefers a clause break (comma, semicolon, colon, dash) closest to an even split, then any
 * space, and only cuts mid-word when there is no space at all.
 */
function findBreak(text: string, start: number, end: number): number {
  const pieces = Math.ceil((end - start) / MAX_CHUNK_CHARS);
  const target = start + Math.ceil((end - start) / pieces);
  const lo = start + MIN_PIECE_CHARS;
  const hi = Math.min(start + MAX_CHUNK_CHARS, end - 1);
  const closer = (cut: number, best: number) => best < 0 || Math.abs(cut - target) < Math.abs(best - target);
  let clause = -1;
  let space = -1;
  // `cut` is the end of the first piece: it sits on a space, right after the last word.
  for (let cut = lo; cut <= hi; cut++) {
    if (!WHITESPACE.test(text[cut])) continue;
    if (CLAUSE_PUNCTUATION.test(text[cut - 1]) && closer(cut, clause)) clause = cut;
    if (!WHITESPACE.test(text[cut - 1]) && closer(cut, space)) space = cut;
  }
  if (clause > 0) return clause;
  if (space > 0) return space;
  return hi;
}

function pushSentence(text: string, from: number, to: number, out: TextChunk[]): void {
  let start = from;
  let end = to;
  while (start < end && WHITESPACE.test(text[start])) start++;
  while (end > start && WHITESPACE.test(text[end - 1])) end--;
  while (end - start > MAX_CHUNK_CHARS) {
    let cut = findBreak(text, start, end);
    let next = cut;
    while (cut > start && WHITESPACE.test(text[cut - 1])) cut--;
    while (next < end && WHITESPACE.test(text[next])) next++;
    out.push({ text: text.slice(start, cut), start, end: cut });
    start = next;
  }
  if (start < end) out.push({ text: text.slice(start, end), start, end });
}

/**
 * Splits a line into sentence chunks for sequential speaking. Sentences longer than ~220
 * characters are broken at commas/semicolons (else at spaces). Offsets refer to the original
 * text, so `chunk.start + n` is a character position in the full line.
 */
export function splitSentences(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let sentenceStart = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    if (isAbbreviation(text, sentenceStart, match)) continue;
    const end = match.index + match[0].length;
    pushSentence(text, sentenceStart, end, chunks);
    sentenceStart = end;
  }
  pushSentence(text, sentenceStart, text.length, chunks);
  return chunks;
}

/** Rough reading time of `text` at speech `rate` (≈ 14 characters per second at rate 1). */
export function estimateDurationMs(text: string, rate = 1): number {
  if (text.trim() === "") return 0;
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.round((text.length / (CHARS_PER_SECOND * safeRate)) * 1000);
}

// ---------------------------------------------------------------------------
// Voice selection
// ---------------------------------------------------------------------------

/** The parts of a SpeechSynthesisVoice that voice selection looks at. */
export interface VoiceInfo {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

function keywordPattern(words: readonly string[]): RegExp {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
}

// Common system voice names (Windows, Edge, macOS/iOS, Chrome) by apparent gender.
const FEMALE_VOICE = keywordPattern([
  "female", "woman", "heera", "veena", "zira", "samantha", "victoria", "karen", "moira", "tessa",
  "fiona", "susan", "hazel", "neerja", "aria", "jenny", "libby", "sonia", "ava", "emma", "michelle",
  "kate", "serena", "martha", "catherine", "google us english", "google uk english female",
]);
const MALE_VOICE = keywordPattern([
  "male", "ravi", "rishi", "prabhat", "david", "mark", "daniel", "alex", "fred", "george", "guy",
  "ryan", "andrew", "brian", "christopher", "eric", "roger", "steffan", "thomas", "arthur",
  "google uk english male",
]);
/** Cloud/neural voices sound far more natural than classic local ones. */
const HIGH_QUALITY_VOICE = /\b(?:natural|neural|online|enhanced|premium)\b|google/i;
/** macOS novelty voices: never give these to a participant if anything else exists. */
const NOVELTY_VOICE = keywordPattern([
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "good news",
  "hysterical", "jester", "organ", "superstar", "trinoids", "whisper", "wobble", "zarvox",
]);

/** Apparent gender of a system voice from its name, or null when the name gives no clue. */
export function voiceGender(name: string): Gender | null {
  if (FEMALE_VOICE.test(name)) return "female"; // checked first: "female" contains "male"
  if (MALE_VOICE.test(name)) return "male";
  return null;
}

/**
 * Hindi voices that read English text well, with an Indian accent: Chrome's Google voice and
 * the neural/online ones (Edge). Classic local Hindi voices may spell English out, so not those.
 */
const HINDI_READS_ENGLISH = /\b(?:google|natural|neural|online)\b/i;

/** The accents a voice can give the panel, best first. */
export type Accent = "indian" | "indian-hindi" | "british" | "american" | "english";

const ACCENT_ORDER: readonly Accent[] = ["indian", "indian-hindi", "british", "american", "english"];

/** The accent a voice gives the panel, or null when it can't speak the English lines. */
function accentOf(voice: VoiceInfo): Accent | null {
  const lang = voice.lang.toLowerCase().replace(/_/g, "-");
  if (lang.startsWith("en-in")) return "indian";
  if (lang === "hi" || lang.startsWith("hi-")) return HINDI_READS_ENGLISH.test(voice.name) ? "indian-hindi" : null;
  if (lang.startsWith("en-gb")) return "british";
  if (lang.startsWith("en-us")) return "american";
  if (lang === "en" || lang.startsWith("en-")) return "english";
  if (lang === "" && /english/i.test(voice.name)) return "english";
  return null;
}

interface RankedVoice {
  name: string;
  gender: Gender | null;
  accent: Accent;
}

/**
 * The voices the panel may use, best first. Only the best accent the browser offers is kept:
 * with any English (India) voice the whole panel sounds Indian (speakers share voices and are
 * told apart by pitch) rather than mixing in British or American voices. Within it: quality,
 * then the system default.
 */
function rankVoices(voices: readonly VoiceInfo[]): RankedVoice[] {
  const seen = new Set<string>();
  const usable = voices
    .map((voice, index) => ({ voice, index, accent: accentOf(voice) }))
    .filter((entry): entry is typeof entry & { accent: Accent } => {
      if (entry.accent === null || seen.has(entry.voice.name)) return false;
      seen.add(entry.voice.name);
      return true;
    });
  const serious = usable.filter(({ voice }) => !NOVELTY_VOICE.test(voice.name));
  const candidates = serious.length > 0 ? serious : usable;
  const rank = (accent: Accent) => ACCENT_ORDER.indexOf(accent);
  const best = Math.min(...candidates.map(({ accent }) => rank(accent)));
  // Indian voices are kept to themselves; otherwise any English voice may be used (best first).
  const pool = candidates.filter(({ accent }) => (best <= 1 ? rank(accent) === best : true));
  const quality = (v: VoiceInfo) => (HIGH_QUALITY_VOICE.test(v.name) ? 0 : 1);
  pool.sort(
    (a, b) =>
      rank(a.accent) - rank(b.accent) ||
      quality(a.voice) - quality(b.voice) ||
      Number(Boolean(b.voice.default)) - Number(Boolean(a.voice.default)) ||
      a.index - b.index,
  );
  return pool.map(({ voice, accent }) => ({ name: voice.name, gender: voiceGender(voice.name), accent }));
}

export interface PanelAccent {
  /** The accent the panel will have; null when the browser offers no usable voice (yet). */
  accent: Accent | null;
  /** The voices that will be used, best first. */
  voices: string[];
}

/** Which accent the panel will speak with on this browser, for the setup screen. */
export function panelAccent(voices: readonly VoiceInfo[]): PanelAccent {
  const ranked = rankVoices(voices);
  return { accent: ranked[0]?.accent ?? null, voices: ranked.map((voice) => voice.name) };
}

function profileOf(speaker: VoicedSpeaker, cast: Cast): VoiceProfile {
  return speaker === "moderator" ? MODERATOR.voice : cast[speaker].voice;
}

/**
 * Preference tier of a voice for a speaker (lower is better): a fresh voice of the right
 * gender, then a fresh voice of unknown gender, then sharing a right/unknown-gender voice
 * (pitch is varied later), and only then a voice of the other gender.
 */
function tierOf(voice: RankedVoice, want: Gender, uses: number): number {
  if (voice.gender !== null && voice.gender !== want) return uses > 0 ? 5 : 4;
  return (uses > 0 ? 2 : 0) + (voice.gender === want ? 0 : 1);
}

/** Tiers from which a speaker may pick in the first pass (no other-gender voices). */
const LAST_SAME_GENDER_TIER = 3;

/**
 * Picks a system voice (by name) for each speaker: Indian voices whenever the browser has any
 * (English (India), else a Hindi voice that reads English), otherwise British, then American,
 * then any English; high-quality voices first; matching the persona's gender by voice name;
 * and a different voice per speaker while enough exist. `user` (and every speaker, when there
 * is no usable voice) maps to null: use the default.
 */
export function pickVoices(voices: readonly VoiceInfo[], cast: Cast): Record<SpeakerId, string | null> {
  const ranked = rankVoices(voices);
  const uses = new Map<string, number>();
  const picks = { user: null } as Record<SpeakerId, string | null>;

  const assign = (speaker: VoicedSpeaker, maxTier: number): boolean => {
    const want = profileOf(speaker, cast).gender;
    let best: { voice: RankedVoice; tier: number; uses: number } | null = null;
    for (const voice of ranked) {
      const used = uses.get(voice.name) ?? 0;
      const tier = tierOf(voice, want, used);
      if (tier > maxTier) continue;
      if (!best || tier < best.tier || (tier === best.tier && used < best.uses)) {
        best = { voice, tier, uses: used };
      }
    }
    if (!best) return false;
    picks[speaker] = best.voice.name;
    uses.set(best.voice.name, best.uses + 1);
    return true;
  };

  // First pass: same-gender (or unknown) voices only, so a speaker of one gender never uses
  // up the best voice of the other. Second pass: whoever found none takes what is left.
  const unvoiced = VOICED_SPEAKERS.filter((speaker) => !assign(speaker, LAST_SAME_GENDER_TIER));
  for (const speaker of unvoiced) {
    if (!assign(speaker, Number.POSITIVE_INFINITY)) picks[speaker] = null;
  }
  return picks;
}

export interface Prosody {
  rate: number;
  pitch: number;
}

/**
 * Rate and pitch per speaker for a voice assignment. Each persona keeps its profile rate,
 * scaled by the chosen speed.
 * A speaker with a voice of its own keeps its profile pitch; speakers sharing one voice
 * (including "no voice": the browser default) get evenly spread pitches, male personas
 * lower and female higher, so they stay distinguishable. A voice that sounds like the other
 * gender is nudged towards the persona's.
 */
export function prosodyFor(
  assignment: Record<SpeakerId, string | null>,
  cast: Cast,
  speed: VoiceSpeed = "natural",
): Record<SpeakerId, Prosody> {
  const scale = VOICE_SPEED_SCALE[speed];
  const result = { user: { rate: 1, pitch: 1 } } as Record<SpeakerId, Prosody>;
  const groups = new Map<string | null, VoicedSpeaker[]>();
  for (const speaker of VOICED_SPEAKERS) {
    const name = assignment[speaker];
    groups.set(name, [...(groups.get(name) ?? []), speaker]);
  }
  for (const [name, speakers] of groups) {
    const heard = name ? voiceGender(name) : null;
    const ordered = [...speakers].sort((a, b) => {
      const pa = profileOf(a, cast);
      const pb = profileOf(b, cast);
      return Number(pa.gender === "female") - Number(pb.gender === "female") || pa.pitch - pb.pitch;
    });
    const middle = (ordered.length - 1) / 2;
    ordered.forEach((speaker, i) => {
      const profile = profileOf(speaker, cast);
      const base = ordered.length === 1 ? profile.pitch : 1 + (i - middle) * SHARED_PITCH_STEP;
      const correction =
        heard === null || heard === profile.gender
          ? 1
          : 1 + (profile.gender === "female" ? GENDER_PITCH_CORRECTION : -GENDER_PITCH_CORRECTION);
      result[speaker] = { rate: profile.rate * scale, pitch: clamp(base * correction, MIN_PITCH, MAX_PITCH) };
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

/** True when the browser can speak (speechSynthesis + SpeechSynthesisUtterance). */
export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

interface SpeakPlan {
  voice: SpeechSynthesisVoice | null;
  lang: string;
  rate: number;
  pitch: number;
}

/**
 * One line being spoken, chunk by chunk. With `synth === null` each chunk simply lasts its
 * estimated duration, so the rest of the app behaves the same without audio.
 */
class SpeechRun implements SpeechHandle {
  readonly done: Promise<SpeechResult>;
  private resolveDone!: (result: SpeechResult) => void;
  private readonly chunks: TextChunk[];
  private finished = false;
  private finalChars = 0;
  /** Index of the chunk being spoken. */
  private index = -1;
  /** When the current chunk started (queued, then reset by `onstart`). */
  private chunkStartedAt = 0;
  /** Progress within the current chunk reported by boundary events; -1 until one arrives. */
  private boundaryChars = -1;
  /** Characters of the current chunk per character the voice actually says (spelled-out numbers). */
  private chunkScale = 1;
  /** spokenChars() never goes backwards (a time estimate may run ahead of a late boundary). */
  private highWater = 0;
  private utterance: SpeechSynthesisUtterance | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly text: string,
    private readonly plan: SpeakPlan,
    private readonly synth: SpeechSynthesis | null,
    private readonly onSettled: (run: SpeechRun) => void,
  ) {
    this.chunks = splitSentences(text);
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  start(): void {
    this.advance();
  }

  spokenChars(): number {
    if (this.finished) return this.finalChars;
    const chunk = this.chunks[this.index];
    if (!chunk) return this.highWater;
    const elapsedMs = now() - this.chunkStartedAt;
    const estimated = Math.floor((elapsedMs / 1000) * CHARS_PER_SECOND * this.plan.rate * this.chunkScale);
    const within = this.utterance && this.boundaryChars >= 0 ? this.boundaryChars : estimated;
    this.highWater = Math.max(this.highWater, chunk.start + clamp(within, 0, chunk.text.length));
    return this.highWater;
  }

  cancel(): void {
    if (this.finished) return;
    this.finish(false);
    // Our current chunk is the only thing we queued; handlers are detached, so its
    // "interrupted"/"canceled" events are ignored.
    this.synth?.cancel();
  }

  /** Moves on to the next chunk (after a short breath between sentences), or finishes after the last one. */
  private advance(): void {
    this.release();
    this.index += 1;
    const chunk = this.chunks[this.index];
    if (!chunk) {
      this.finish(true);
      return;
    }
    if (this.index > 0) {
      // Progress holds at the end of the previous sentence during the pause.
      this.chunkStartedAt = now() + SENTENCE_PAUSE_MS;
      this.boundaryChars = -1;
      this.timer = setTimeout(() => this.startChunk(chunk), SENTENCE_PAUSE_MS);
    } else {
      this.startChunk(chunk);
    }
  }

  private startChunk(chunk: TextChunk): void {
    this.timer = undefined;
    this.chunkStartedAt = now();
    this.boundaryChars = -1;
    const spoken = speechText(chunk.text, { numbersAsWords: !isEnglishLang(this.plan.lang) });
    this.chunkScale = chunk.text.length / Math.max(1, spoken.length);
    const estimate = estimateDurationMs(spoken, this.plan.rate);
    if (this.synth) {
      this.speakChunk(this.synth, chunk, spoken, estimate);
    } else {
      this.timer = setTimeout(() => this.advance(), estimate);
    }
  }

  private speakChunk(synth: SpeechSynthesis, chunk: TextChunk, spoken: string, estimate: number): void {
    // Boundary positions refer to the spoken text; they only map onto the line when it is unchanged.
    const aligned = spoken === chunk.text;
    const utterance = new window.SpeechSynthesisUtterance(spoken);
    if (this.plan.voice) utterance.voice = this.plan.voice;
    utterance.lang = this.plan.lang;
    utterance.rate = this.plan.rate;
    utterance.pitch = this.plan.pitch;
    utterance.volume = 1;

    const isCurrent = () => this.utterance === utterance;
    utterance.onstart = () => {
      if (!isCurrent()) return;
      this.chunkStartedAt = now();
      this.watch(estimate + WATCHDOG_GRACE_MS);
    };
    utterance.onboundary = (event) => {
      if (!isCurrent()) return;
      // charIndex is where the current word starts; include the word itself when known so
      // the caption highlights the word being spoken.
      const reach = event.charIndex + (event.name === "word" && event.charLength > 0 ? event.charLength : 0);
      if (aligned) this.boundaryChars = Math.max(this.boundaryChars, clamp(reach, 0, chunk.text.length));
      // Progress proves the engine is alive: re-arm the watchdog for what is left.
      this.watch(estimateDurationMs(spoken.slice(clamp(reach, 0, spoken.length)), this.plan.rate) + WATCHDOG_GRACE_MS);
    };
    utterance.onend = () => {
      if (isCurrent()) this.advance();
    };
    utterance.onerror = () => {
      if (!isCurrent()) return;
      // The engine failed on this chunk (blocked autoplay, missing voice, …). Finish it on the
      // reading-time estimate so captions keep their pace instead of jumping ahead.
      this.release();
      const remaining = Math.max(0, estimate - (now() - this.chunkStartedAt));
      this.timer = setTimeout(() => this.advance(), remaining);
    };

    this.utterance = utterance;
    LIVE_UTTERANCES.add(utterance);
    this.watch(estimate + WATCHDOG_GRACE_MS);
    synth.speak(utterance);
  }

  /** (Re)arms the watchdog: if no end arrives in time, move on as if the chunk had ended. */
  private watch(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), ms);
  }

  /** Drops the current utterance (handlers and strong reference) and any pending timer. */
  private release(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const utterance = this.utterance;
    if (!utterance) return;
    utterance.onstart = null;
    utterance.onboundary = null;
    utterance.onend = null;
    utterance.onerror = null;
    LIVE_UTTERANCES.delete(utterance);
    this.utterance = null;
  }

  private finish(completed: boolean): void {
    if (this.finished) return;
    this.finalChars = completed ? this.text.length : this.spokenChars();
    this.finished = true;
    this.release();
    this.resolveDone({ completed, spokenChars: this.finalChars });
    this.onSettled(this);
  }
}

class BrowserVoice implements Voice {
  readonly supported: boolean;
  private readonly synth: SpeechSynthesis | null;
  private voices = new Map<string, SpeechSynthesisVoice>();
  private assignment: Record<SpeakerId, string | null>;
  private prosody: Record<SpeakerId, Prosody>;
  /** Set once a line has been spoken with real voices: voices must not change mid-GD. */
  private locked = false;
  /** The stuck-queue clear before the first line has happened. */
  private primed = false;
  private readyPromise: Promise<void> | null = null;
  private active: SpeechRun | null = null;
  private readonly onVoicesChanged = () => this.loadVoices();

  constructor(
    private readonly cast: Cast,
    private readonly speed: VoiceSpeed,
  ) {
    this.synth = isSpeechSynthesisSupported() ? window.speechSynthesis : null;
    this.supported = this.synth !== null;
    this.assignment = pickVoices([], cast);
    this.prosody = prosodyFor(this.assignment, cast, speed);
    if (this.synth) {
      this.synth.addEventListener("voiceschanged", this.onVoicesChanged);
      this.loadVoices();
    }
  }

  ready(): Promise<void> {
    this.readyPromise ??= new Promise<void>((resolve) => {
      const synth = this.synth;
      if (!synth || this.voices.size > 0) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timeout);
        synth.removeEventListener("voiceschanged", onChange);
        resolve();
      };
      // Registered after the constructor's listener, so the voices are loaded by now.
      const onChange = () => {
        if (this.voices.size > 0) finish();
      };
      const timeout = setTimeout(finish, VOICES_TIMEOUT_MS);
      synth.addEventListener("voiceschanged", onChange);
    });
    return this.readyPromise;
  }

  /** Speaks one line. Only one line plays at a time: a line still playing is cancelled. */
  speak(text: string, who: SpeakerId): SpeechHandle {
    this.active?.cancel();
    const synth = this.synth;
    if (synth) {
      this.lockVoices();
      // Nothing of ours is queued now, so anything still speaking or pending is stale.
      if (!this.primed || synth.speaking || synth.pending) synth.cancel();
      this.primed = true;
      if (synth.paused) synth.resume();
    }
    const run = new SpeechRun(text, this.planFor(who), synth, (settled) => {
      if (this.active === settled) this.active = null;
    });
    this.active = run;
    run.start();
    return run;
  }

  cancelAll(): void {
    this.active?.cancel();
    this.synth?.cancel();
  }

  private loadVoices(): void {
    if (!this.synth) return;
    const voices = new Map<string, SpeechSynthesisVoice>();
    const list = this.synth.getVoices();
    for (const voice of list) if (!voices.has(voice.name)) voices.set(voice.name, voice);
    this.voices = voices;
    if (this.locked) return;
    this.assignment = pickVoices(list, this.cast);
    this.prosody = prosodyFor(this.assignment, this.cast, this.speed);
  }

  private lockVoices(): void {
    if (this.locked) return;
    this.loadVoices();
    if (this.voices.size === 0) return; // keep listening: real voices may still arrive
    this.locked = true;
    this.synth?.removeEventListener("voiceschanged", this.onVoicesChanged);
  }

  private planFor(who: SpeakerId): SpeakPlan {
    const name = this.assignment[who];
    const voice = name ? (this.voices.get(name) ?? null) : null;
    const { rate, pitch } = this.prosody[who];
    return { voice, lang: voice?.lang || DEFAULT_LANG, rate, pitch };
  }
}

export interface VoiceOptions {
  /** How fast the panel speaks; "natural" by default. */
  speed?: VoiceSpeed;
}

/** Text-to-speech for this GD's cast: a distinct voice (or pitch) per participant. */
export function createVoice(cast: Cast, options: VoiceOptions = {}): Voice {
  return new BrowserVoice(cast, options.speed ?? "natural");
}
