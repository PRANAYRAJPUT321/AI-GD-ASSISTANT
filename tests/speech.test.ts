import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

import { castFor } from "@/lib/personas";
import type { ListenerErrorKind } from "@/lib/speech/types";
import {
  createListener,
  createMicMeter,
  createVoice,
  estimateDurationMs,
  levelFromRms,
  panelAccent,
  pickVoices,
  prosodyFor,
  requestMicPermission,
  SENTENCE_PAUSE_MS,
  smoothLevel,
  splitSentences,
  voiceGender,
  type TextChunk,
  type VoiceInfo,
} from "@/lib/speech";

const cast = castFor("Priya");
const globals = globalThis as { window?: unknown };
/** Amplitude for a level in dBFS. */
const db = (value: number) => 10 ** (value / 20);

afterEach(() => {
  delete globals.window;
  mock.timers.reset();
});

/** Chunks are in order, never overlap, map back to the source and cover every word. */
function assertFaithful(text: string, chunks: TextChunk[]): void {
  let previousEnd = 0;
  for (const chunk of chunks) {
    assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(chunk.start >= previousEnd, "chunks overlap or are out of order");
    assert.equal(chunk.text, chunk.text.trim());
    assert.ok(chunk.text.length > 0);
    previousEnd = chunk.end;
  }
  const squash = (s: string) => s.replace(/\s+/g, "");
  assert.equal(chunks.map((c) => squash(c.text)).join(""), squash(text));
}

describe("splitSentences", () => {
  test("splits on sentence ends and keeps offsets into the original text", () => {
    const text = "  Good morning, everyone. Today's topic is: Zero!  Whoever is ready may begin?\nYes";
    const chunks = splitSentences(text);
    assert.deepEqual(
      chunks.map((c) => c.text),
      ["Good morning, everyone.", "Today's topic is: Zero!", "Whoever is ready may begin?", "Yes"],
    );
    assert.equal(chunks[0].start, 2);
    assert.equal(chunks[1].start, text.indexOf("Today's"));
    assert.equal(chunks[3].end, text.length);
    assertFaithful(text, chunks);
  });

  test("does not split on abbreviations, initials or decimals", () => {
    const text = "Dr. Rao says the U.S. grew 2.5 per cent, e.g. in services. Rs. 500 crore is a lot.";
    assert.deepEqual(
      splitSentences(text).map((c) => c.text),
      ["Dr. Rao says the U.S. grew 2.5 per cent, e.g. in services.", "Rs. 500 crore is a lot."],
    );
  });

  test("handles ellipses and closing quotes", () => {
    const text = 'He said "no." Then he left... Fine?';
    assert.deepEqual(splitSentences(text).map((c) => c.text), ['He said "no."', "Then he left...", "Fine?"]);
  });

  test("breaks a long sentence at commas or semicolons, each piece at most 220 chars", () => {
    const clause = "and the gig economy gives flexibility to millions of young workers in our cities";
    const text = `Look, ${Array.from({ length: 6 }, () => clause).join(", ")}; that is the real point. Short one.`;
    const chunks = splitSentences(text);
    assertFaithful(text, chunks);
    assert.ok(chunks.length >= 4);
    for (const chunk of chunks) assert.ok(chunk.text.length <= 220, `too long: ${chunk.text.length}`);
    // Every piece of the long sentence except its last ends at a clause break.
    for (const chunk of chunks.slice(0, -2)) assert.match(chunk.text, /[,;]$/);
    assert.equal(chunks.at(-1)?.text, "Short one.");
  });

  test("breaks a long sentence without punctuation between words", () => {
    const text = `${"growth jobs exports services manufacturing ".repeat(12).trim()}.`;
    const chunks = splitSentences(text);
    assertFaithful(text, chunks);
    assert.ok(chunks.length >= 3);
    for (const chunk of chunks) {
      assert.ok(chunk.text.length <= 220);
      assert.ok(chunk.start === 0 || /\s/.test(text[chunk.start - 1]), "piece starts mid-word");
      assert.ok(chunk.end === text.length || /\s/.test(text[chunk.end]), "piece ends mid-word");
    }
  });

  test("returns nothing for empty or blank text", () => {
    assert.deepEqual(splitSentences(""), []);
    assert.deepEqual(splitSentences("  \n "), []);
  });
});

