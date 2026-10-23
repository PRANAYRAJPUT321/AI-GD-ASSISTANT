import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMetrics } from "@/lib/metrics";
import { AssessmentSchema } from "@/lib/scoring";
import { offlineAssessment, offlineLine } from "@/lib/server/offline";
import type { Cue, GDRecord, PersonaId, Topic, TurnMode, WireTurn } from "@/lib/types";

const TOPIC: Topic = { id: "business:gig", title: "Is the gig economy good for India's workforce?", category: "business" };
const SAID = "Gig work gives people flexibility but almost no social security.";
const transcript: WireTurn[] = [
  { speaker: "moderator", text: "Today's topic is the gig economy. You may begin." },
  { speaker: "dominator", text: "Gig work is freedom, plain and simple." },
  { speaker: "user", text: SAID },
];

const line = (speaker: PersonaId, cue: Cue, mode: TurnMode = "turn", extra: Partial<{ transcript: WireTurn[]; partialUserText: string }> = {}) =>
  offlineLine({
    topic: TOPIC,
    userName: "Priya Sharma",
    speaker,
    mode,
    cue,
    elapsedSec: 120,
    totalSec: 600,
    transcript: extra.transcript ?? transcript,
    partialUserText: extra.partialUserText,
  });

describe("practice-mode lines", () => {
  test("every persona and cue produces a speakable line with no template holes", () => {
    const cues: Cue[] = ["open", "respond-user", "agree-user", "agree-last", "drift", "follow-drift", "bring-back", "late-strong", "continue-after-interjection", "wrap-up", "normal"];
    for (const speaker of ["dominator", "data", "agreer", "drifter", "smart"] as PersonaId[]) {
      for (const cue of cues) {
        const text = line(speaker, cue);
        assert.ok(text.split(" ").length >= 8, `${speaker}/${cue} is too short: ${text}`);
        assert.doesNotMatch(text, /undefined|\$\{|""/, `${speaker}/${cue}: ${text}`);
      }
    }
  });

  test("the Agreer literally opens with I agree with <first name> and restates the candidate", () => {
    const text = line("agreer", "agree-user");
    assert.match(text, /^I agree with Priya\b/);
    assert.match(text, /social security/);
  });

  test("before the candidate speaks, the Agreer agrees with the last speaker by name", () => {
    const text = line("agreer", "agree-last", "turn", { transcript: transcript.slice(0, 2) });
    assert.match(text, /^I agree with (what )?Arjun\b/);
  });

  test("responses quote the candidate's own words", () => {
    assert.match(line("dominator", "respond-user"), /flexibility but almost no social security/);
  });

  test("an interjection is short and names the candidate", () => {
    const text = line("dominator", "respond-user", "interject", { partialUserText: "I think the platforms should pay" });
    assert.match(text, /Priya/);
    assert.ok(text.split(" ").length <= 25, text);
  });

  test("the closing summary skips the candidate quote when they never spoke", () => {
    const silent = line("smart", "wrap-up", "summary", { transcript: transcript.slice(0, 2) });
    assert.doesNotMatch(silent, /made the point that/);
    assert.match(line("smart", "wrap-up", "summary"), /Priya made the point that "/);
  });

  test("a renamed persona keeps its new name in practice lines", () => {
    const text = offlineLine({
      topic: TOPIC,
      userName: "Arjun",
      speaker: "smart",
      mode: "turn",
      cue: "normal",
      elapsedSec: 400,
      totalSec: 600,
      transcript,
    });
    assert.match(text, /Arjun and Vikram/);
  });

  test("lines vary from turn to turn", () => {
    const a = line("dominator", "normal");
    const b = line("dominator", "normal", "turn", { transcript: [...transcript, { speaker: "data", text: "Here's an example." }] });
    assert.notEqual(a, b);
  });
});

describe("practice-mode scorecard", () => {
  const record: GDRecord = {
    config: { topic: TOPIC, userName: "Priya", minutes: 10, sttLang: "en-IN", inputMode: "voice" },
    transcript: [
      { id: "m", speaker: "moderator", text: "You may begin.", startMs: 0, endMs: 5_000, phase: "intro", kind: "moderator" },
      { id: "u1", speaker: "user", text: "I'll open. Gig work gives flexibility but almost no social security for workers.", startMs: 6_000, endMs: 20_000, phase: "discussion", kind: "turn" },
      { id: "d", speaker: "dominator", text: "Freedom matters more.", startMs: 21_000, endMs: 40_000, phase: "discussion", kind: "turn" },
      { id: "k", speaker: "drifter", text: "This reminds me of cricket.", startMs: 41_000, endMs: 60_000, phase: "discussion", kind: "turn" },
      { id: "u2", speaker: "user", text: "Arjun, for example, a delivery rider earns 20% less after fuel costs, so freedom is not enough.", startMs: 61_000, endMs: 80_000, phase: "discussion", kind: "turn" },
      { id: "s", speaker: "user", text: "To summarise, we heard both sides: flexibility on one hand and security on the other, and I conclude that regulation is needed so workers get basic protection.", startMs: 600_000, endMs: 630_000, phase: "summary", kind: "summary" },
    ],
    interruptions: [],
    discussionStartMs: 5_000,
    discussionEndMs: 605_000,
  };

  test("matches the assessment schema with ratings in range", () => {
    const metrics = computeMetrics(record);
    const assessment = offlineAssessment(record, metrics);
    assert.ok(AssessmentSchema.safeParse(assessment).success);
    for (const section of ["opening", "participation", "content", "evidence", "interruptions", "drift", "summary", "delivery"] as const) {
      const rating = assessment[section].rating;
      assert.ok(rating >= 0 && rating <= 10, `${section} = ${rating}`);
    }
    assert.ok(assessment.overall.score >= 0 && assessment.overall.score <= 100);
    assert.match(assessment.overall.verdict, /practice-mode scorecard/);
  });

  test("reflects what was measured: opening, examples, references, drift and summary", () => {
    const assessment = offlineAssessment(record, computeMetrics(record));
    assert.equal(assessment.opening.rating, 8);
    assert.ok(assessment.content.newPoints.length >= 2);
    assert.ok(assessment.evidence.examples.some((e) => /delivery rider/.test(e)));
    assert.ok(assessment.evidence.references.some((r) => /Arjun/.test(r)));
    assert.equal(assessment.drift.pulledBack, true);
    assert.ok(assessment.summary.rating >= 5);
  });

  test("a silent candidate scores low", () => {
    const silent: GDRecord = { ...record, transcript: record.transcript.filter((t) => t.speaker !== "user") };
    const assessment = offlineAssessment(silent, computeMetrics(silent));
    assert.equal(assessment.opening.rating, 0);
    assert.equal(assessment.participation.rating, 0);
    assert.equal(assessment.summary.rating, 0);
    assert.ok(assessment.overall.score < 30);
  });
});
