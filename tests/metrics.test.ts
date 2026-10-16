import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMetrics, countWords } from "@/lib/metrics";
import type { GDPhase, GDRecord, InterruptionEvent, SpeakerId, Turn } from "@/lib/types";

// ---------- Fixture helpers ----------

let seq = 0;

/** A turn from `from` to `to` seconds since engine start. */
function turn(
  speaker: SpeakerId,
  text: string,
  from: number,
  to: number,
  extra: Partial<Turn> & { phase?: GDPhase } = {},
): Turn {
  seq += 1;
  return {
    id: `t${seq}`,
    speaker,
    text,
    startMs: from * 1000,
    endMs: to * 1000,
    phase: "discussion",
    kind: speaker === "moderator" ? "moderator" : "turn",
    ...extra,
  };
}

function record(transcript: Turn[], extra: Partial<GDRecord> = {}, userName = "Priya Sharma"): GDRecord {
  return {
    config: {
      topic: { id: "business:test", title: "Is the gig economy good for India?", category: "business" },
      userName,
      minutes: 10,
      sttLang: "en-IN",
      inputMode: "voice",
    },
    transcript,
    interruptions: [],
    discussionStartMs: 10_000,
    discussionEndMs: 610_000,
    ...extra,
  };
}

/** n filler-free words. */
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

// ---------- A full GD ----------

describe("computeMetrics on a full voice GD", () => {
  const interjection = turn("dominator", "Sorry to cut in, but that ignores the cost side completely.", 160, 166, {
    kind: "interjection",
  });
  const transcript: Turn[] = [
    turn("moderator", "Good afternoon, everyone. You may begin.", 0, 10, { phase: "intro" }),
    turn("user", words(75), 12, 42), // opens: 30 s
    turn("dominator", words(90), 44, 80), // 36 s
    turn("dominator", words(30), 82, 95, { interrupted: true, interruptedBy: "user" }), // 13 s, cut off
    turn("user", words(70), 95, 125), // cut-in: 30 s
    turn("user", words(50), 140, 160, { interrupted: true, interruptedBy: "dominator" }), // 20 s
    interjection, // 6 s, counts for the dominator
    turn("user", words(55), 167, 190, { continuation: true }), // 23 s, not a new entry
    turn("drifter", words(60), 200, 230), // 30 s
    turn("user", "Let's come back to the topic. As Kabir said, cricket is fun, but platforms matter.", 232, 250), // 18 s
    turn("data", words(70), 260, 300), // 40 s
    turn("moderator", "Thank you, everyone, that's time.", 610, 618, { phase: "summary" }),
    turn("user", words(40), 620, 650, { phase: "summary", kind: "summary" }), // 30 s
    turn("smart", words(70), 652, 690, { phase: "summary", kind: "summary" }),
  ];
  const interruptions: InterruptionEvent[] = [
    {
      id: "i1",
      atMs: 160_000,
      by: "dominator",
      interjectionTurnId: interjection.id,
      userTextBefore: words(50),
      outcome: "held",
    },
  ];
  const m = computeMetrics(record(transcript, { interruptions }));

  test("opening and first entry", () => {
    assert.equal(m.inputMode, "voice");
    assert.equal(m.openedDiscussion, true);
    assert.equal(m.firstEntrySec, 2);
  });

  test("entries exclude continuations; cut-ins follow an AI turn the candidate cut off", () => {
    assert.equal(m.entries, 4);
    assert.equal(m.cutIns, 1);
  });

  test("airtime counts the interjection for the dominator and ignores the moderator and summaries", () => {
    assert.equal(m.userAirtimeSec, 30 + 30 + 20 + 23 + 18);
    assert.equal(m.airtimeBySpeaker.dominator, 36 + 13 + 6);
    assert.equal(m.airtimeBySpeaker.drifter, 30);
    assert.equal(m.airtimeBySpeaker.data, 40);
    assert.equal(m.airtimeBySpeaker.agreer, 0);
    assert.equal(m.airtimeBySpeaker.smart, 0);
    assert.equal(m.totalAirtimeSec, 121 + 55 + 30 + 40);
    assert.equal(m.airtimeShare, Math.round((121 / 246) * 1000) / 1000);
  });

  test("longest silence is the largest gap in the discussion window without the candidate", () => {
    // Last candidate discussion turn ends at 250 s; the window closes at 610 s.
    assert.equal(m.longestSilenceSec, 360);
  });

  test("words, pace and summary include the summary phase", () => {
    const userWords = 75 + 70 + 50 + 55 + countWords(transcript[9].text) + 40;
    assert.equal(m.userWords, userWords);
    const spokenSec = 30 + 30 + 20 + 23 + 18 + 30;
    assert.equal(m.wordsPerMinute, Math.round(userWords / (spokenSec / 60)));
    assert.equal(m.summaryGiven, true);
    assert.equal(m.summaryWords, 40);
  });

  test("interruptions, references and drift", () => {
    assert.equal(m.interruptionsFaced, 1);
    assert.equal(m.interruptionsHeld, 1);
    assert.equal(m.interruptionsYielded, 0);
    assert.equal(m.referencesToOthers, 1);
    assert.equal(m.driftTurns, 1);
  });
});

// ---------- Focused cases ----------