describe("estimateDurationMs", () => {
  test("is about 14 characters per second at rate 1 and scales with rate", () => {
    const text = "x".repeat(140);
    assert.equal(estimateDurationMs(text, 1), 10_000);
    assert.equal(estimateDurationMs(text, 2), 5_000);
    assert.equal(estimateDurationMs(text, 0.5), 20_000);
    assert.equal(estimateDurationMs(text), 10_000);
  });

  test("is 0 for blank text and treats invalid rates as 1", () => {
    assert.equal(estimateDurationMs("", 1), 0);
    assert.equal(estimateDurationMs("   ", 1), 0);
    const text = "x".repeat(70);
    for (const rate of [0, -1, Number.NaN]) assert.equal(estimateDurationMs(text, rate), 5_000);
  });
});

/** The voices Chrome typically exposes on Windows. */
const CHROME_WINDOWS: VoiceInfo[] = [
  { name: "Microsoft David - English (United States)", lang: "en-US", localService: true, default: true },
  { name: "Microsoft Mark - English (United States)", lang: "en-US", localService: true },
  { name: "Microsoft Zira - English (United States)", lang: "en-US", localService: true },
  { name: "Microsoft Heera - English (India)", lang: "en-IN", localService: true },
  { name: "Microsoft Ravi - English (India)", lang: "en-IN", localService: true },
  { name: "Google Deutsch", lang: "de-DE", localService: false },
  { name: "Google US English", lang: "en-US", localService: false },
  { name: "Google UK English Female", lang: "en-GB", localService: false },
  { name: "Google UK English Male", lang: "en-GB", localService: false },
  { name: "Google हिन्दी", lang: "hi-IN", localService: false },
];

/** The same without its Indian voices: enough distinct English voices for every speaker. */
const WINDOWS_NO_INDIAN = CHROME_WINDOWS.filter((voice) => !/India|हिन्दी/.test(voice.name));

/** Chrome on a Mac or Linux laptop: Google's network voices, no English (India) one. */
const CHROME_DESKTOP: VoiceInfo[] = [
  { name: "Google US English", lang: "en-US", localService: false },
  { name: "Google UK English Female", lang: "en-GB", localService: false },
  { name: "Google UK English Male", lang: "en-GB", localService: false },
  { name: "Google हिन्दी", lang: "hi-IN", localService: false },
];

const SPEAKERS = ["moderator", "dominator", "data", "agreer", "drifter", "smart"] as const;
const FEMALE = ["moderator", "data", "smart"] as const;
const MALE = ["dominator", "agreer", "drifter"] as const;

describe("voiceGender", () => {
  test("reads gender from well-known voice names", () => {
    assert.equal(voiceGender("Google UK English Female"), "female");
    assert.equal(voiceGender("Google UK English Male"), "male");
    assert.equal(voiceGender("Google US English"), "female");
    assert.equal(voiceGender("Microsoft Neerja Online (Natural) - English (India)"), "female");
    assert.equal(voiceGender("Microsoft Prabhat Online (Natural) - English (India)"), "male");
    assert.equal(voiceGender("Daniel (Enhanced)"), "male");
    assert.equal(voiceGender("English India"), null);
  });
});

