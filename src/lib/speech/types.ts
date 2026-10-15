import type { SpeakerId } from "../types";

/** One utterance in progress. */
export interface SpeechHandle {
  /** Resolves once speech finishes or is cancelled. Never rejects. */
  done: Promise<{ completed: boolean; spokenChars: number }>;
  /** Stop speaking now; `done` resolves with completed=false. */
  cancel(): void;
  /** Best-effort count of characters spoken so far (boundary events, else a time estimate). */
  spokenChars(): number;
}

/** Text-to-speech for the AI participants and the moderator (browser speechSynthesis). */
export interface Voice {
  /** false when the browser has no speechSynthesis; speak() then resolves after a reading-time delay so the GD still runs with captions. */
  readonly supported: boolean;
  /** Resolves when system voices are loaded (or after a short timeout). */
  ready(): Promise<void>;
  speak(text: string, who: SpeakerId): SpeechHandle;
  cancelAll(): void;
}

export type ListenerErrorKind = "not-allowed" | "no-mic" | "network" | "other";

export interface ListenerCallbacks {
  /** Current not-yet-final text (replaces the previous interim). */
  onInterim(text: string): void;
  /** A finalised chunk of speech; append it. */
  onFinal(text: string): void;
  /** Any recognition result arrived (voice activity). */
  onActivity(): void;
  onError(kind: ListenerErrorKind, message: string): void;
}

/** Speech-to-text for the candidate (browser SpeechRecognition). */
export interface Listener {
  readonly supported: boolean;
  readonly active: boolean;
  /** Start listening; restarts itself if the browser ends recognition while active. */
  start(): void;
  /** Stop listening. Pending interim text is delivered through onFinal before this returns where possible. */
  stop(): void;
}

/** Live microphone level for the on-screen meter (Web Audio AnalyserNode). */
export interface MicMeter {
  start(): Promise<void>;
  /** 0..1 smoothed RMS level. 0 when not started. */
  level(): number;
  stop(): void;
}
