// Tests for the room's pure view model and its store. Run with:
//   node --import tsx --test tests/room.test.ts (or npm test)

import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";

import { GDEngine } from "@/lib/engine";
import { castFor } from "@/lib/personas";
import type { SpeechHandle, Voice } from "@/lib/speech/types";
import type { EngineState, GDConfig, InterruptionEvent, Turn, TurnResponse } from "@/lib/types";
import {
  airtimeMs,
  captionWords,
  clockMilestone,
  clockTone,
  CUT_OFF_FLASH_MS,
  floorControl,
  formatAirtime,
  formatClock,
  idleState,
  REACTION_MS,
  recentlyCutOff,
  seatReactions,
  spokenWordCount,
  stageStatus,
  timeLeftMs,
  turnCounts,
  turnStamp,
} from "@/components/room/model";
import { deriveToasts, RoomStore, type EngineControls } from "@/components/room/roomStore";

const CONFIG: GDConfig = {
  topic: { id: "t", title: "Is brand loyalty dead?", category: "business" },
  userName: "Priya",
  minutes: 10,
  sttLang: "en-IN",
  inputMode: "voice",
  token: "token",
  notes: "",
};
const cast = castFor(CONFIG.userName);

/** A discussion in progress: the clock started at 10 s, now is 70 s. */
function live(overrides: Partial<EngineState> = {}): EngineState {
  return {
    ...idleState(CONFIG),
    status: "discussion",
    phase: "discussion",
    discussionStartMs: 10_000,
    nowMs: 70_000,
    canJumpIn: true,
    ...overrides,
  };
}

let seq = 0;
function turn(fields: Partial<Turn> & Pick<Turn, "speaker" | "startMs" | "endMs">): Turn {
  seq += 1;
  return { id: `t${seq}`, text: "Something was said here.", phase: "discussion", kind: "turn", ...fields };
}

describe("time", () => {
  test("formats clocks and airtime", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(65.9), "1:05");
    assert.equal(formatClock(-3), "0:00");
    assert.equal(formatAirtime(42_400), "42s");
    assert.equal(formatAirtime(65_000), "1m 05s");
  });

  test("time left counts from the start of the discussion", () => {
    assert.equal(timeLeftMs(idleState(CONFIG)), 600_000);
    assert.equal(timeLeftMs(live()), 540_000);
    assert.equal(timeLeftMs(live({ nowMs: 700_000 })), 0);
    assert.equal(timeLeftMs(live({ status: "closing", phase: "summary" })), 0);
  });

  test("the clock warns in the last two minutes and alarms in the last 30 s", () => {
    assert.equal(clockTone(121_000), "calm");
    assert.equal(clockTone(120_000), "warn");
    assert.equal(clockTone(30_000), "danger");
    assert.equal(clockMilestone(live()), "");
    assert.equal(clockMilestone(live({ nowMs: 10_000 + 500_000 })), "2 minutes of discussion left.");
    assert.equal(clockMilestone(live({ nowMs: 10_000 + 580_000 })), "30 seconds of discussion left.");
    assert.equal(clockMilestone(live({ nowMs: 10_000 + 600_000 })), "Discussion time is up.");
    assert.equal(clockMilestone(idleState(CONFIG)), "");
  });

  test("transcript stamps are m:ss from the discussion start", () => {
    assert.equal(turnStamp(turn({ speaker: "dominator", startMs: 75_000, endMs: 80_000 }), 10_000), "1:05");
    assert.equal(turnStamp(turn({ speaker: "moderator", startMs: 0, endMs: 9_000, phase: "intro" }), 10_000), "Intro");
  });
});

