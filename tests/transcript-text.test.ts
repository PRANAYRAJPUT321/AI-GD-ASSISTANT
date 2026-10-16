import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMetrics } from "@/lib/metrics";
import { customTopic } from "@/lib/topics";
import {
  formatClock,
  orderedTurns,
  splitFillers,
  transcriptFileName,
  transcriptToText,
} from "@/lib/transcript-text";
import type { GDPhase, GDRecord, SpeakerId, Turn } from "@/lib/types";

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
      topic: { id: "business:gig", title: "Is the gig economy good for India's workforce?", category: "business" },
      userName,
      minutes: 10,
      sttLang: "en-IN",
      inputMode: "voice",
    },
    transcript,
    interruptions: [],
    discussionStartMs: 10_000,
    discussionEndMs: 612_500,
    ...extra,
  };
}

/** The joined text of the filler segments, in order. */
const fillersIn = (text: string) => splitFillers(text).filter((s) => s.filler).map((s) => s.text);

// ---------- formatClock ----------

describe("formatClock", () => {
  test("formats minutes and zero-padded seconds", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(5_000), "0:05");
    assert.equal(formatClock(65_000), "1:05");
    assert.equal(formatClock(600_000), "10:00");
    assert.equal(formatClock(3_725_000), "62:05");
  });

  test("rounds down to the whole second", () => {
    assert.equal(formatClock(59_999), "0:59");
    assert.equal(formatClock(999), "0:00");
  });

  test("negative or invalid durations read 0:00", () => {
    assert.equal(formatClock(-4_000), "0:00");
    assert.equal(formatClock(Number.NaN), "0:00");
  });
});

// ---------- transcriptToText ----------

describe("transcriptToText", () => {
  const cutAi = turn("dominator", "Look, the gig economy is the only—", 13, 20, {
    interrupted: true,
    interruptedBy: "user",
  });
  const userBefore = turn("user", "I think gig workers need a safety net, because", 20, 41, {
    interrupted: true,
    interruptedBy: "dominator",
  });
  const interjection = turn("dominator", "Sorry to cut in, but who pays for it?", 41, 46, { kind: "interjection" });
  const continuation = turn("user", "the platforms can, through a small cess.", 46, 52, { continuation: true });
  const typedTurn = turn("user", "Typed   point\nacross two lines", 70, 80, { typed: true });
  const transcript = [
    turn("moderator", "Good afternoon, everyone. Whoever is ready may begin.", 0, 10, { phase: "intro" }),
    turn("data", "Roughly 7.7 million gig workers today.", 52, 60),
    cutAi,
    userBefore,
    interjection,
    continuation,
    turn("drifter", "Speaking of platforms, cricket streaming is wild.", 60, 70),
    typedTurn,
    turn("moderator", "Thank you, everyone, that's time.", 615, 620, { phase: "summary" }),
    turn("user", "To summarise, both sides agree on flexibility.", 621, 650, { phase: "summary" }),
    turn("smart", "In closing, the question is who carries the risk.", 652, 670, { phase: "summary", kind: "summary" }),
  ];
  const text = transcriptToText(
    record(transcript, {
      interruptions: [
        {
          id: "i1",
          atMs: 41_000,
          by: "dominator",
          interjectionTurnId: interjection.id,
          userTextBefore: userBefore.text,
          outcome: "held",
        },
      ],
    }),
    { dateLabel: "16 Oct 2026, 3:42 pm" },
  );
  const lines = text.split("\n");

  test("starts with a header: topic, category, candidate, date, length and participants", () => {
    assert.ok(lines.includes("Topic: Is the gig economy good for India's workforce?"));
    assert.ok(lines.includes("Category: Business"));
    assert.ok(lines.includes("Candidate: Priya Sharma"));
    assert.ok(lines.includes("Date: 16 Oct 2026, 3:42 pm"));
    assert.ok(lines.includes("Discussion length: 10 minutes planned, 10:02 recorded"));
    assert.match(text, /^Participants: Arjun \(The Dominator\), Meera \(The Data Person\), Rohit/m);
  });

  test("leaves the date out when none is given, and labels custom topics", () => {
    const custom = record([], {
      config: { ...record([]).config, topic: customTopic("Should exams be open book?") },
    });
    const plain = transcriptToText(custom);
    assert.doesNotMatch(plain, /^Date:/m);
    assert.match(plain, /^Category: Your own topic$/m);
  });

  test("orders turns by time and stamps them m:ss from the discussion start", () => {
    const body = lines.slice(lines.indexOf("DISCUSSION"));
    const stamped = body.filter((line) => line.startsWith("["));
    assert.equal(stamped[0], "[0:00] Moderator: Good afternoon, everyone. Whoever is ready may begin.");
    assert.equal(stamped[1], "[0:03] Arjun: Look, the gig economy is the only— [cut off by Priya Sharma]");
    assert.ok(stamped.indexOf("[0:42] Meera: Roughly 7.7 million gig workers today.") > 0);
  });

  test("marks cut-offs, interjections (with how the candidate responded), continuations and typed turns", () => {
    assert.ok(lines.includes("[0:10] Priya Sharma: I think gig workers need a safety net, because [cut off by Arjun]"));
    assert.ok(
      lines.includes("[0:31] Arjun (cutting in): Sorry to cut in, but who pays for it? [Priya Sharma held the floor]"),
    );
    assert.ok(lines.includes("[0:36] Priya Sharma (continuing): the platforms can, through a small cess."));
    assert.ok(lines.includes("[1:00] Priya Sharma (typed): Typed point across two lines"));
  });

  test("puts the closing summaries in their own section after the discussion", () => {
    const discussionAt = lines.indexOf("DISCUSSION");
    const summariesAt = lines.indexOf("CLOSING SUMMARIES");
    assert.ok(discussionAt > 0 && summariesAt > discussionAt);
    const summarySection = lines.slice(summariesAt);
    assert.ok(summarySection.includes("[10:11] Priya Sharma: To summarise, both sides agree on flexibility."));
    assert.ok(summarySection.includes("[10:42] Ananya: In closing, the question is who carries the risk."));
    // Nothing from the summary phase leaks into the discussion section.
    const discussionSection = lines.slice(discussionAt, summariesAt);
    assert.ok(!discussionSection.some((line) => line.includes("To summarise")));
  });

  test("records a yielded interjection", () => {
    const cutIn = turn("dominator", "Hold on, that's not the point.", 30, 34, { kind: "interjection" });
    const yielded = transcriptToText(
      record([turn("user", "I think", 20, 30, { interrupted: true, interruptedBy: "dominator" }), cutIn], {
        interruptions: [
          { id: "i2", atMs: 30_000, by: "dominator", interjectionTurnId: cutIn.id, userTextBefore: "I think", outcome: "yielded" },
        ],
      }),
    );
    assert.ok(yielded.includes("[0:20] Arjun (cutting in): Hold on, that's not the point. [Priya Sharma yielded]"));
  });

  test("says so when there were no summaries", () => {
    const early = transcriptToText(record([turn("user", "I'd like to open.", 12, 20)]));
    assert.match(early, /CLOSING SUMMARIES\n-+\n\(None: the GD ended before the closing summaries\.\)/);
  });

  test("uses the cast's names, including a persona renamed for the candidate", () => {
    const renamed = transcriptToText(
      record([turn("dominator", "Let me start.", 12, 20)], {}, "Arjun Mehta"),
    );
    assert.ok(renamed.includes("[0:02] Vikram: Let me start."));
    assert.ok(renamed.includes("Candidate: Arjun Mehta"));
  });

  test("orderedTurns keeps the recorded order for turns that start together", () => {
    const a = turn("user", "first", 30, 31);
    const b = turn("dominator", "second", 30, 32);
    const c = turn("data", "earlier", 20, 25);
    assert.deepEqual(
      orderedTurns(record([a, b, c])).map((t) => t.text),
      ["earlier", "first", "second"],
    );
  });
});

