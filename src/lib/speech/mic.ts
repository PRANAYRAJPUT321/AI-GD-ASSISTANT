// Live microphone level for the on-screen meter (Web Audio AnalyserNode), plus the one-off
// permission check used on the prep screen. Nothing here touches browser globals at import
// time (SSR-safe).

import type { MicMeter } from "./types";

export type MicPermission = "granted" | "denied" | "unavailable";

const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true },
};

/** How often the level is sampled (~30 Hz: smooth for the meter, cheap for the CPU). */
const SAMPLE_INTERVAL_MS = 33;
const FFT_SIZE = 1024;
/**
 * Loudness window mapped onto 0..1, in dBFS. With echo cancellation and noise suppression,
 * a quiet room sits below -56 dB and normal speech around -40..-20 dB (≈ 0.4..0.85).
 */
const FLOOR_DB = -56;
const CEILING_DB = -14;
/** Per-sample smoothing: rise quickly with the voice, fall back gently between words. */
const ATTACK = 0.55;
const RELEASE = 0.12;

/** Maps an RMS amplitude (0..1) to a 0..1 meter level on a decibel scale. */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)));
}

/** One smoothing step from the previous level towards a new reading. */
export function smoothLevel(previous: number, target: number): number {
  const factor = target > previous ? ATTACK : RELEASE;
  return previous + (target - previous) * factor;
}

function hasGetUserMedia(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

class AnalyserMicMeter implements MicMeter {
  /** The start in progress or completed; null when stopped. */
  private starting: Promise<void> | null = null;
  /** Bumped by stop(), so a start() still waiting for the mic knows to back out. */
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private current = 0;

  /**
   * Opens the mic and starts metering. Calling it again while started is a no-op. Never
   * rejects: the meter is cosmetic, so without a mic it simply reads 0 (the speech listener
   * is what reports microphone problems).
   */
  start(): Promise<void> {
    this.starting ??= this.open(this.generation);
    return this.starting;
  }

  level(): number {
    return this.current;
  }

  stop(): void {
    this.generation += 1;
    this.starting = null;
    clearInterval(this.timer);
    this.timer = undefined;
    this.source?.disconnect();
    if (this.stream) stopTracks(this.stream);
    const context = this.context;
    if (context && context.state !== "closed") context.close().catch(() => undefined);
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.samples = null;
    this.current = 0;
  }

  private async open(generation: number): Promise<void> {
    const AudioContextCtor = audioContextConstructor();
    if (!AudioContextCtor || !hasGetUserMedia()) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
    } catch {
      return;
    }
    if (generation !== this.generation) {
      // stop() was called while the permission prompt was open.
      stopTracks(stream);
      return;
    }
    let context: AudioContext;
    try {
      context = new AudioContextCtor();
    } catch {
      stopTracks(stream);
      return;
    }
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0; // we smooth the level ourselves
    const source = context.createMediaStreamSource(stream);
    // Analyser only, never connected to the speakers: no feedback loop.
    source.connect(analyser);

    this.stream = stream;
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    this.samples = new Float32Array(analyser.fftSize);
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    // A context created outside a user gesture starts suspended. Capturing the mic normally
    // lets it resume; don't block start() on it (until then the meter reads silence).
    if (context.state === "suspended") context.resume().catch(() => undefined);
  }

  private sample(): void {
    const analyser = this.analyser;
    const samples = this.samples;
    if (!analyser || !samples) return;
    analyser.getFloatTimeDomainData(samples);
    let sumOfSquares = 0;
    for (const value of samples) sumOfSquares += value * value;
    this.current = smoothLevel(this.current, levelFromRms(Math.sqrt(sumOfSquares / samples.length)));
  }
}

/** Live 0..1 microphone level for the candidate's audio-reactive meter. */
export function createMicMeter(): MicMeter {
  return new AnalyserMicMeter();
}

/**
 * Asks for microphone access (opening, then immediately closing, a stream) for the prep
 * screen's mic check. "unavailable": no mic API (e.g. an insecure origin) or no usable mic.
 */
export async function requestMicPermission(): Promise<MicPermission> {
  if (!hasGetUserMedia()) return "unavailable";
  try {
    const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
    stopTracks(stream);
    return "granted";
  } catch (err) {
    const name = typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
    return name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError"
      ? "denied"
      : "unavailable";
  }
}