describe("airtime and turns", () => {
  test("sums discussion turns per participant and adds the live speaker", () => {
    const state = live({
      transcript: [
        turn({ speaker: "moderator", startMs: 0, endMs: 10_000, phase: "intro", kind: "moderator" }),
        turn({ speaker: "dominator", startMs: 12_000, endMs: 30_000 }),
        turn({ speaker: "user", startMs: 30_000, endMs: 40_000 }),
        turn({ speaker: "dominator", startMs: 40_000, endMs: 45_000, kind: "interjection" }),
      ],
      activeSpeaker: "data",
      nowMs: 60_000,
    });
    const airtime = airtimeMs(state, 50_000);
    assert.deepEqual(airtime, { user: 10_000, dominator: 23_000, data: 10_000, agreer: 0, drifter: 0, smart: 0 });
  });

  test("the moderator and the summary phase never count", () => {
    const state = live({
      status: "closing",
      phase: "summary",
      transcript: [turn({ speaker: "user", startMs: 600_000, endMs: 650_000, phase: "summary", kind: "summary" })],
      activeSpeaker: "smart",
      nowMs: 700_000,
    });
    assert.equal(Object.values(airtimeMs(state, 690_000)).reduce((a, b) => a + b, 0), 0);
  });

  test("turn counts skip continuations and include the line being spoken", () => {
    const cut = turn({ speaker: "user", startMs: 20_000, endMs: 40_000, interrupted: true, interruptedBy: "dominator" });
    const interjection = turn({ speaker: "dominator", startMs: 40_000, endMs: 44_000, kind: "interjection" });
    const holding = live({ transcript: [cut, interjection], floor: "user", activeSpeaker: "user", canJumpIn: false });
    assert.equal(turnCounts(holding).user, 1, "waiting out the hold window is not a new turn");
    assert.equal(turnCounts(holding).dominator, 1);

    const continuation = turn({ speaker: "user", startMs: 45_000, endMs: 55_000, continuation: true });
    const after = live({ transcript: [cut, interjection, continuation], activeSpeaker: "agreer" });
    assert.deepEqual(turnCounts(after), { user: 1, dominator: 1, data: 0, agreer: 1, drifter: 0, smart: 0 });
  });

  test("a cut-off flashes on the seat for a couple of seconds", () => {
    const cut = turn({ speaker: "data", startMs: 20_000, endMs: 30_000, interrupted: true, interruptedBy: "user" });
    assert.ok(recentlyCutOff(live({ transcript: [cut], nowMs: 31_000 })).has("data"));
    assert.ok(!recentlyCutOff(live({ transcript: [cut], nowMs: 30_000 + CUT_OFF_FLASH_MS })).has("data"));
    // Only the speaker's latest turn matters.
    const later = turn({ speaker: "data", startMs: 31_000, endMs: 40_000 });
    assert.ok(!recentlyCutOff(live({ transcript: [cut, later], nowMs: 31_000 })).has("data"));
  });

  test("a listener reacts in character for a moment after a turn ends", () => {
    const line = turn({ speaker: "dominator", startMs: 20_000, endMs: 30_000 });
    const reactions = seatReactions(live({ transcript: [line], nowMs: 31_000 }));
    assert.equal(reactions.size, 1);
    const [[reactor, reaction]] = [...reactions];
    assert.notEqual(reactor, "dominator", "the speaker doesn't react to themselves");
    assert.ok(reaction.emoji);
    assert.deepEqual(seatReactions(live({ transcript: [line], nowMs: 32_000 })).get(reactor), reaction, "stable across renders");
    assert.equal(seatReactions(live({ transcript: [line], nowMs: 30_000 + REACTION_MS })).size, 0, "then it fades");
  });

  test("the agreer cheers the candidate; the moderator and the intro get no reactions", () => {
    const mine = turn({ speaker: "user", startMs: 20_000, endMs: 30_000 });
    const cheer = seatReactions(live({ transcript: [mine], nowMs: 30_500 })).get("agreer");
    assert.ok(cheer && ["👍", "👏", "💯"].includes(cheer.emoji));
    const moderator = turn({ speaker: "moderator", startMs: 20_000, endMs: 30_000, kind: "moderator" });
    assert.equal(seatReactions(live({ transcript: [moderator], nowMs: 30_500 })).size, 0);
    const intro = turn({ speaker: "data", startMs: 1_000, endMs: 5_000, phase: "intro" });
    assert.equal(seatReactions(live({ transcript: [intro], nowMs: 5_500 })).size, 0);
  });
});