describe("transcriptFileName", () => {
  test("slugs the topic and dates the file in local time", () => {
    const date = new Date(2026, 9, 6, 23, 59);
    assert.equal(
      transcriptFileName("Quick commerce: boon or bane?", date),
      "gd-arena-quick-commerce-boon-or-bane-2026-10-06.txt",
    );
  });

  test("falls back when the title has no usable characters, and keeps long slugs short", () => {
    const date = new Date(2026, 0, 2);
    assert.equal(transcriptFileName("???", date), "gd-arena-transcript-2026-01-02.txt");
    const long = transcriptFileName("Should India prioritise manufacturing over services in the next decade?", date);
    assert.equal(long, "gd-arena-should-india-prioritise-manufacturing-over-2026-01-02.txt");
  });
});

// ---------- splitFillers ----------

describe("splitFillers", () => {
  test("joining the segments gives back the text", () => {
    const text = "Um, so basically, you know, I mean it's like… literally fine, right?";
    assert.equal(
      splitFillers(text)
        .map((s) => s.text)
        .join(""),
      text,
    );
  });

  test("marks single-word fillers, case-insensitively", () => {
    assert.deepEqual(fillersIn("Um, I Actually think, uh, it's BASICALLY fine. Erm."), [
      "Um",
      "Actually",
      "uh",
      "BASICALLY",
      "Erm",
    ]);
  });

  test("matches phrases before the words inside them", () => {
    assert.deepEqual(fillersIn("You know, it's kind of like this, I mean, sort of."), [
      "You know",
      "kind of",
      "like",
      "I mean",
      "sort of",
    ]);
    // A comma between the words of a phrase still counts.
    assert.deepEqual(fillersIn("Okay, so we begin."), ["Okay, so"]);
  });

  test("an overlapping pair resolves the way the metrics count it", () => {
    // "so yeah" comes before "okay so" in the spec, so it wins the shared "so".
    assert.deepEqual(fillersIn("okay so yeah, that's it"), ["so yeah"]);
  });

  test("never matches inside a word", () => {
    assert.deepEqual(fillersIn("It is likely that the umbrella brand actually unlikes erosion."), ["actually"]);
    assert.deepEqual(fillersIn("Summer, user, ermine, uhhuh, alright? I'd've known"), []);
  });

  test("returns a single plain segment without fillers, and nothing for empty text", () => {
    assert.deepEqual(splitFillers("Clear and concise."), [{ text: "Clear and concise.", filler: false }]);
    assert.deepEqual(splitFillers(""), []);
  });

  test("underlines exactly what the metrics count", () => {
    const texts = [
      "Um, so basically, you know, I mean it's like literally fine, right?",
      "Okay so yeah, kind of, sort of. Uhh umm er erm, like LIKE likely.",
    ];
    const metrics = computeMetrics(record(texts.map((text, i) => turn("user", text, 20 + i * 30, 40 + i * 30))));
    const marked = texts.flatMap((text) => fillersIn(text));
    assert.equal(marked.length, metrics.fillerTotal);
  });
});