describe("pickVoices", () => {
  test("uses only Indian voices when the browser has any, shared by gender", () => {
    const picks = pickVoices(CHROME_WINDOWS, cast);
    assert.equal(picks.user, null);
    // Female: moderator, data (Meera), smart (Ananya). Male: dominator, agreer, drifter.
    for (const id of FEMALE) assert.equal(picks[id], "Microsoft Heera - English (India)");
    for (const id of MALE) assert.equal(picks[id], "Microsoft Ravi - English (India)");
  });

  test("keeps an unnamed English (India) voice to itself, as on Android", () => {
    const voices: VoiceInfo[] = [
      { name: "English United Kingdom", lang: "en-GB" },
      { name: "English India", lang: "en_IN" },
      { name: "English United States", lang: "en-US" },
    ];
    const picks = pickVoices(voices, cast);
    for (const id of SPEAKERS) assert.equal(picks[id], "English India");
  });

  test("without an English (India) voice, uses Chrome's Hindi voice for an Indian accent", () => {
    const picks = pickVoices(CHROME_DESKTOP, cast);
    for (const id of SPEAKERS) assert.equal(picks[id], "Google हिन्दी");
    assert.deepEqual(panelAccent(CHROME_DESKTOP), { accent: "indian-hindi", voices: ["Google हिन्दी"] });
  });

  test("never uses a classic Hindi voice that may not read English", () => {
    const voices: VoiceInfo[] = [
      { name: "Microsoft Kalpana - Hindi (India)", lang: "hi-IN" },
      { name: "Google UK English Female", lang: "en-GB" },
    ];
    const picks = pickVoices(voices, cast);
    for (const id of SPEAKERS) assert.equal(picks[id], "Google UK English Female");
    assert.equal(panelAccent(voices).accent, "british");
  });

  test("reports the panel's accent for the setup screen", () => {
    assert.deepEqual(panelAccent(CHROME_WINDOWS), {
      accent: "indian",
      voices: ["Microsoft Heera - English (India)", "Microsoft Ravi - English (India)"],
    });
    assert.equal(panelAccent(WINDOWS_NO_INDIAN).accent, "british");
    assert.equal(panelAccent([{ name: "Samantha", lang: "en-US" }]).accent, "american");
    assert.deepEqual(panelAccent([]), { accent: null, voices: [] });
  });

  test("without Indian voices: British, then American, matching gender, a distinct voice each", () => {
    const picks = pickVoices(WINDOWS_NO_INDIAN, cast);
    assert.equal(picks.moderator, "Google UK English Female");
    assert.equal(picks.data, "Google US English");
    assert.equal(picks.smart, "Microsoft Zira - English (United States)");
    assert.equal(picks.dominator, "Google UK English Male");
    assert.equal(picks.agreer, "Microsoft David - English (United States)");
    assert.equal(picks.drifter, "Microsoft Mark - English (United States)");
    assert.equal(new Set(SPEAKERS.map((id) => picks[id])).size, 6);
  });

  test("ranks accent before quality, and quality within an accent", () => {
    const voices: VoiceInfo[] = [
      { name: "Karen", lang: "en-AU" },
      { name: "Samantha", lang: "en-US" },
      { name: "Microsoft Hazel - English (United Kingdom)", lang: "en-GB" },
      { name: "Microsoft Sonia Online (Natural) - English (United Kingdom)", lang: "en_GB" },
    ];
    const picks = pickVoices(voices, cast);
    assert.equal(picks.moderator, "Microsoft Sonia Online (Natural) - English (United Kingdom)");
    assert.equal(picks.data, "Microsoft Hazel - English (United Kingdom)");
    assert.equal(picks.smart, "Samantha");
    // All voices here are female: the male personas get the leftovers (picked after the
    // female personas, though the dominator comes before Meera in assignment order).
    assert.equal(picks.dominator, "Karen");
    assert.ok(picks.agreer !== null && picks.drifter !== null);
  });

  test("shares a same-gender voice rather than using the other gender", () => {
    const voices: VoiceInfo[] = [
      { name: "Microsoft Zira - English (United States)", lang: "en-US" },
      { name: "Microsoft David - English (United States)", lang: "en-US" },
    ];
    const picks = pickVoices(voices, cast);
    for (const id of ["moderator", "data", "smart"] as const) assert.equal(picks[id], voices[0].name);
    for (const id of ["dominator", "agreer", "drifter"] as const) assert.equal(picks[id], voices[1].name);
  });

  test("gives distinct voices even when their gender is unknown", () => {
    const voices: VoiceInfo[] = [
      { name: "English United States", lang: "en-US" },
      { name: "English Australia", lang: "en-AU" },
      { name: "English United Kingdom", lang: "en-GB" },
    ];
    const picks = pickVoices(voices, cast);
    assert.deepEqual(
      [picks.moderator, picks.dominator, picks.data],
      ["English United Kingdom", "English United States", "English Australia"],
    );
    for (const id of ["agreer", "drifter", "smart"] as const) assert.ok(picks[id] !== null);
  });

  test("falls back to the only voice for everyone", () => {
    const picks = pickVoices([{ name: "Alex", lang: "en-US", default: true }], cast);
    for (const id of ["moderator", "dominator", "data", "agreer", "drifter", "smart"] as const) {
      assert.equal(picks[id], "Alex");
    }
    assert.equal(picks.user, null);
  });

  test("never picks novelty voices when a normal one exists", () => {
    const voices: VoiceInfo[] = [
      { name: "Bubbles", lang: "en-US" },
      { name: "Zarvox", lang: "en-US" },
      { name: "Samantha", lang: "en-US" },
    ];
    const picks = pickVoices(voices, cast);
    for (const name of Object.values(picks)) assert.ok(name === null || name === "Samantha");
  });

  test("returns null for everyone without English voices", () => {
    for (const voices of [[], [{ name: "Google Deutsch", lang: "de-DE" }]]) {
      const picks = pickVoices(voices, cast);
      assert.ok(Object.values(picks).every((name) => name === null));
    }
  });
});

