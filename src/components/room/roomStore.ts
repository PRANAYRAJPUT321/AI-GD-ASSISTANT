// The room's external store: wraps the engine's snapshots with what the UI needs to know
// about *changes* between them (when the current speaker started, and the toasts that
// events like an interruption raise). React reads it with useSyncExternalStore, so render
// stays pure and nothing has to diff states inside an effect.

import type { GDEngine } from "@/lib/engine";
import type { Cast } from "@/lib/personas";
import type { EngineState, GDConfig } from "@/lib/types";
import { idleState, nameOf } from "./model";

/** What the room calls on the engine. A structural subset of GDEngine, so tests can fake it. */
export type EngineControls = Pick<
  GDEngine,
  "subscribe" | "start" | "jumpIn" | "doneSpeaking" | "submitTyped" | "endNow" | "stop"
>;

export type ToastTone = "info" | "good" | "warn";
export type ToastKind = "cut-in" | "held" | "yielded" | "you-cut" | "opened" | "notice" | "text-mode";

export interface RoomToast {
  /** Stable per event: an interruption's outcome replaces its own "cut in" toast. */
  id: string;
  kind: ToastKind;
  tone: ToastTone;
  title: string;
  body: string | null;
}

export interface ToastEvent extends RoomToast {
  ttlMs: number;
}

export interface RoomSnapshot {
  engine: EngineControls | null;
  state: EngineState;
  /** state.nowMs when the current activeSpeaker started (for the live airtime). */
  speakerSinceMs: number;
  toasts: readonly RoomToast[];
  /** A live microphone level is available for the candidate's meter. */
  hasMicMeter: boolean;
}

const TOAST_MS = 5000;
const NOTICE_TOAST_MS = 6500;
const TEXT_MODE_TOAST_MS = 10000;
const MAX_TOASTS = 3;

/**
 * The toasts raised by going from `prev` to `next`: a new interruption, its outcome, the
 * candidate cutting someone off or opening the GD, a new notice, the switch to typing.
 */
export function deriveToasts(prev: EngineState, next: EngineState, cast: Cast): ToastEvent[] {
  const events: ToastEvent[] = [];
  const name = (id: Parameters<typeof nameOf>[0]) => nameOf(id, cast);

  // An AI cut in on the candidate, and later how they handled it.
  const before = new Map(prev.interruptions.map((event) => [event.id, event]));
  for (const event of next.interruptions) {
    const earlier = before.get(event.id);
    const id = `cut-in:${event.id}`;
    if (!earlier) {
      events.push({
        id,
        kind: "cut-in",
        tone: "warn",
        title: `${name(event.by)} cut in.`,
        body: "Keep talking to hold your ground.",
        ttlMs: TOAST_MS,
      });
    } else if (earlier.outcome !== event.outcome && event.outcome === "held") {
      events.push({
        id,
        kind: "held",
        tone: "good",
        title: "You held your ground",
        body: `${name(event.by)} couldn't take the floor from you.`,
        ttlMs: TOAST_MS,
      });
    } else if (earlier.outcome !== event.outcome && event.outcome === "yielded") {
      events.push({
        id,
        kind: "yielded",
        tone: "info",
        title: "You yielded the floor",
        body: `${name(event.by)} carries on. Jump back in when you're ready.`,
        ttlMs: TOAST_MS,
      });
    }
  }

  // The candidate cut an AI off (a newly recorded turn interrupted by the user).
  const known = new Set(prev.transcript.map((turn) => turn.id));
  for (const turn of next.transcript) {
    if (known.has(turn.id) || turn.interruptedBy !== "user" || turn.speaker === "user") continue;
    events.push({
      id: `you-cut:${turn.id}`,
      kind: "you-cut",
      tone: "info",
      title: `You cut ${name(turn.speaker)} off`,
      body: "Make your point count.",
      ttlMs: TOAST_MS,
    });
  }

  // The candidate took the floor before any AI had spoken: they opened the GD.
  const tookFloor = prev.floor !== "user" && next.floor === "user" && next.phase === "discussion";
  const othersSpoke = next.transcript.some(
    (turn) => turn.phase === "discussion" && turn.speaker !== "moderator" && turn.speaker !== "user",
  );
  const spokeBefore = next.transcript.some((turn) => turn.phase === "discussion" && turn.speaker === "user");
  if (tookFloor && !othersSpoke && !spokeBefore) {
    events.push({
      id: "opened",
      kind: "opened",
      tone: "good",
      title: "You're opening the GD",
      body: "Frame the topic, take a stand, outline your angles.",
      ttlMs: TOAST_MS,
    });
  }

  // The engine's notices; a microphone failure gets its own "typing" toast instead.
  const switchedToText = prev.inputMode === "voice" && next.inputMode === "text";
  if (switchedToText) {
    events.push({
      id: "text-mode",
      kind: "text-mode",
      tone: "warn",
      title: "Switched to typing",
      body: next.notice ?? "Your microphone isn't available, so you'll type your turns.",
      ttlMs: TEXT_MODE_TOAST_MS,
    });
  } else if (next.notice && next.notice !== prev.notice) {
    events.push({
      id: `notice:${next.nowMs}`,
      kind: "notice",
      tone: "warn",
      title: next.notice,
      body: null,
      ttlMs: NOTICE_TOAST_MS,
    });
  }
  return events;
}