describe("floor control", () => {
  test("blocked before the start, during the intro and after time is up", () => {
    assert.equal(floorControl(idleState(CONFIG), cast).kind, "blocked");
    const intro = floorControl({ ...idleState(CONFIG), status: "intro", activeSpeaker: "moderator" }, cast);
    assert.equal(intro.kind, "blocked");
    assert.match(intro.kind === "blocked" ? intro.reason : "", /moderator/i);
    const timeUp = floorControl(live({ nowMs: 10_000 + 600_000, canJumpIn: false, activeSpeaker: "data" }), cast);
    assert.match(timeUp.kind === "blocked" ? timeUp.reason : "", /time's up/i);
  });

  test("jump in names the speaker being cut off, and urges when the floor is open", () => {
    const cutting = floorControl(live({ activeSpeaker: "dominator", floor: "ai" }), cast);
    assert.equal(cutting.kind, "jump");
    assert.ok(cutting.kind === "jump" && !cutting.urgent && cutting.hint.includes(cast.dominator.name));
    const open = floorControl(live({ preparing: "data" }), cast);
    assert.ok(open.kind === "jump" && open.urgent && open.hint.includes(cast.data.name));
    const opening = floorControl(live(), cast);
    assert.ok(opening.kind === "jump" && /open the GD/i.test(opening.hint));
  });

  test("while the candidate holds the floor: Done, Send in text mode, yield during an interjection", () => {
    const voice = floorControl(live({ floor: "user", activeSpeaker: "user", canJumpIn: false }), cast);
    assert.ok(voice.kind === "hold" && voice.action === "done" && voice.listening);
    const text = floorControl(live({ floor: "user", activeSpeaker: "user", canJumpIn: false, inputMode: "text" }), cast);
    assert.ok(text.kind === "hold" && text.action === "send");
    const interjected = floorControl(live({ floor: "user", activeSpeaker: "dominator", canJumpIn: false }), cast);
    assert.ok(interjected.kind === "hold" && interjected.action === "done" && !interjected.listening);
    assert.ok(interjected.kind === "hold" && interjected.hint.includes(cast.dominator.name));
  });

  test("summaries: only the candidate's own summary turn", () => {
    const closing = live({ status: "closing", phase: "summary", canJumpIn: false, activeSpeaker: "moderator" });
    assert.equal(floorControl(closing, cast).kind, "blocked");
    const summary = floorControl({ ...closing, activeSpeaker: "user", floor: "user", userPrompt: "Summarise" }, cast);
    assert.ok(summary.kind === "hold" && summary.action === "done");
    assert.equal(floorControl({ ...closing, status: "done" }, cast).kind, "none");
    assert.equal(floorControl({ ...closing, status: "error", error: "x" }, cast).kind, "none");
  });
});

describe("stage status and captions", () => {
  test("describes who is speaking, cutting in, about to speak, or that the floor is open", () => {
    assert.equal(stageStatus(live({ activeSpeaker: "data", floor: "ai" }), cast).text, `${cast.data.name} is speaking`);
    assert.equal(
      stageStatus(live({ activeSpeaker: "dominator", floor: "user" }), cast).text,
      `${cast.dominator.name} is cutting in on you`,
    );
    assert.equal(stageStatus(live({ preparing: "smart" }), cast).text, `${cast.smart.name} is about to speak`);
    assert.equal(stageStatus(live(), cast).tone, "open");
    assert.equal(stageStatus(live({ activeSpeaker: "user", floor: "user" }), cast).text, "You have the floor");
  });

  test("words are spoken once their first character has been reached", () => {
    const words = captionWords("We must, frankly, act now.");
    assert.deepEqual(
      words.map((word) => [word.text, word.start]),
      [
        ["We", 0],
        ["must,", 3],
        ["frankly,", 9],
        ["act", 18],
        ["now.", 22],
      ],
    );
    assert.equal(spokenWordCount(words, 0), 0);
    assert.equal(spokenWordCount(words, 1), 1);
    assert.equal(spokenWordCount(words, 9), 2);
    assert.equal(spokenWordCount(words, 10), 3);
    assert.equal(spokenWordCount(words, 999), 5);
  });
});

describe("toasts", () => {
  const event = (outcome: InterruptionEvent["outcome"]): InterruptionEvent => ({
    id: "i1",
    atMs: 40_000,
    by: "dominator",
    interjectionTurnId: "t9",
    userTextBefore: "I think",
    outcome,
  });

  test("an interruption, then its outcome under the same id", () => {
    const before = live({ floor: "user", activeSpeaker: "user" });
    const cutIn = live({ floor: "user", activeSpeaker: "dominator", interruptions: [event("pending")] });
    const [raised] = deriveToasts(before, cutIn, cast);
    assert.equal(raised.kind, "cut-in");
    assert.equal(raised.title, `${cast.dominator.name} cut in.`);
    assert.equal(raised.body, "Keep talking to hold your ground.");

    const held = deriveToasts(cutIn, { ...cutIn, interruptions: [event("held")] }, cast);
    assert.deepEqual(
      held.map((toast) => [toast.id, toast.kind, toast.title]),
      [[raised.id, "held", "You held your ground"]],
    );
    const yielded = deriveToasts(cutIn, { ...cutIn, interruptions: [event("yielded")] }, cast);
    assert.equal(yielded[0].title, "You yielded the floor");
  });

  test("the candidate cutting someone off, and opening the GD", () => {
    const cut = turn({ speaker: "data", startMs: 20_000, endMs: 25_000, interrupted: true, interruptedBy: "user" });
    const toasts = deriveToasts(live(), live({ transcript: [cut], floor: "user", activeSpeaker: "user" }), cast);
    assert.deepEqual(
      toasts.map((toast) => toast.title),
      [`You cut ${cast.data.name} off`],
    );
    const opened = deriveToasts(live(), live({ floor: "user", activeSpeaker: "user", canJumpIn: false }), cast);
    assert.deepEqual(
      opened.map((toast) => toast.kind),
      ["opened"],
    );
  });

  test("notices, and the switch to typing as one toast", () => {
    const notice = deriveToasts(live(), live({ notice: "Couldn't get Meera's line." }), cast);
    assert.deepEqual(
      notice.map((toast) => [toast.kind, toast.title]),
      [["notice", "Couldn't get Meera's line."]],
    );
    const switched = deriveToasts(live(), live({ inputMode: "text", notice: "Mic blocked. Switched to typing." }), cast);
    assert.deepEqual(
      switched.map((toast) => [toast.kind, toast.body]),
      [["text-mode", "Mic blocked. Switched to typing."]],
    );
    assert.deepEqual(deriveToasts(live({ notice: "Same" }), live({ notice: "Same" }), cast), []);
  });
});

/** An engine stand-in the test drives by publishing states. */
class FakeEngine implements EngineControls {
  private listener: ((state: EngineState) => void) | null = null;
  constructor(private state: EngineState) {}
  subscribe(fn: (state: EngineState) => void): () => void {
    this.listener = fn;
    fn(this.state);
    return () => {
      this.listener = null;
    };
  }
  publish(state: EngineState): void {
    this.state = state;
    this.listener?.(state);
  }
  get subscribed(): boolean {
    return this.listener !== null;
  }
  start(): void {}
  jumpIn(): void {}
  doneSpeaking(): void {}
  submitTyped(): void {}
  endNow(): void {}
  stop(): void {}
}

describe("RoomStore", () => {
  test("tracks when the current speaker started and keeps snapshots stable", () => {
    const store = new RoomStore(CONFIG, cast);
    const engine = new FakeEngine(live({ nowMs: 20_000 }));
    let changes = 0;
    store.subscribe(() => changes++);
    store.attach(engine, { hasMicMeter: true });
    const first = store.getSnapshot();
    assert.equal(first.engine, engine);
    assert.equal(first.hasMicMeter, true);
    assert.equal(store.getSnapshot(), first, "same object until something changes");

    engine.publish(live({ nowMs: 21_000, activeSpeaker: "data", floor: "ai" }));
    assert.equal(store.getSnapshot().speakerSinceMs, 21_000);
    engine.publish(live({ nowMs: 24_000, activeSpeaker: "data", floor: "ai" }));
    assert.equal(store.getSnapshot().speakerSinceMs, 21_000);
    assert.ok(changes >= 3);

    store.detach(engine);
    assert.equal(engine.subscribed, false);
    assert.equal(store.getSnapshot().engine, null);
    assert.equal(store.getSnapshot().state.status, "idle");
  });

  test("detaching a stale engine is ignored (StrictMode remount order)", () => {
    const store = new RoomStore(CONFIG, cast);
    const first = new FakeEngine(live());
    const second = new FakeEngine(live());
    store.attach(first, { hasMicMeter: false });
    store.attach(second, { hasMicMeter: false });
    assert.equal(first.subscribed, false);
    store.detach(first);
    assert.equal(store.getSnapshot().engine, second);
  });

  test("toasts appear, update in place, expire and can be dismissed", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const store = new RoomStore(CONFIG, cast);
      // The candidate already holds the floor when the dominator cuts in.
      const engine = new FakeEngine(live({ notice: "Old notice", floor: "user", activeSpeaker: "user" }));
      store.attach(engine, { hasMicMeter: true });
      assert.equal(store.getSnapshot().toasts.length, 0, "the state at attach raises nothing");

      const pending: InterruptionEvent = {
        id: "i1",
        atMs: 1,
        by: "dominator",
        interjectionTurnId: "t1",
        userTextBefore: "",
        outcome: "pending",
      };
      engine.publish(live({ interruptions: [pending], floor: "user", activeSpeaker: "dominator" }));
      assert.deepEqual(
        store.getSnapshot().toasts.map((toast) => toast.kind),
        ["cut-in"],
      );
      engine.publish(live({ interruptions: [{ ...pending, outcome: "held" }], floor: "user", activeSpeaker: "user" }));
      assert.deepEqual(
        store.getSnapshot().toasts.map((toast) => toast.kind),
        ["held"],
      );

      engine.publish(live({ interruptions: [{ ...pending, outcome: "held" }], notice: "A" }));
      const id = store.getSnapshot().toasts.find((toast) => toast.kind === "notice")?.id;
      assert.ok(id);
      store.dismissToast(id);
      assert.equal(store.getSnapshot().toasts.length, 1);

      mock.timers.tick(5000);
      assert.equal(store.getSnapshot().toasts.length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  test("keeps at most three toasts", () => {
    const store = new RoomStore(CONFIG, cast);
    const engine = new FakeEngine(live());
    store.attach(engine, { hasMicMeter: false });
    for (const notice of ["one", "two", "three", "four"]) engine.publish(live({ notice, nowMs: notice.length * 1000 + seq++ }));
    assert.deepEqual(
      store.getSnapshot().toasts.map((toast) => toast.title),
      ["two", "three", "four"],
    );
    store.detach(engine);
  });
});

/** Speaks at a fixed pace; spokenChars follows the clock like the browser voice. */
class PacedVoice implements Voice {
  readonly supported = true;
  ready(): Promise<void> {
    return Promise.resolve();
  }
  speak(text: string): SpeechHandle {
    const started = Date.now();
    const duration = text.length * 2;
    let settle: (result: { completed: boolean; spokenChars: number }) => void = () => undefined;
    const done = new Promise<{ completed: boolean; spokenChars: number }>((resolve) => {
      settle = resolve;
    });
    const spokenChars = () => Math.min(text.length, Math.floor(((Date.now() - started) / duration) * text.length));
    const timer = setTimeout(() => settle({ completed: true, spokenChars: text.length }), duration);
    return {
      done,
      spokenChars,
      cancel: () => {
        clearTimeout(timer);
        settle({ completed: false, spokenChars: spokenChars() });
      },
    };
  }
  cancelAll(): void {}
}

function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (check()) resolve();
      else if (Date.now() > deadline) reject(new Error("timed out"));
      else setTimeout(poll, 5);
    };
    poll();
  });
}