describe("prosodyFor", () => {
  test("keeps each persona's profile when every speaker has a voice of their own", () => {
    const prosody = prosodyFor(pickVoices(WINDOWS_NO_INDIAN, cast), cast);
    for (const id of ["dominator", "data", "agreer", "drifter", "smart"] as const) {
      assert.deepEqual(prosody[id], { rate: cast[id].voice.rate, pitch: cast[id].voice.pitch });
    }
    assert.deepEqual(prosody.user, { rate: 1, pitch: 1 });
  });

  test("the speed setting scales every persona's rate, keeping their differences", () => {
    const picks = pickVoices(CHROME_WINDOWS, cast);
    const natural = prosodyFor(picks, cast);
    const relaxed = prosodyFor(picks, cast, "relaxed");
    const brisk = prosodyFor(picks, cast, "brisk");
    for (const id of SPEAKERS) {
      assert.ok(Math.abs(relaxed[id].rate - natural[id].rate * 0.85) < 1e-9);
      assert.ok(Math.abs(brisk[id].rate - natural[id].rate * 1.12) < 1e-9);
      assert.equal(relaxed[id].pitch, natural[id].pitch);
      assert.ok(natural[id].rate < 1, "every persona speaks below the engine's default rate");
    }
    assert.ok(natural.dominator.rate > natural.smart.rate, "the dominator still talks faster");
  });

  test("spreads pitches apart when speakers share a voice, male personas lower", () => {
    const prosody = prosodyFor(pickVoices([{ name: "English", lang: "en" }], cast), cast);
    const pitches = (["moderator", "dominator", "data", "agreer", "drifter", "smart"] as const).map(
      (id) => prosody[id].pitch,
    );
    assert.equal(new Set(pitches).size, 6);
    const male = Math.max(prosody.dominator.pitch, prosody.agreer.pitch, prosody.drifter.pitch);
    const female = Math.min(prosody.moderator.pitch, prosody.data.pitch, prosody.smart.pitch);
    assert.ok(male < female);
    assert.equal(prosody.dominator.rate, cast.dominator.voice.rate);
  });

  test("raises the pitch of a female persona given a male-sounding voice", () => {
    const picks = pickVoices(WINDOWS_NO_INDIAN, cast);
    const prosody = prosodyFor({ ...picks, data: "Microsoft Mark - English (United States)" }, cast);
    assert.ok(prosody.data.pitch > cast.data.voice.pitch);
  });
});

// ---------------------------------------------------------------------------
// Runtime behaviour with fake browser APIs
// ---------------------------------------------------------------------------

type Handler<E = void> = ((event: E) => void) | null;

class FakeUtterance {
  voice: { name: string } | null = null;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: Handler = null;
  onend: Handler = null;
  onerror: Handler<{ error: string }> = null;
  onboundary: Handler<{ charIndex: number; charLength: number; name: string }> = null;
  constructor(readonly text: string) {}
}

class FakeSynth {
  speaking = false;
  pending = false;
  paused = false;
  cancelCalls = 0;
  queue: FakeUtterance[] = [];
  private listeners = new Set<() => void>();
  constructor(private voices: VoiceInfo[]) {}
  getVoices() {
    return this.voices;
  }
  addEventListener(_type: string, fn: () => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_type: string, fn: () => void) {
    this.listeners.delete(fn);
  }
  speak(utterance: FakeUtterance) {
    this.queue.push(utterance);
  }
  cancel() {
    this.cancelCalls += 1;
    const dropped = this.queue;
    this.queue = [];
    for (const u of dropped) u.onerror?.({ error: "interrupted" });
  }
  resume() {
    this.paused = false;
  }
  // Test helpers acting as the speech engine.
  loadVoices(voices: VoiceInfo[]) {
    this.voices = voices;
    for (const fn of this.listeners) fn();
  }
  boundary(charIndex: number, charLength: number) {
    this.queue[0]?.onboundary?.({ charIndex, charLength, name: "word" });
  }
  end() {
    this.queue.shift()?.onend?.();
  }
  fail() {
    this.queue.shift()?.onerror?.({ error: "synthesis-failed" });
  }
}

