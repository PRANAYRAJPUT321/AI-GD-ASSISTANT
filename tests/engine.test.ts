import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { ApiCallError } from "@/lib/api";
import { GDEngine, type EngineTimings } from "@/lib/engine";
import type { Listener, ListenerCallbacks, ListenerErrorKind, MicMeter, SpeechHandle, Voice } from "@/lib/speech/types";
import type { EngineState, GDConfig, GDRecord, PersonaId, SpeakerId, Turn, TurnRequest, TurnResponse } from "@/lib/types";

// ---------- Fakes ----------

/** Speaks at `msPerChar`; supports cancel and a time-based spokenChars, like the browser voice. */
class FakeVoice implements Voice {
  readonly supported = true;
  readonly lines: { text: string; who: SpeakerId }[] = [];
  private readonly live = new Set<() => void>();

  constructor(private readonly msPerChar: number) {}

  get speaking(): boolean {
    return this.live.size > 0;
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  speak(text: string, who: SpeakerId): SpeechHandle {
    this.lines.push({ text, who });
    const started = Date.now();
    const duration = Math.max(15, text.length * this.msPerChar);
    let finished = false;
    let finalChars = 0;
    let resolve: (result: { completed: boolean; spokenChars: number }) => void = () => undefined;
    const done = new Promise<{ completed: boolean; spokenChars: number }>((r) => {
      resolve = r;
    });
    const spokenChars = () =>
      finished ? finalChars : Math.min(text.length, Math.floor(((Date.now() - started) / duration) * text.length));
    const finish = (completed: boolean) => {
      if (finished) return;
      finalChars = completed ? text.length : spokenChars();
      finished = true;
      clearTimeout(timer);
      this.live.delete(cancel);
      resolve({ completed, spokenChars: finalChars });
    };
    const cancel = () => finish(false);
    const timer = setTimeout(() => finish(true), duration);
    this.live.add(cancel);
    return { done, cancel, spokenChars };
  }

  cancelAll(): void {
    for (const cancel of [...this.live]) cancel();
  }
}

/** A listener the test drives: say() delivers a final result while it is listening. */
class FakeListener implements Listener {
  readonly supported = true;
  active = false;
  starts = 0;

  constructor(
    private readonly cb: ListenerCallbacks,
    private readonly failWith?: ListenerErrorKind,
  ) {}