describe("RoomStore with the real engine", () => {
  test("cutting off a speaking AI raises a toast and moves the floor to the candidate", async () => {
    const store = new RoomStore(CONFIG, cast);
    const line = "Let me be very clear about this, the loyalty economy has changed for good and brands know it well.";
    const engine = new GDEngine(CONFIG, {
      voice: new PacedVoice(),
      createListener: () => ({ supported: true, active: false, start() {}, stop() {} }),
      requestTurn: (): Promise<TurnResponse> => new Promise((resolve) => setTimeout(() => resolve({ text: line }), 5)),
      timings: { openingWindowMs: 10, gapMinMs: 1, gapMaxMs: 2, tickMs: 10, fastTickMs: 10 },
    });
    store.attach(engine, { hasMicMeter: false });
    try {
      engine.start();
      await until(() => {
        const { state } = store.getSnapshot();
        return state.status === "discussion" && state.activeSpeaker === "dominator" && state.captionSpokenChars > 20;
      });
      assert.equal(floorControl(store.getSnapshot().state, cast).kind, "jump");

      engine.jumpIn();
      const { state, toasts, speakerSinceMs } = store.getSnapshot();
      assert.equal(state.activeSpeaker, "user");
      assert.equal(speakerSinceMs, state.nowMs);
      assert.ok(toasts.some((toast) => toast.title === `You cut ${cast.dominator.name} off`));
      assert.ok(recentlyCutOff(state).has("dominator"));
      assert.equal(floorControl(state, cast).kind, "hold");
    } finally {
      store.detach(engine);
      engine.stop();
    }
  });
});