function installSynth(voices: VoiceInfo[] = CHROME_WINDOWS): FakeSynth {
  const synth = new FakeSynth(voices);
  globals.window = { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance };
  return synth;
}

describe("createVoice", () => {
  test("speaks chunk by chunk with the speaker's voice and maps progress to the full line", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const synth = installSynth();
    const voice = createVoice(cast);
    assert.equal(voice.supported, true);
    await voice.ready();

    const line = "First sentence here. Second one follows.";
    const handle = voice.speak(line, "data");
    assert.equal(synth.cancelCalls, 1, "clears a stuck queue before the first line");
    assert.equal(synth.queue.length, 1, "queues one chunk at a time");
    const first = synth.queue[0];
    assert.equal(first.text, "First sentence here.");
    assert.equal(first.voice?.name, "Microsoft Heera - English (India)");
    assert.equal(first.lang, "en-IN");
    const expected = prosodyFor(pickVoices(CHROME_WINDOWS, cast), cast).data;
    assert.equal(first.rate, cast.data.voice.rate);
    assert.equal(first.pitch, expected.pitch);

    first.onstart?.();
    synth.boundary(6, 8); // "sentence"
    assert.equal(handle.spokenChars(), 14);
    synth.end();
    assert.equal(synth.queue.length, 0, "a short breath before the next sentence");
    assert.equal(handle.spokenChars(), line.indexOf("Second"), "progress holds during the pause");
    mock.timers.tick(SENTENCE_PAUSE_MS);
    assert.equal(synth.queue[0]?.text, "Second one follows.");
    synth.boundary(7, 3); // "one"
    assert.equal(handle.spokenChars(), line.indexOf("Second") + 10);
    synth.end();
    assert.deepEqual(await handle.done, { completed: true, spokenChars: line.length });
  });

  test("cancel() resolves at once with what was spoken", async () => {
    const synth = installSynth();
    const voice = createVoice(cast);
    const handle = voice.speak("One two three four. Five six.", "smart");
    synth.boundary(4, 3); // "two"
    handle.cancel();
    assert.deepEqual(await handle.done, { completed: false, spokenChars: 7 });
    assert.equal(synth.queue.length, 0);
    assert.equal(handle.spokenChars(), 7);
  });

  test("a new line cuts off the one still playing", async () => {
    const synth = installSynth();
    const voice = createVoice(cast);
    const first = voice.speak("Hello there everyone. More to say.", "dominator");
    synth.boundary(6, 5); // "there"
    const second = voice.speak("Next line.", "agreer");
    assert.deepEqual(await first.done, { completed: false, spokenChars: 11 });
    assert.equal(synth.queue.length, 1);
    assert.equal(synth.queue[0].text, "Next line.");
    synth.end();
    assert.equal((await second.done).completed, true);
  });

  test("moves on when a chunk's end event never arrives", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const synth = installSynth();
    const voice = createVoice(cast);
    const handle = voice.speak("Hi. Ok.", "moderator");
    const watchdogMs = estimateDurationMs("Hi.", synth.queue[0].rate) + 3000;

    mock.timers.tick(watchdogMs - 1);
    assert.deepEqual(synth.queue.map((u) => u.text), ["Hi."]);
    mock.timers.tick(1);
    assert.equal(handle.spokenChars(), "Hi. ".length);
    mock.timers.tick(SENTENCE_PAUSE_MS);
    // "Hi." is stuck in the fake engine; the line carries on with "Ok." regardless.
    assert.deepEqual(synth.queue.map((u) => u.text), ["Hi.", "Ok."]);
    synth.queue.shift();
    synth.end();
    assert.deepEqual(await handle.done, { completed: true, spokenChars: "Hi. Ok.".length });
  });

  test("an engine error on a chunk finishes it on the time estimate", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const synth = installSynth();
    const voice = createVoice(cast);
    const handle = voice.speak("Hi. Ok.", "data");
    synth.fail();
    assert.equal(synth.queue.length, 0, "nothing queued until the failed chunk's time is up");
    mock.timers.tick(estimateDurationMs("Hi.", cast.data.voice.rate));
    assert.equal(synth.queue.length, 0, "then the usual breath between sentences");
    mock.timers.tick(SENTENCE_PAUSE_MS);
    assert.equal(synth.queue[0]?.text, "Ok.");
    synth.end();
    assert.deepEqual(await handle.done, { completed: true, spokenChars: "Hi. Ok.".length });
  });

  test("the speed setting slows every line down", () => {
    const synth = installSynth();
    createVoice(cast, { speed: "relaxed" }).speak("Hello there.", "data");
    assert.ok(Math.abs(synth.queue[0].rate - cast.data.voice.rate * 0.85) < 1e-9);
  });

  test("amounts are spoken with their currency after them", () => {
    const synth = installSynth();
    createVoice(cast).speak("An order costs ₹500 today.", "data");
    assert.equal(synth.queue[0].text, "An order costs 500 rupees today.");
  });

  test("a Hindi voice says numbers in English words, and the caption still follows the line", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const synth = installSynth(CHROME_DESKTOP);
    const voice = createVoice(cast);
    const line = "About 40% of shoppers. Done.";
    const handle = voice.speak(line, "data");
    const first = synth.queue[0];
    assert.equal(first.voice?.name, "Google हिन्दी");
    assert.equal(first.lang, "hi-IN");
    assert.equal(first.text, "About forty percent of shoppers.");
    // Positions in the spelled-out text don't match the line, so they don't move the caption.
    synth.boundary(30, 2);
    assert.ok(handle.spokenChars() <= "About 40% of shoppers.".length);
    synth.end();
    mock.timers.tick(SENTENCE_PAUSE_MS);
    assert.equal(synth.queue[0].text, "Done.");
    synth.end();
    assert.deepEqual(await handle.done, { completed: true, spokenChars: line.length });
  });

  test("ready() resolves when voices arrive, and the assignment follows them", async () => {
    const synth = installSynth([]);
    const voice = createVoice(cast);
    const ready = voice.ready();
    synth.loadVoices(CHROME_WINDOWS);
    await ready;
    voice.speak("Hello.", "moderator");
    assert.equal(synth.queue[0].voice?.name, "Microsoft Heera - English (India)");
    voice.cancelAll();
  });

  test("ready() gives up after 1.5 s without voices; lines then use the default voice", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const synth = installSynth([]);
    const voice = createVoice(cast);
    const ready = voice.ready();
    mock.timers.tick(1500);
    await ready;
    voice.speak("Hello.", "moderator");
    assert.equal(synth.queue[0].voice, null);
    assert.equal(synth.queue[0].lang, "en-IN");
    voice.cancelAll();
  });

  test("without speechSynthesis, speaking is simulated over the reading time", async () => {
    const voice = createVoice(cast);
    assert.equal(voice.supported, false);
    await voice.ready();

    const short = voice.speak("Hi. Ok.", "data");
    assert.equal(short.spokenChars(), 0);
    assert.deepEqual(await short.done, { completed: true, spokenChars: 7 });

    const long = voice.speak("This line is long enough to still be going after a fraction of a second.", "data");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const midway = long.spokenChars();
    assert.ok(midway > 0, "progress advances with time");
    long.cancel();
    const result = await long.done;
    assert.equal(result.completed, false);
    assert.ok(result.spokenChars >= midway && result.spokenChars < 30);
  });
});