/**
 * Holds the engine attached to the room and a cached RoomSnapshot. getSnapshot returns the
 * same object until something changes, as useSyncExternalStore requires.
 */
export class RoomStore {
  private snapshot: RoomSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly config: GDConfig,
    private readonly cast: Cast,
  ) {
    this.snapshot = this.empty();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RoomSnapshot => this.snapshot;

  /** Follows `engine` from now on (replacing any engine attached before). */
  attach(engine: EngineControls, options: { hasMicMeter: boolean }): void {
    this.release();
    this.snapshot = { ...this.empty(), engine, hasMicMeter: options.hasMicMeter };
    let initial = true;
    // subscribe() delivers the current state synchronously: that one raises no toasts.
    this.unsubscribe = engine.subscribe((state) => this.receive(state, initial));
    initial = false;
  }

  /** Stops following `engine` (ignored if another engine was attached since). */
  detach(engine: EngineControls): void {
    if (this.snapshot.engine !== engine) return;
    this.release();
    this.snapshot = this.empty();
    this.emit();
  }

  dismissToast = (id: string): void => {
    this.clearTimer(id);
    const toasts = this.snapshot.toasts.filter((toast) => toast.id !== id);
    if (toasts.length === this.snapshot.toasts.length) return;
    this.snapshot = { ...this.snapshot, toasts };
    this.emit();
  };

  private receive(state: EngineState, initial: boolean): void {
    const previous = this.snapshot;
    const prev = previous.state;
    const speakerSinceMs = initial || state.activeSpeaker !== prev.activeSpeaker ? state.nowMs : previous.speakerSinceMs;
    let toasts = previous.toasts;
    if (!initial) {
      for (const event of deriveToasts(prev, state, this.cast)) toasts = this.show(toasts, event);
    }
    this.snapshot = { ...previous, state, speakerSinceMs, toasts };
    this.emit();
  }

  /** Adds `event` (or replaces the toast with its id in place), keeping the newest few. */
  private show(toasts: readonly RoomToast[], event: ToastEvent): readonly RoomToast[] {
    const { ttlMs, ...toast } = event;
    this.clearTimer(toast.id);
    this.timers.set(
      toast.id,
      setTimeout(() => {
        this.timers.delete(toast.id);
        this.dismissToast(toast.id);
      }, ttlMs),
    );
    const replaced = toasts.some((item) => item.id === toast.id);
    const next = replaced ? toasts.map((item) => (item.id === toast.id ? toast : item)) : [...toasts, toast];
    for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) this.clearTimer(dropped.id);
    return next.slice(-MAX_TOASTS);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
  }

  private release(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private empty(): RoomSnapshot {
    return { engine: null, state: idleState(this.config), speakerSinceMs: 0, toasts: [], hasMicMeter: false };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
