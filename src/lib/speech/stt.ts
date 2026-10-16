// Speech-to-text for the candidate (browser SpeechRecognition / webkitSpeechRecognition).
//
// Chrome ends continuous recognition on its own (after silence, after ~60 s, on network
// hiccups), so the listener restarts itself while active, with a backoff when runs keep
// ending immediately. Every start() opens a new session; anything an old session delivers
// after stop() is dropped. Nothing here touches `window` at import time (SSR-safe).

import type { Listener, ListenerCallbacks, ListenerErrorKind } from "./types";

// Minimal shapes of the Web Speech recognition API (not part of TypeScript's lib.dom).
interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative | undefined;
}
interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult | undefined };
}
interface RecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

/** A run shorter than this counts as "ended immediately" for the restart backoff. */
const SHORT_RUN_MS = 1000;
/** Backoff after a short run: 250 ms, doubling, capped. Healthy runs restart at once. */
const RESTART_BASE_DELAY_MS = 250;
const RESTART_MAX_DELAY_MS = 3000;
/** Give up after this many short runs in a row (recognition is clearly not working). */
const MAX_SHORT_RUNS = 6;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when the browser offers speech recognition (Chrome, Edge, Safari). */
export function isRecognitionSupported(): boolean {
  return recognitionConstructor() !== null;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "name" in err ? String(err.name) : undefined;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Chrome on Android repeats earlier text in later results of a continuous session. On that
 * platform, new results are compared with the previous final and only the new words are kept.
 */
function repeatsEarlierResults(): boolean {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
}

class SpeechListener implements Listener {
  readonly supported: boolean;
  private isActive = false;
  /** Bumped on every start() and stop(); handlers of older sessions ignore their events. */
  private session = 0;
  private recognition: Recognition | null = null;
  /** Interim text currently shown (already delivered through onInterim). */
  private interim = "";
  /** Final transcripts already delivered in the current run, by result index. */
  private delivered: string[] = [];
  /** Raw text of the last final in this run (for the Android repeat workaround). */
  private lastFinal = "";
  private dedupeRepeats = false;
  private runStartedAt = 0;
  private shortRuns = 0;
  private networkTrouble = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly lang: string,
    private readonly cb: ListenerCallbacks,
  ) {
    this.supported = isRecognitionSupported();
  }

  get active(): boolean {
    return this.isActive;
  }

  start(): void {
    if (this.isActive) return;
    const Ctor = recognitionConstructor();
    if (!Ctor) {
      this.cb.onError("no-mic", "Speech recognition isn't available in this browser.");
      return;
    }
    let recognition: Recognition;
    try {
      recognition = new Ctor();
    } catch (err) {
      this.cb.onError("other", errorMessage(err, "Couldn't start speech recognition."));
      return;
    }
    const session = ++this.session;
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (session === this.session) this.handleResult(event);
    };
    recognition.onerror = (event) => {
      if (session === this.session) this.handleError(event);
    };
    recognition.onend = () => {
      if (session === this.session) this.handleEnd();
    };
    this.recognition = recognition;
    this.isActive = true;
    this.interim = "";
    this.shortRuns = 0;
    this.networkTrouble = false;
    this.dedupeRepeats = repeatsEarlierResults();
    this.run();
  }

  stop(): void {
    const recognition = this.recognition;
    this.isActive = false;
    this.session += 1;
    clearTimeout(this.restartTimer);
    this.recognition = null;
    // Whatever was still interim when the candidate stopped is the end of their turn: keep it.
    this.flushInterim();
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      // abort() releases the mic at once; late results would be dropped anyway.
      recognition.abort();
    } catch {
      // Already stopped.
    }
  }

  /** Starts (or restarts) a recognition run on the current recognition object. */
  private run(): void {
    const recognition = this.recognition;
    if (!recognition || !this.isActive) return;
    this.delivered = [];
    this.lastFinal = "";
    this.runStartedAt = now();
    try {
      recognition.start();
    } catch (err) {
      // InvalidStateError: it is already running (a restart raced the browser). Nothing to do.
      if (errorName(err) === "InvalidStateError") return;
      this.fail("other", errorMessage(err, "Couldn't start speech recognition."));
    }
  }

  private handleResult(event: RecognitionResultEvent): void {
    this.cb.onActivity();
    let interim = "";
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      const transcript = result[0]?.transcript ?? "";
      if (!result.isFinal) {
        interim += ` ${transcript}`;
        continue;
      }
      if (this.delivered[i] === transcript) continue; // already delivered
      this.delivered[i] = transcript;
      const text = clean(this.withoutRepeat(transcript));
      this.lastFinal = transcript;
      if (text) this.cb.onFinal(text);
    }
    this.interim = clean(this.withoutRepeat(interim));
    this.cb.onInterim(this.interim);
  }

  /** Android workaround: drop a repeat of the previous final from the start of `text`. */
  private withoutRepeat(text: string): string {
    const previous = clean(this.lastFinal);
    const current = clean(text);
    if (!this.dedupeRepeats || !previous) return current;
    if (!current.toLowerCase().startsWith(previous.toLowerCase())) return current;
    const rest = current.slice(previous.length);
    // Only a whole-word repeat counts ("I agree" vs "I agreed" is new text).
    return rest === "" || rest.startsWith(" ") ? rest : current;
  }

  private handleError(event: RecognitionErrorEvent): void {
    switch (event.error) {
      case "no-speech":
      case "aborted":
        // Silence, or the browser's own restart: onend follows and we restart.
        return;
      case "not-allowed":
      case "service-not-allowed":
        this.fail("not-allowed", "Microphone access is blocked for this site.");
        return;
      case "audio-capture":
        this.fail("no-mic", "No working microphone was found.");
        return;
      case "network":
        // Often transient: report it once and keep retrying (the backoff caps a dead network).
        if (!this.networkTrouble) {
          this.networkTrouble = true;
          this.cb.onError("network", "Speech recognition lost its connection. Retrying…");
        }
        return;
      case "language-not-supported":
        this.fail("other", `Speech recognition doesn't support the language "${this.lang}".`);
        return;
      default:
        this.cb.onError("other", event.message || `Speech recognition error: ${event.error}.`);
    }
  }

  private handleEnd(): void {
    // The run is over, so its interim text will never become final: keep it as said.
    this.flushInterim();
    if (!this.isActive) return;
    this.shortRuns = now() - this.runStartedAt < SHORT_RUN_MS ? this.shortRuns + 1 : 0;
    if (this.shortRuns > MAX_SHORT_RUNS) {
      this.fail(
        this.networkTrouble ? "network" : "other",
        "Speech recognition keeps stopping. Check your microphone and connection, or type instead.",
      );
      return;
    }
    const delay =
      this.shortRuns === 0 ? 0 : Math.min(RESTART_MAX_DELAY_MS, RESTART_BASE_DELAY_MS * 2 ** (this.shortRuns - 1));
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.run(), delay);
  }

  private flushInterim(): void {
    const pending = this.interim;
    if (!pending) return;
    this.interim = "";
    this.cb.onFinal(pending);
    this.cb.onInterim("");
  }

  /** Stops for good (keeping what was heard) and reports why. */
  private fail(kind: ListenerErrorKind, message: string): void {
    this.stop();
    this.cb.onError(kind, message);
  }
}

/** Speech-to-text listener for the candidate in BCP-47 language `lang` (e.g. "en-IN"). */
export function createListener(lang: string, cb: ListenerCallbacks): Listener {
  return new SpeechListener(lang, cb);
}