// ---------------------------------------------------------------------------

type FakeResult = { transcript: string }[] & { isFinal: boolean };

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: Handler<{ resultIndex: number; results: FakeResult[] }> = null;
  onerror: Handler<{ error: string }> = null;
  onend: Handler = null;
  running = false;
  starts = 0;
  aborted = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    if (this.running) throw Object.assign(new Error("already started"), { name: "InvalidStateError" });
    this.running = true;
    this.starts += 1;
  }
  stop() {
    this.running = false;
  }
  abort() {
    this.running = false;
    this.aborted = true;
  }
  // Test helpers acting as the browser.
  emit(results: [string, boolean][], resultIndex = 0) {
    this.onresult?.({
      resultIndex,
      results: results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
    });
  }
  end() {
    this.running = false;
    this.onend?.();
  }
}

function installRecognition(key: "SpeechRecognition" | "webkitSpeechRecognition" = "SpeechRecognition") {
  FakeRecognition.instances = [];
  globals.window = { [key]: FakeRecognition };
}

function recorder() {
  const log = {
    finals: [] as string[],
    interim: "",
    activity: 0,
    errors: [] as ListenerErrorKind[],
  };
  const cb = {
    onInterim: (text: string) => void (log.interim = text),
    onFinal: (text: string) => void log.finals.push(text),
    onActivity: () => void (log.activity += 1),
    onError: (kind: ListenerErrorKind) => void log.errors.push(kind),
  };
  return { log, cb };
}