describe("computeMetrics details", () => {
  test("an AI opener means the candidate did not open; no entries means no first entry", () => {
    const m = computeMetrics(
      record([
        turn("moderator", "You may begin.", 0, 10, { phase: "intro" }),
        turn("dominator", words(80), 17, 50),
        turn("data", words(60), 52, 80),
      ]),
    );
    assert.equal(m.openedDiscussion, false);
    assert.equal(m.firstEntrySec, null);
    assert.equal(m.entries, 0);
    assert.equal(m.userAirtimeSec, 0);
    assert.equal(m.airtimeShare, 0);
    assert.equal(m.longestSilenceSec, 600);
    assert.equal(m.wordsPerMinute, null);
    assert.equal(m.summaryGiven, false);
  });

  test("turns are read in time order even if recorded out of order", () => {
    const m = computeMetrics(
      record([turn("dominator", words(40), 30, 50), turn("user", words(30), 12, 25)]),
    );
    assert.equal(m.openedDiscussion, true);
  });

  test("fillers: multi-word phrases first, nothing counted twice", () => {
    const m = computeMetrics(
      record([
        turn("user", "Um, I mean, basically you know it is kind of like, uh, sort of right? Okay so yeah.", 12, 40),
      ]),
    );
    const byWord = Object.fromEntries(m.fillers.map((f) => [f.word, f.count]));
    assert.deepEqual(byWord, {
      um: 1,
      uh: 1,
      like: 1,
      basically: 1,
      "you know": 1,
      "i mean": 1,
      "sort of": 1,
      "kind of": 1,
      "so yeah": 1, // "okay so yeah" shares "so": counted once, not twice
      "right?": 1,
    });
    assert.equal(m.fillerTotal, 10);
    assert.equal(m.fillersPer100, Math.round((10 / m.userWords) * 1000) / 10);
  });

  test("fillers match whole words only", () => {
    const m = computeMetrics(
      record([turn("user", "Umm uhh. Her likely umbrella was actually unlike erm the others.", 12, 40)]),
    );
    const byWord = Object.fromEntries(m.fillers.map((f) => [f.word, f.count]));
    assert.deepEqual(byWord, { umm: 1, uhh: 1, erm: 1, actually: 1 });
    // Sorted by count, ties in the spec's order.
    assert.deepEqual(
      m.fillers.map((f) => f.word),
      ["umm", "uhh", "erm", "actually"],
    );
  });

  test("WPM is null for typed turns", () => {
    const m = computeMetrics(record([turn("user", words(100), 12, 72, { typed: true })]));
    assert.equal(m.inputMode, "text");
    assert.equal(m.wordsPerMinute, null);
  });

  test("WPM is null in text mode even for untagged turns", () => {
    const r = record([turn("user", words(100), 12, 72)]);
    r.config.inputMode = "text";
    assert.equal(computeMetrics(r).wordsPerMinute, null);
  });

  test("WPM needs at least 20 s of speech", () => {
    assert.equal(computeMetrics(record([turn("user", words(40), 12, 27)])).wordsPerMinute, null);
    assert.equal(computeMetrics(record([turn("user", words(75), 12, 42)])).wordsPerMinute, 150);
  });

  test("references count candidate turns naming a participant, by whole name, any case", () => {
    const m = computeMetrics(
      record([
        turn("user", "As Meera said, and Arjun too, costs matter.", 12, 20),
        turn("dominator", words(40), 21, 40),
        turn("user", "i disagree with arjun's framing.", 41, 50),
        turn("user", "Rohitash is not in this room.", 60, 70),
      ]),
    );
    assert.equal(m.referencesToOthers, 2);
  });

  test("references use the cast: a renamed persona is matched by its new name", () => {
    // The candidate is Arjun, so the dominator becomes Vikram.
    const m = computeMetrics(
      record(
        [
          turn("user", "Vikram, I hear you, but the data says otherwise.", 12, 20),
          turn("user", "I, Arjun, believe we should look at jobs.", 30, 40),
        ],
        {},
        "Arjun Kumar",
      ),
    );
    assert.equal(m.referencesToOthers, 1);
  });

  test("a summary needs at least 15 words", () => {
    const short = computeMetrics(
      record([turn("user", words(10), 620, 630, { phase: "summary", kind: "summary" })]),
    );
    assert.equal(short.summaryGiven, false);
    assert.equal(short.summaryWords, 10);
    const enough = computeMetrics(
      record([turn("user", words(15), 620, 640, { phase: "summary", kind: "summary" })]),
    );
    assert.equal(enough.summaryGiven, true);
  });

  test("interruption outcomes are tallied; pending counts only as faced", () => {
    const event = (id: string, outcome: InterruptionEvent["outcome"]): InterruptionEvent => ({
      id,
      atMs: 100_000,
      by: "dominator",
      interjectionTurnId: `${id}-turn`,
      userTextBefore: "",
      outcome,
    });
    const m = computeMetrics(
      record([], { interruptions: [event("a", "held"), event("b", "yielded"), event("c", "pending")] }),
    );
    assert.equal(m.interruptionsFaced, 3);
    assert.equal(m.interruptionsHeld, 1);
    assert.equal(m.interruptionsYielded, 1);
  });

  test("deterministic: same record, same metrics", () => {
    const r = record([turn("user", "Um, basically, as Meera said, yes.", 12, 40), turn("drifter", words(50), 41, 70)]);
    assert.deepEqual(computeMetrics(r), computeMetrics(structuredClone(r)));
  });

  test("countWords ignores punctuation-only tokens", () => {
    assert.equal(countWords("  Hello, world — it's 2026!  "), 4);
    assert.equal(countWords(""), 0);
  });
});