  start(): void {
    this.starts += 1;
    if (this.failWith) {
      this.cb.onError(this.failWith, "Microphone access is blocked for this site.");
      return;
    }
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  say(text: string): void {
    if (!this.active) return;
    this.cb.onActivity();
    this.cb.onFinal(text);
    this.cb.onInterim("");
  }
}

class FakeMeter implements MicMeter {
  running = false;
  async start(): Promise<void> {
    this.running = true;
  }
  level(): number {
    return this.running ? 0.5 : 0;
  }
  stop(): void {
    this.running = false;
  }
}

interface ServerCall {
  id: number;
  req: TurnRequest;
  aborted: boolean;
  /** The server answered (or failed) on its own. */
  settled: boolean;
  /** An AI line was being spoken when the request went out (a prefetch). */
  duringSpeech: boolean;
}

/** /api/turn stand-in: numbered lines after `delayMs`; honours the abort signal. */
function fakeServer(voice: FakeVoice, delayMs: number, failure?: (req: TurnRequest) => unknown) {
  const calls: ServerCall[] = [];
  const requestTurn = (req: TurnRequest, signal?: AbortSignal) =>
    new Promise<TurnResponse>((resolve, reject) => {
      const call: ServerCall = { id: calls.length + 1, req, aborted: false, settled: false, duringSpeech: voice.speaking };
      calls.push(call);
      const onAbort = () => {
        clearTimeout(timer);
        call.aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        call.settled = true;
        const error = failure?.(req);
        if (error !== undefined) reject(error);
        else resolve({ text: lineFor(call) });
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  return { calls, requestTurn };
}

function lineFor(call: ServerCall): string {
  const { id, req } = call;
  if (req.mode === "interject") return `Sorry to cut in, but line ${id} says otherwise.`;
  if (req.mode === "summary") return `Summary line ${id}: both sides argued well, and on balance costs matter most.`;
  return `Line ${id} from ${req.speaker}. I think the evidence on this topic points somewhere interesting.`;
}

/** The server call that produced a spoken line. */
function callFor(calls: ServerCall[], text: string): ServerCall {
  const id = Number(/line (\d+)/i.exec(text)?.[1]);
  const call = calls.find((c) => c.id === id);
  assert.ok(call, `no call for "${text}"`);
  return call;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Harness ----------

const FAST: Partial<EngineTimings> = {
  openingWindowMs: 150,
  gapMinMs: 5,
  gapMaxMs: 10,
  postDriftGapMs: 15,
  silenceEndMs: 80,
  summarySilenceEndMs: 80,
  noSpeechMs: 150,
  summaryNoSpeechMs: 150,
  userTurnCapMs: 4000,
  summaryCapMs: 2000,
  timeUpGraceMs: 300,
  // Interjections are effectively off unless a test brings these forward.
  interjectFirstMinMs: 60_000,
  interjectFirstMaxMs: 60_000,
  interjectRecheckMs: 30,
  holdWindowMs: 120,
  failurePauseMs: 20,
  tickMs: 10,
  fastTickMs: 5,
  prefetchCutoffMs: 50,
};

interface Options {
  minutes?: number;
  inputMode?: GDConfig["inputMode"];
  timings?: Partial<EngineTimings>;
  msPerChar?: number;
  delayMs?: number;
  failure?: (req: TurnRequest) => unknown;
  listenerFails?: ListenerErrorKind;
}

const engines: GDEngine[] = [];

function setup(options: Options = {}) {
  const voice = new FakeVoice(options.msPerChar ?? 0.5);
  const server = fakeServer(voice, options.delayMs ?? 5, options.failure);
  const meter = new FakeMeter();
  const listeners: FakeListener[] = [];
  const config: GDConfig = {
    topic: { id: "business:test", title: "Should companies adopt a four-day work week?", category: "business" },
    userName: "Priya",
    minutes: options.minutes ?? 0.05,
    sttLang: "en-IN",
    inputMode: options.inputMode ?? "voice",
    token: "test-token",
    notes: "my private notes",
  };
  const engine = new GDEngine(config, {
    voice,
    createListener: (cb) => {
      const listener = new FakeListener(cb, options.listenerFails);
      listeners.push(listener);
      return listener;
    },
    micMeter: meter,
    requestTurn: server.requestTurn,
    random: seeded(7),
    timings: { ...FAST, ...options.timings },
  });
  engines.push(engine);
  const states: EngineState[] = [];
  engine.subscribe((s) => states.push(s));
  const records: GDRecord[] = [];
  engine.onDone((r) => records.push(r));
  const listener = () => {
    assert.equal(listeners.length, 1, "one listener per GD");
    return listeners[0];
  };
  return { engine, voice, server, meter, listeners, listener, states, records };
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(engine: GDEngine, what: string, done: (s: EngineState) => boolean, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const state = engine.getState();
    if (done(state)) return state;
    if (Date.now() - started > timeoutMs) {
      const { status, floor, activeSpeaker, caption, notice, error } = state;
      throw new Error(`Timed out waiting for ${what}: ${JSON.stringify({ status, floor, activeSpeaker, caption, notice, error })}`);
    }
    await sleep(2);
  }
}

const isPersona = (s: SpeakerId): s is PersonaId => s !== "user" && s !== "moderator";
const discussionAi = (s: EngineState) => s.transcript.filter((t) => t.phase === "discussion" && isPersona(t.speaker));
const last = (s: EngineState): Turn => {
  const turn = s.transcript.at(-1);
  assert.ok(turn);
  return turn;
};
const aiSpeaking = (s: EngineState) => s.floor === "ai" && s.activeSpeaker !== null && isPersona(s.activeSpeaker);
const words = (n: number, word = "costs") => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");

// ---------- Tests ----------

describe("GDEngine", () => {
  test("moderator intro, then the AI participants take turns, prefetching the next line", async () => {
    const { engine, voice, server, states } = setup({ minutes: 0.05 });
    engine.start();

    // The intro is spoken synchronously inside start() (user-gesture rules for speech).
    assert.equal(voice.lines[0]?.who, "moderator");
    assert.match(voice.lines[0].text, /^Good (morning|afternoon|evening), everyone\. Today's topic is: Should companies/);
    const intro = engine.getState();
    assert.equal(intro.status, "intro");
    assert.equal(intro.activeSpeaker, "moderator");
    assert.equal(intro.canJumpIn, false);
    engine.jumpIn(); // ignored during the intro
    assert.equal(engine.getState().floor, "ai");

    const s = await until(engine, "three AI turns", (st) => discussionAi(st).length >= 3);
    assert.equal(s.transcript[0].speaker, "moderator");
    assert.equal(s.transcript[0].phase, "intro");
    assert.ok(s.discussionStartMs !== null && s.discussionStartMs >= s.transcript[0].endMs);

    const ai = discussionAi(s);
    assert.equal(ai[0].speaker, "dominator");
    assert.equal(ai[0].cue, "open");
    for (let i = 1; i < ai.length; i++) assert.notEqual(ai[i].speaker, ai[i - 1].speaker, "no speaker twice in a row");
    for (const turn of ai) {
      assert.ok(!turn.interrupted);
      assert.ok(turn.endMs >= turn.startMs);
      assert.ok(Object.isFrozen(turn));
    }

    // Requests carry the session, topic and the transcript the line follows.
    const first = callFor(server.calls, ai[0].text);
    assert.equal(first.req.token, "test-token");
    assert.equal(first.req.userName, "Priya");
    assert.equal(first.req.mode, "turn");
    assert.equal(first.req.totalSec, 3);
    assert.deepEqual(first.req.transcript.map((t) => t.speaker), ["moderator"]);
    // The second line was written while the first one was being spoken, assuming it finished.
    const second = callFor(server.calls, ai[1].text);
    assert.equal(second.duringSpeech, true);
    assert.equal(second.req.transcript.at(-1)?.text, ai[0].text);

    // Immutable snapshots: a new frozen object per publish; old arrays never change.
    assert.ok(states.length > 20, "published on changes and ticks");
    const lengths = states.map((st) => st.transcript.length);
    for (let i = 1; i < states.length; i++) assert.notEqual(states[i], states[i - 1]);
    states.forEach((st, i) => {
      assert.ok(Object.isFrozen(st) && Object.isFrozen(st.transcript));
      assert.equal(st.transcript.length, lengths[i]);
    });
    // Live caption progress while a line plays.
    assert.ok(states.some((st) => aiSpeaking(st) && st.captionSpokenChars > 0 && st.captionSpokenChars <= st.caption.length));
  });

  test("jumping in mid-speech cuts the AI line to what was spoken; silence ends the candidate's turn", async () => {
    const { engine, voice, server, listener, meter } = setup({ minutes: 0.1, msPerChar: 4 });
    engine.start();
    const speaking = await until(engine, "an AI line well under way", (s) => aiSpeaking(s) && s.captionSpokenChars >= 20);
    const line = speaking.caption;
    const cutSpeaker = speaking.activeSpeaker;
    const callsBefore = server.calls.length;

    engine.jumpIn();
    const jumped = engine.getState();
    assert.equal(jumped.floor, "user");
    assert.equal(jumped.activeSpeaker, "user");
    assert.equal(jumped.canJumpIn, false);
    assert.equal(jumped.preparing, null);
    assert.equal(voice.speaking, false, "the AI voice was cancelled");
    assert.equal(listener().active, true);
    assert.equal(meter.running, true);

    const cut = last(jumped);
    assert.equal(cut.speaker, cutSpeaker);
    assert.equal(cut.interrupted, true);
    assert.equal(cut.interruptedBy, "user");
    assert.ok(cut.text.endsWith("—"));
    const spoken = cut.text.slice(0, -1);
    assert.ok(spoken.length >= 10 && spoken.length < line.length, `"${cut.text}"`);
    assert.ok(line.startsWith(spoken), "a prefix of the line");
    assert.match(line.charAt(spoken.length), /[\s.,]/, "cut at a word boundary");

    // The candidate speaks; their caption is live, the mic meter reads.
    await sleep(20);
    listener().say("I think the four day week works only for knowledge workers.");
    const live = engine.getState();
    assert.equal(live.caption, "I think the four day week works only for knowledge workers.");
    await sleep(15);
    assert.equal(engine.getState().micLevel, 0.5);
    const saidAt = engine.getState().nowMs;

    const after = await until(engine, "the floor to reopen after silence", (s) => s.floor !== "user");
    const mine = after.transcript.find((t) => t.speaker === "user");
    assert.ok(mine);
    assert.equal(mine.text, "I think the four day week works only for knowledge workers.");
    assert.ok(Math.abs(mine.startMs - cut.endMs) <= 5, "starts at the jump-in");
    assert.ok(mine.endMs <= saidAt + 5, "ends at the last speech, not the silence timeout");
    assert.ok(!mine.continuation && !mine.typed);
    assert.equal(listener().active, false);
    assert.equal(meter.running, false);

    // The next line is written for the new transcript (the prefetch made before the cut is dropped).
    const next = await until(engine, "the next AI line", (s) => discussionAi(s).length > discussionAi(after).length);
    const reply = discussionAi(next).at(-1);
    assert.ok(reply);
    const call = callFor(server.calls, reply.text);
    assert.ok(call.id > callsBefore);
    assert.equal(call.req.transcript.at(-1)?.speaker, "user");
    assert.ok(["respond-user", "agree-user", "late-strong", "drift"].includes(call.req.cue), call.req.cue);
  });

  test("a jump-in while a line is being fetched aborts it; the next line follows the candidate", async () => {
    // No prefetching, and a slow server: the loop visibly waits for each line.
    const { engine, voice, server, listener } = setup({ minutes: 0.1, delayMs: 250, timings: { prefetchCutoffMs: 60_000 } });
    engine.start();
    const fetching = await until(engine, "a line being fetched", (s) => s.status === "discussion" && s.preparing !== null);
    assert.equal(fetching.floor, "open");
    assert.equal(fetching.canJumpIn, true);
    const inFlight = server.calls.at(-1);
    assert.ok(inFlight && !inFlight.settled);

    engine.jumpIn();
    const jumped = engine.getState();
    assert.equal(jumped.floor, "user");
    assert.equal(jumped.preparing, null);
    assert.equal(inFlight.aborted, true);

    listener().say("Let me open: a four-day week is really about measuring output.");
    await until(engine, "the candidate's turn to end", (s) => s.floor !== "user");
    const next = await until(engine, "the first AI line", (s) => discussionAi(s).length > 0);
    assert.equal(callFor(server.calls, discussionAi(next)[0].text).req.transcript.at(-1)?.speaker, "user");
    assert.ok(!voice.lines.some((l) => l.text.startsWith(`Line ${inFlight.id} `)), "the aborted line is never spoken");
  });

  test("a jump-in during the pause before a line is spoken drops that line", async () => {
    const { engine, voice, server } = setup({
      minutes: 0.1,
      // The candidate keeps the floor (silently) for the whole check.
      timings: { prefetchCutoffMs: 60_000, gapMinMs: 500, gapMaxMs: 500, noSpeechMs: 5000 },
    });
    engine.start();
    const pausing = await until(
      engine,
      "a fetched line waiting for its pause",
      (s) => s.status === "discussion" && s.preparing !== null && server.calls.at(-1)?.settled === true,
    );
    assert.equal(pausing.floor, "open");
    const ready = server.calls.at(-1);
    assert.ok(ready);
    engine.jumpIn();
    assert.equal(engine.getState().floor, "user");
    assert.equal(engine.getState().preparing, null);
    await sleep(600); // past the pause: the dropped line must not play
    assert.ok(!voice.lines.some((l) => l.text.startsWith(`Line ${ready.id} `)));
    assert.equal(engine.getState().floor, "user");
    assert.equal(discussionAi(engine.getState()).length, 0);
  });

  test("a turn with no speech records nothing and the floor reopens", async () => {
    const { engine, listener } = setup({ minutes: 0.1 });
    engine.start();
    await until(engine, "the opening window", (s) => s.status === "discussion" && s.canJumpIn);
    engine.jumpIn();
    assert.equal(listener().active, true);
    const after = await until(engine, "the no-speech timeout", (s) => s.floor !== "user");
    assert.equal(after.notice, "Didn't catch that. Check your mic.");
    assert.ok(!after.transcript.some((t) => t.speaker === "user"));
    // Nobody has opened yet, so the dominator opens.
    const opened = await until(engine, "the opener", (s) => discussionAi(s).length > 0);
    assert.equal(discussionAi(opened)[0].speaker, "dominator");
    assert.equal(discussionAi(opened)[0].cue, "open");
  });

  test("the dominator cuts in on a long turn; carrying on holds the floor and starts a continuation", async () => {
    const { engine, server, listener } = setup({
      minutes: 0.15,
      msPerChar: 2,
      timings: { interjectFirstMinMs: 40, interjectFirstMaxMs: 40, silenceEndMs: 400 },
    });
    engine.start();
    await until(engine, "the opening window", (s) => s.status === "discussion" && s.canJumpIn);
    engine.jumpIn();
    const opening = words(12);
    listener().say(opening);
    // Too few words at the first check: it re-checks.
    await sleep(60);
    assert.ok(!server.calls.some((c) => c.req.mode === "interject"));
    const more = words(12, "workers");
    listener().say(more);

    const cutIn = await until(engine, "the interjection to play", (s) => s.activeSpeaker === "dominator");
    assert.equal(cutIn.floor, "user", "the candidate still holds the floor");
    assert.equal(cutIn.canJumpIn, false);
    const request = server.calls.find((c) => c.req.mode === "interject");
    assert.ok(request);
    assert.equal(request.req.speaker, "dominator");
    assert.equal(request.req.partialUserText, `${opening} ${more}`);
    const split = last(cutIn);
    assert.equal(split.speaker, "user");
    assert.equal(split.text, `${opening} ${more}`);
    assert.equal(split.interrupted, true);
    assert.equal(split.interruptedBy, "dominator");
    assert.equal(cutIn.interruptions.length, 1);
    assert.equal(cutIn.interruptions[0].outcome, "pending");
    assert.equal(cutIn.interruptions[0].userTextBefore, `${opening} ${more}`);

    // The mic hears the speakers during the interjection: ignored.
    listener().say("echo of the dominator");
    const holding = await until(engine, "the hold window", (s) => s.activeSpeaker === "user" && s.floor === "user");
    assert.equal(listener().starts, 2, "recognition restarted after the interjection");
    assert.equal(last(holding).kind, "interjection");
    assert.equal(last(holding).speaker, "dominator");
    assert.equal(holding.interruptions[0].interjectionTurnId, last(holding).id);

    listener().say("Let me finish my point about productivity.");
    assert.equal(engine.getState().interruptions[0].outcome, "held");
    const done = await until(engine, "the continuation to end", (s) => s.floor !== "user");
    const tail = done.transcript.slice(-3);
    assert.deepEqual(
      tail.map((t) => [t.speaker, t.kind]),
      [
        ["user", "turn"],
        ["dominator", "interjection"],
        ["user", "turn"],
      ],
    );
    assert.equal(tail[2].continuation, true);
    assert.equal(tail[2].text, "Let me finish my point about productivity.");
    assert.ok(tail[1].startMs >= tail[0].endMs && tail[2].startMs >= tail[1].endMs, "in time order");
    assert.ok(!done.transcript.some((t) => t.text.includes("echo")));
    assert.equal(done.interruptions[0].outcome, "held");
  });

  test("going quiet after the interjection yields: the dominator carries on", async () => {
    const { engine, server, listener } = setup({
      minutes: 0.15,
      msPerChar: 1,
      timings: { interjectFirstMinMs: 30, interjectFirstMaxMs: 30, silenceEndMs: 400 },
    });
    engine.start();
    await until(engine, "the opening window", (s) => s.status === "discussion" && s.canJumpIn);
    engine.jumpIn();
    listener().say(words(25));
    await until(engine, "the interjection", (s) => s.activeSpeaker === "dominator");
    const yielded = await until(engine, "the yield", (s) => s.floor !== "user");
    assert.equal(yielded.interruptions[0].outcome, "yielded");
    assert.ok(!yielded.transcript.some((t) => t.continuation), "nothing recorded after the interjection");

    const next = await until(engine, "the dominator's follow-up", (s) => last(s).kind === "turn" && isPersona(last(s).speaker));
    const followUp = last(next);
    assert.equal(followUp.speaker, "dominator");
    assert.equal(followUp.cue, "continue-after-interjection");
    assert.equal(callFor(server.calls, followUp.text).req.transcript.at(-1)?.kind, "interjection");
  });

  test("time up: candidate summary, the smart one's summary, the moderator closes; onDone fires once", async () => {
    const { engine, server, listener, records } = setup({ minutes: 0.02 });
    engine.start();
    const asked = await until(engine, "the candidate's summary turn", (s) => s.status === "closing" && s.floor === "user", 8000);
    assert.equal(asked.phase, "summary");
    assert.equal(asked.canJumpIn, false);
    assert.equal(asked.userPrompt, "Summarise the discussion: main points from both sides, then a conclusion.");
    assert.equal(asked.userTurnSecondsLeft, 2);
    assert.match(last(asked).text, /^Thank you, everyone, that's time\. .* Priya, would you summarise the discussion for us\?$/);
    assert.equal(last(asked).phase, "summary");

    listener().say("To summarise, we weighed productivity against costs, and I conclude a pilot is wise.");
    const done = await until(engine, "the end", (s) => s.status === "done", 8000);
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.transcript, done.transcript);
    assert.equal(record.config.userName, "Priya");
    assert.equal(record.config.inputMode, "voice");
    assert.ok(!("token" in record.config) && !("notes" in record.config));
    assert.ok(record.discussionEndMs - record.discussionStartMs >= 0.02 * 60000 - 5);

    const closing = record.transcript.filter((t) => t.phase === "summary");
    assert.deepEqual(
      closing.map((t) => [t.speaker, t.kind]),
      [
        ["moderator", "moderator"],
        ["user", "summary"],
        ["smart", "summary"],
        ["moderator", "moderator"],
      ],
    );
    assert.equal(closing[3].text, "Thank you all. That brings us to the end of the discussion.");
    const summaryCall = callFor(server.calls, closing[2].text);
    assert.equal(summaryCall.req.mode, "summary");
    assert.equal(summaryCall.req.speaker, "smart");
    assert.equal(summaryCall.req.transcript.at(-1)?.speaker, "user");
    // No discussion turn after time was called.
    for (const turn of record.transcript.filter((t) => t.phase === "discussion")) {
      assert.ok(turn.startMs <= record.discussionEndMs);
    }

    engine.endNow();
    await sleep(30);
    assert.equal(records.length, 1, "onDone fires exactly once");
    assert.equal(listener().active, false);
  });

  test("time up while the candidate holds the floor: a short grace, then their turn ends", async () => {
    const { engine, listener, records } = setup({ minutes: 0.02, timings: { silenceEndMs: 1000, summaryNoSpeechMs: 60 } });
    engine.start();
    await until(engine, "the discussion", (s) => s.status === "discussion" && s.canJumpIn);
    engine.jumpIn();
    const talking = setInterval(() => listener().say("and another point"), 40);
    try {
      const timeUp = await until(engine, "time up", (s) => s.discussionStartMs !== null && s.nowMs > s.discussionStartMs + 1250);
      assert.equal(timeUp.floor, "user", "still talking within the grace period");
      assert.equal(timeUp.canJumpIn, false);
      const closing = await until(engine, "the closing", (s) => s.status === "closing");
      assert.ok(closing.discussionStartMs !== null);
      const graceEnd = closing.transcript.find((t) => t.speaker === "user");
      assert.ok(graceEnd);
      assert.ok(graceEnd.endMs <= closing.discussionStartMs + 1200 + 300 + 100, "ended by the grace period");
    } finally {
      clearInterval(talking);
    }
    // Nothing said in the summary: the moderator moves on.
    const done = await until(engine, "the end", (s) => s.status === "done", 8000);
    assert.ok(done.transcript.some((t) => t.text === "Alright, let's move on."));
    assert.equal(records.length, 1);
  });

  test("endNow mid-discussion closes the record at once, with the AI line cut", async () => {
    const { engine, voice, records } = setup({ minutes: 0.1, msPerChar: 4 });
    engine.start();
    await until(engine, "an AI line", (s) => aiSpeaking(s) && s.captionSpokenChars > 10);
    engine.endNow();
    const done = engine.getState();
    assert.equal(done.status, "done");
    assert.equal(done.canJumpIn, false);
    assert.equal(voice.speaking, false);
    assert.equal(records.length, 1);
    const cut = records[0].transcript.at(-1);
    assert.ok(cut && cut.interrupted && cut.interruptedBy === undefined && cut.text.endsWith("—"));
    assert.ok(records[0].discussionEndMs >= records[0].discussionStartMs);
    engine.endNow();
    engine.stop();
    assert.equal(records.length, 1);

    // A handler registered after the end still gets the record, once.
    const late: GDRecord[] = [];
    engine.onDone((r) => late.push(r));
    assert.deepEqual(late, [records[0]]);
  });

  test("stop() tears everything down without firing onDone or leaving timers behind", async () => {
    const { engine, voice, server, listener, meter, states, records } = setup({
      minutes: 0.1,
      delayMs: 200,
      timings: { interjectFirstMinMs: 100, interjectFirstMaxMs: 100 },
    });
    engine.start();
    await until(engine, "the discussion", (s) => s.status === "discussion" && s.canJumpIn);
    assert.ok(server.calls.some((c) => !c.aborted), "the opener is being written");
    engine.jumpIn();
    listener().say("Something worth saying here.");
    engine.stop();

    assert.equal(listener().active, false);
    assert.equal(meter.running, false);
    assert.equal(voice.speaking, false);
    assert.ok(server.calls.every((c) => c.aborted), "every request was aborted");
    const published = states.length;
    await sleep(40);
    assert.equal(states.length, published, "no publishes after stop");
    assert.equal(records.length, 0);
    assert.deepEqual(
      process.getActiveResourcesInfo().filter((r) => r === "Timeout"),
      [],
      "no timers left",
    );
    engine.jumpIn();
    engine.endNow();
    assert.equal(records.length, 0);
  });

  test("text mode: typed turns, no listener, no interjections", async () => {
    const { engine, server, listeners } = setup({
      minutes: 0.1,
      inputMode: "text",
      timings: { interjectFirstMinMs: 20, interjectFirstMaxMs: 20 },
    });
    engine.start();
    await until(engine, "an AI line", (s) => aiSpeaking(s));
    engine.jumpIn();
    assert.equal(engine.getState().floor, "user");
    await sleep(120); // no silence timer, no interjection
    assert.equal(engine.getState().floor, "user");
    assert.ok(!server.calls.some((c) => c.req.mode === "interject"));

    engine.submitTyped("  A four-day week   needs output metrics, not hours. ");
    const typed = engine.getState();
    assert.equal(typed.floor, "open");
    const mine = last(typed);
    assert.equal(mine.speaker, "user");
    assert.equal(mine.text, "A four-day week needs output metrics, not hours.");
    assert.equal(mine.typed, true);
    assert.ok(mine.endMs >= mine.startMs + 100);

    await until(engine, "the floor open again", (s) => s.canJumpIn);
    engine.jumpIn();
    engine.submitTyped("   ");
    assert.equal(engine.getState().notice, "Nothing was typed, so the floor is open again.");
    assert.equal(engine.getState().transcript.filter((t) => t.speaker === "user").length, 1);
    assert.equal(listeners.length, 0, "the microphone is never touched");
    assert.equal(engine.inputMode, "text");
  });

  test("a blocked microphone switches the GD to typing instead of failing", async () => {
    const { engine, records } = setup({ minutes: 0.1, listenerFails: "not-allowed" });
    engine.start();
    await until(engine, "the opening window", (s) => s.status === "discussion" && s.canJumpIn);
    engine.jumpIn();
    const switched = engine.getState();
    assert.equal(engine.inputMode, "text");
    assert.equal(switched.floor, "user", "they keep the floor and type");
    assert.match(switched.notice ?? "", /blocked.*Switched to typing/);
    assert.equal(switched.micLevel, 0);
    engine.submitTyped("Typed instead.");
    assert.equal(last(engine.getState()).typed, true);
    engine.endNow();
    assert.equal(records[0].config.inputMode, "text");
  });

  test("three failed lines in a row stop the GD with an error; endNow still produces a record", async () => {
    const { engine, server, states, records } = setup({ minutes: 0.1, failure: () => ({ status: 502 }) });
    engine.start();
    const failed = await until(engine, "the error", (s) => s.status === "error");
    assert.match(failed.error ?? "", /stopped responding/);
    assert.equal(failed.canJumpIn, false);
    assert.equal(server.calls.length, 3);
    const speakers = server.calls.map((c) => c.req.speaker);
    for (let i = 1; i < speakers.length; i++) assert.notEqual(speakers[i], speakers[i - 1], "another speaker after a failure");
    assert.ok(states.some((s) => s.status === "discussion" && /Asking someone else/.test(s.notice ?? "")));
    assert.equal(failed.transcript.length, 1, "the transcript is kept");

    engine.endNow();
    assert.equal(records.length, 1);
    assert.equal(engine.getState().status, "done");
    assert.equal(records[0].transcript.length, 1);
  });

  test("an expired session (401 bad_token) is fatal at once; other thrown values are retried", async () => {
    const expired = setup({ minutes: 0.1, failure: () => new ApiCallError("Session expired", 401, "bad_token") });
    expired.engine.start();
    const failed = await until(expired.engine, "the error", (s) => s.status === "error");
    assert.match(failed.error ?? "", /no longer valid/);
    assert.equal(expired.server.calls.length, 1);

    let thrown = 0;
    const flaky = setup({ minutes: 0.1, failure: () => (++thrown === 1 ? "network down" : undefined) });
    flaky.engine.start();
    const recovered = await until(flaky.engine, "an AI line after a failure", (s) => discussionAi(s).length > 0);
    assert.equal(recovered.status, "discussion");
    assert.deepEqual(
      [discussionAi(recovered)[0].speaker, discussionAi(recovered)[0].cue],
      ["data", "open"],
      "someone else opens after the dominator's line failed",
    );
  });
});