function lastRecognition(): FakeRecognition {
  const recognition = FakeRecognition.instances.at(-1);
  assert.ok(recognition, "no recognition was created");
  return recognition;
}

describe("createListener", () => {
  test("configures continuous recognition and delivers finals, interim and activity", () => {
    installRecognition();
    const { log, cb } = recorder();
    const listener = createListener("en-IN", cb);
    assert.equal(listener.supported, true);
    listener.start();
    listener.start(); // second start while active is a no-op
    assert.equal(FakeRecognition.instances.length, 1);
    const rec = lastRecognition();
    assert.deepEqual(
      [rec.lang, rec.continuous, rec.interimResults, rec.maxAlternatives, rec.starts],
      ["en-IN", true, true, 1, 1],
    );
    assert.equal(listener.active, true);

    rec.emit([["I think", false]]);
    assert.equal(log.interim, "I think");
    rec.emit([["I think that", true], [" growth", false]]);
    assert.deepEqual(log.finals, ["I think that"]);
    assert.equal(log.interim, "growth");
    rec.emit([["I think that", true], [" growth  matters", true]], 1);
    assert.deepEqual(log.finals, ["I think that", "growth matters"]);
    assert.equal(log.interim, "");
    assert.equal(log.activity, 3);
  });

  test("stop() flushes interim text as final and drops late results", () => {
    installRecognition("webkitSpeechRecognition");
    const { log, cb } = recorder();
    const listener = createListener("en-US", cb);
    listener.start();
    const rec = lastRecognition();
    const lateResult = rec.onresult;
    rec.emit([["we should", false]]);
    listener.stop();
    assert.deepEqual(log.finals, ["we should"]);
    assert.equal(log.interim, "");
    assert.equal(listener.active, false);
    assert.ok(rec.aborted);
    lateResult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "too late" }], { isFinal: true })] });
    assert.deepEqual(log.finals, ["we should"]);
  });

  test("restarts when the browser ends recognition, tolerating an already-started error", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    installRecognition();
    const { log, cb } = recorder();
    const listener = createListener("en-IN", cb);
    listener.start();
    const rec = lastRecognition();

    rec.emit([["half a thought", false]]);
    rec.end(); // the run ended with interim text pending: keep it
    assert.deepEqual(log.finals, ["half a thought"]);
    mock.timers.tick(250);
    assert.equal(rec.starts, 2);

    rec.end();
    rec.running = true; // the browser restarted on its own in the meantime
    mock.timers.tick(500);
    assert.equal(rec.starts, 2);
    assert.deepEqual(log.errors, []);
    assert.equal(listener.active, true);
  });

  test("gives up after recognition keeps ending immediately", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    installRecognition();
    const { log, cb } = recorder();
    const listener = createListener("en-IN", cb);
    listener.start();
    const rec = lastRecognition();
    for (let i = 0; i < 7; i++) {
      rec.end();
      mock.timers.tick(3000);
    }
    assert.equal(rec.starts, 7);
    assert.deepEqual(log.errors, ["other"]);
    assert.equal(listener.active, false);
  });

  test("maps recognition errors", () => {
    installRecognition();
    const cases: [string, ListenerErrorKind[], boolean][] = [
      ["no-speech", [], true],
      ["aborted", [], true],
      ["network", ["network"], true],
      ["not-allowed", ["not-allowed"], false],
      ["service-not-allowed", ["not-allowed"], false],
      ["audio-capture", ["no-mic"], false],
    ];
    for (const [error, expected, staysActive] of cases) {
      const { log, cb } = recorder();
      const listener = createListener("en-IN", cb);
      listener.start();
      const rec = lastRecognition();
      rec.onerror?.({ error });
      if (error === "network") rec.onerror?.({ error }); // reported once
      assert.deepEqual(log.errors, expected, error);
      assert.equal(listener.active, staysActive, error);
      listener.stop();
    }
  });

  test("reports unsupported browsers instead of throwing", () => {
    const { log, cb } = recorder();
    const listener = createListener("en-IN", cb);
    assert.equal(listener.supported, false);
    listener.start();
    assert.deepEqual(log.errors, ["no-mic"]);
    assert.equal(listener.active, false);
  });
});

// ---------------------------------------------------------------------------

describe("mic level", () => {
  test("maps normal speech to roughly 0.3-0.8 and silence to 0", () => {
    assert.equal(levelFromRms(0), 0);
    assert.equal(levelFromRms(db(-70)), 0);
    for (const speech of [-42, -36, -30, -24]) {
      const level = levelFromRms(db(speech));
      assert.ok(level >= 0.3 && level <= 0.8, `${speech} dB → ${level}`);
    }
    assert.equal(levelFromRms(1), 1);
    assert.ok(levelFromRms(db(-30)) > levelFromRms(db(-40)));
  });

  test("smoothing rises faster than it falls", () => {
    const up = smoothLevel(0, 1);
    const down = 1 - smoothLevel(1, 0);
    assert.ok(up > down);
    assert.ok(up > 0 && up < 1);
  });
});

describe("microphone access", () => {
  const nav = globalThis.navigator as unknown as Record<string, unknown>;

  afterEach(() => {
    delete nav.mediaDevices;
  });

  function fakeStream() {
    const track = { stopped: false, stop: () => void (track.stopped = true) };
    return { track, stream: { getTracks: () => [track] } };
  }

  function installMediaDevices(getUserMedia: () => Promise<unknown>) {
    Object.defineProperty(nav, "mediaDevices", { value: { getUserMedia }, configurable: true });
  }

  test("requestMicPermission reports granted, denied and unavailable", async () => {
    assert.equal(await requestMicPermission(), "unavailable");

    const { track, stream } = fakeStream();
    installMediaDevices(async () => stream);
    assert.equal(await requestMicPermission(), "granted");
    assert.ok(track.stopped, "the test stream is closed again");

    installMediaDevices(async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    });
    assert.equal(await requestMicPermission(), "denied");

    installMediaDevices(async () => {
      throw Object.assign(new Error("no device"), { name: "NotFoundError" });
    });
    assert.equal(await requestMicPermission(), "unavailable");
  });

  test("the meter reads the analyser level and releases everything on stop()", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    const { track, stream } = fakeStream();
    installMediaDevices(async () => stream);
    let closed = false;
    let resumed = false;
    class FakeAudioContext {
      state = "suspended";
      createAnalyser() {
        return {
          fftSize: 0,
          smoothingTimeConstant: 1,
          getFloatTimeDomainData: (out: Float32Array) => out.fill(db(-30)),
        };
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      async resume() {
        resumed = true;
      }
      async close() {
        closed = true;
      }
    }
    globals.window = { AudioContext: FakeAudioContext };

    const meter = createMicMeter();
    assert.equal(meter.level(), 0);
    const starting = meter.start();
    assert.equal(meter.start(), starting, "start() twice is safe");
    await starting;
    assert.ok(resumed, "a suspended context is resumed");
    mock.timers.tick(33 * 20);
    assert.ok(Math.abs(meter.level() - levelFromRms(db(-30))) < 0.01);

    meter.stop();
    assert.equal(meter.level(), 0);
    assert.ok(track.stopped);
    assert.ok(closed);
    meter.stop(); // idempotent
  });

  test("stop() during the permission prompt closes the late stream", async () => {
    const { track, stream } = fakeStream();
    let grant: (value: unknown) => void = () => {};
    installMediaDevices(() => new Promise((resolve) => (grant = resolve)));
    globals.window = { AudioContext: class {} };
    const meter = createMicMeter();
    const starting = meter.start();
    await Promise.resolve();
    meter.stop();
    grant(stream);
    await starting;
    assert.ok(track.stopped);
    assert.equal(meter.level(), 0);
  });

  test("the meter stays at 0 without a microphone API", async () => {
    const meter = createMicMeter();
    await meter.start();
    assert.equal(meter.level(), 0);
    meter.stop();
  });
});
