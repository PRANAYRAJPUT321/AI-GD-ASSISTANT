import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as requestScore } from "@/app/api/score/route";
import { POST as startSession } from "@/app/api/session/route";
import { POST as requestTurn } from "@/app/api/turn/route";
import type { Assessment, GDMetrics } from "@/lib/scoring";
import { normaliseAssessment, scoringModel, turnEffort, turnModel } from "@/lib/server/claude";
import { clientIp, ConfigError } from "@/lib/server/http";
import { consumeDailyGD, consumeSessionCall, dayKey, readDailyLimits, TURN_CALLS_PER_SESSION } from "@/lib/server/limits";
import {
  buildScoringPrompt,
  buildSystemPrompt,
  buildTurnPrompt,
  cleanLine,
  cleanLineOptions,
  TRANSCRIPT_HEADER,
  type TurnPromptInput,
} from "@/lib/server/prompts";
import { createSessionToken, sessionSecret, TOKEN_TTL_MS, verifySessionToken } from "@/lib/server/session";
import { createMemoryStore, createUpstashStore } from "@/lib/server/store";
import { TurnRequestSchema } from "@/lib/server/validate";
import type { Topic, WireTurn } from "@/lib/types";

const SECRET = Buffer.from("test-secret-for-unit-tests");
const TOPIC: Topic = {
  id: "business:gig",
  title: "Is the gig economy good for India's workforce?",
  category: "business",
  hint: "Flexibility and income versus security and benefits.",
};

// ---------- Session tokens ----------

describe("session tokens", () => {
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);

  test("sign and verify round trip", () => {
    const { token, claims } = createSessionToken({ now, secret: SECRET });
    assert.equal(claims.exp, now + TOKEN_TTL_MS);
    assert.deepEqual(verifySessionToken(token, { now: now + 1000, secret: SECRET }), claims);
  });

  test("expires after 45 minutes", () => {
    const { token } = createSessionToken({ now, secret: SECRET });
    assert.ok(verifySessionToken(token, { now: now + TOKEN_TTL_MS - 1, secret: SECRET }));
    assert.equal(verifySessionToken(token, { now: now + TOKEN_TTL_MS, secret: SECRET }), null);
  });

  test("rejects a tampered payload, a tampered signature, a wrong secret and junk", () => {
    const { token } = createSessionToken({ now, secret: SECRET });
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: "someone-else", exp: now + 10 * TOKEN_TTL_MS })).toString(
      "base64url",
    );
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    const verify = (t: string, secret = SECRET) => verifySessionToken(t, { now, secret });
    assert.equal(verify(`${forged}.${signature}`), null);
    assert.equal(verify(`${payload}.${flipped}`), null);
    assert.equal(verify(`${payload}.${signature.slice(0, 10)}`), null);
    assert.equal(verify(token, Buffer.from("another-secret")), null);
    assert.equal(verify("not-a-token"), null);
    assert.equal(verify(`${token}.extra`), null);
  });

  test("each token gets a fresh session id", () => {
    const a = createSessionToken({ now, secret: SECRET }).claims.sid;
    const b = createSessionToken({ now, secret: SECRET }).claims.sid;
    assert.notEqual(a, b);
  });

  test("secret: SESSION_SECRET, else derived from the API key, else a config error", () => {
    assert.deepEqual(sessionSecret({ SESSION_SECRET: "abc", ANTHROPIC_API_KEY: "k" }), Buffer.from("abc"));
    const derived = sessionSecret({ ANTHROPIC_API_KEY: "sk-test" });
    assert.equal(derived.length, 32);
    assert.deepEqual(sessionSecret({ ANTHROPIC_API_KEY: "sk-test" }), derived);
    assert.notDeepEqual(sessionSecret({ ANTHROPIC_API_KEY: "sk-other" }), derived);
    assert.throws(() => sessionSecret({}), ConfigError);
  });
});

// ---------- Turn prompt ----------

const transcript: WireTurn[] = [
  { speaker: "moderator", text: "Good afternoon, everyone. Today's topic is the gig economy.", kind: "moderator" },
  { speaker: "dominator", text: "Let me open. The gig economy is the future of work in India." },
  { speaker: "user", text: "I disagree, Arjun. Security matters more than flexibility." },
];

function input(overrides: Partial<TurnPromptInput> = {}): TurnPromptInput {
  return {
    topic: TOPIC,
    userName: "Priya",
    speaker: "data",
    mode: "turn",
    cue: "respond-user",
    elapsedSec: 95,
    totalSec: 600,
    transcript,
    ...overrides,
  };
}

/** Blocks with cache_control stripped, for prefix comparisons. */
function bare(prompt: ReturnType<typeof buildTurnPrompt>) {
  const content = prompt.messages[0].content;
  assert.ok(Array.isArray(content));
  return content.map((block) => {
    assert.equal(block.type, "text");
    return block.type === "text" ? block.text : "";
  });
}

describe("turn prompt", () => {
  test("cache_control only on the system prompt and the last transcript block", () => {
    const prompt = buildTurnPrompt(input());
    assert.equal(prompt.system.length, 1);
    assert.deepEqual(prompt.system[0].cache_control, { type: "ephemeral" });

    const content = prompt.messages[0].content;
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 1 + transcript.length + 1);
    const marked = content.flatMap((block, i) => ("cache_control" in block && block.cache_control ? [i] : []));
    assert.deepEqual(marked, [transcript.length]); // header is 0, transcript is 1..n
    assert.equal(prompt.messages.length, 1);
    assert.equal(prompt.messages[0].role, "user");
  });

  test("header first, one block per turn, instruction last", () => {
    const texts = bare(buildTurnPrompt(input()));
    assert.equal(texts[0], TRANSCRIPT_HEADER);
    assert.equal(texts[1], `Moderator: ${transcript[0].text}\n`);
    assert.equal(texts[2], `Arjun: ${transcript[1].text}\n`);
    assert.equal(texts[3], `Priya: ${transcript[2].text}\n`);
    const instruction = texts[texts.length - 1];
    assert.match(instruction, /Write Meera's next line \(The Data Person\)\./);
    assert.match(instruction, /Priya just spoke/);
    assert.match(instruction, /Length: 50-80 words\./);
    assert.match(instruction, /Elapsed: 1\.6 of 10 minutes\./);
  });

  test("turn markers: cut off, interjection, continuation", () => {
    const texts = bare(
      buildTurnPrompt(
        input({
          transcript: [
            { speaker: "drifter", text: "Speaking of cricket, the IPL", interrupted: true },
            { speaker: "user", text: "Let's come back to the topic" },
            { speaker: "dominator", text: "Sorry to cut in", kind: "interjection" },
            { speaker: "user", text: "as I was saying", continuation: true },
          ],
        }),
      ),
    );
    assert.equal(texts[1], "Kabir: Speaking of cricket, the IPL [cut off]\n");
    assert.equal(texts[3], "Arjun (cutting in): Sorry to cut in\n");
    assert.equal(texts[4], "Priya (continuing): as I was saying\n");
  });

  test("system prompt is byte-identical across every turn of one GD", () => {
    const first = buildTurnPrompt(input({ transcript: transcript.slice(0, 1), speaker: "dominator", cue: "open", elapsedSec: 0 }));
    const later = buildTurnPrompt(
      input({ speaker: "smart", cue: "late-strong", elapsedSec: 400, mode: "turn" }),
    );
    const interject = buildTurnPrompt(
      input({ speaker: "dominator", mode: "interject", partialUserText: "I think that", elapsedSec: 200 }),
    );
    assert.equal(first.system[0].text, later.system[0].text);
    assert.equal(first.system[0].text, interject.system[0].text);
    assert.equal(first.system[0].text, buildSystemPrompt(TOPIC, "Priya"));
    assert.doesNotMatch(first.system[0].text, /Elapsed|minutes elapsed/);
  });

  test("a growing transcript keeps the earlier request as a prefix (instruction aside)", () => {
    const before = bare(buildTurnPrompt(input({ transcript: transcript.slice(0, 2) })));
    const after = bare(
      buildTurnPrompt(input({ speaker: "agreer", cue: "agree-user", elapsedSec: 140 })),
    );
    assert.deepEqual(after.slice(0, before.length - 1), before.slice(0, -1));
  });

  test("system prompt names the cast, the candidate and the topic; abstract topics get guidance", () => {
    const system = buildSystemPrompt(TOPIC, "Priya");
    for (const name of ["Arjun", "Meera", "Rohit", "Kabir", "Ananya", "Priya"]) assert.match(system, new RegExp(name));
    assert.match(system, /Is the gig economy good for India's workforce\?/);
    assert.match(system, /Framing: Flexibility/);
    assert.doesNotMatch(system, /abstract topic/);
    const abstract = buildSystemPrompt({ id: "abstract:zero", title: "Zero", category: "abstract" }, "Priya");
    assert.match(abstract, /abstract topic/);
  });

  test("a candidate sharing a persona's name gets the alternate cast", () => {
    const system = buildSystemPrompt(TOPIC, "Meera Iyer");
    assert.match(system, /Kavya, The Data Person/);
    assert.doesNotMatch(system, /- Meera,/);
  });

  test("empty transcript: only the system prompt carries cache_control", () => {
    const prompt = buildTurnPrompt(input({ transcript: [], speaker: "dominator", cue: "open", elapsedSec: 6 }));
    const content = prompt.messages[0].content;
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 2);
    assert.ok(content.every((block) => !("cache_control" in block) || !block.cache_control));
    assert.match(bare(prompt)[1], /Nobody has spoken yet/);
  });

  test("modes set the word range and wording", () => {
    const interject = buildTurnPrompt(
      input({ speaker: "dominator", mode: "interject", partialUserText: "Gig workers need a safety net because" }),
    );
    assert.equal(interject.maxWords, 22);
    assert.match(bare(interject).at(-1) ?? "", /Gig workers need a safety net because/);
    assert.match(bare(interject).at(-1) ?? "", /Length: 10-22 words/);

    const summary = buildTurnPrompt(input({ speaker: "smart", mode: "summary", cue: "normal", elapsedSec: 640 }));
    assert.equal(summary.maxWords, 90);
    assert.match(bare(summary).at(-1) ?? "", /closing summary/);
    assert.match(bare(summary).at(-1) ?? "", /Priya's points by name/);
  });
});

// ---------- Line post-processing ----------

describe("cleanLine", () => {
  const opts = cleanLineOptions("dominator", "Priya", 105);
  const clean = (raw: string) => cleanLine(raw, opts);

  test("strips name prefixes in their common shapes", () => {
    assert.equal(clean("Arjun: Look, the numbers don't add up."), "Look, the numbers don't add up.");
    assert.equal(clean("**Arjun:** Look, the numbers don't add up."), "Look, the numbers don't add up.");
    assert.equal(clean("Arjun (The Dominator): Look here."), "Look here.");
    assert.equal(clean("ARJUN - Look here."), "Look here.");
    assert.equal(clean("The Dominator: Look here."), "Look here.");
  });

  test("strips wrapping quotes but keeps inner quotes", () => {
    assert.equal(clean('"I think we are missing the point."'), "I think we are missing the point.");
    assert.equal(clean("“I think we are missing the point.”"), "I think we are missing the point.");
    assert.equal(clean('Arjun: "Fine, let me answer."'), "Fine, let me answer.");
    assert.equal(clean('"Yes," I said, "it matters."'), '"Yes," I said, "it matters."');
  });

  test("strips markdown, stage directions and emojis; collapses whitespace", () => {
    assert.equal(clean("*leans forward* Let me be **very** clear."), "Let me be very clear.");
    assert.equal(clean("[laughs] Come on,   Priya.\n\nThat's not it."), "Come on, Priya. That's not it.");
    assert.equal(clean("(cutting in) Sorry, but no."), "Sorry, but no.");
    assert.equal(clean("I *really* disagree 🔥"), "I really disagree");
    assert.equal(clean("- First point\n- Second point"), "First point Second point");
    assert.equal(clean("India (roughly 1.4 billion people) matters."), "India (roughly 1.4 billion people) matters.");
  });

  test("stops at a run-on into another participant's line", () => {
    assert.equal(clean("We need jobs first.\nMeera: Actually, the data says otherwise."), "We need jobs first.");
    assert.equal(clean("We need jobs first.\n**Priya:** I disagree."), "We need jobs first.");
  });

  test("caps at about 1.6x the max words, on a sentence boundary", () => {
    const capOpts = cleanLineOptions("agreer", "Priya", 10); // cap = 16 words
    const sentence = "I agree with Priya on this point entirely.";
    const long = Array.from({ length: 6 }, () => sentence).join(" "); // 48 words
    const out = cleanLine(long, capOpts) ?? "";
    assert.ok(out.split(" ").length <= 16);
    assert.ok(out.endsWith("."));
    assert.equal(out, `${sentence} ${sentence}`);
  });

  test("one huge sentence is cut at the cap and trails off", () => {
    const capOpts = cleanLineOptions("agreer", "Priya", 10);
    const out = cleanLine(Array.from({ length: 40 }, (_, i) => `w${i}`).join(" "), capOpts) ?? "";
    assert.equal(out.split(" ").length, 16);
    assert.ok(out.endsWith("…"));
  });

  test("nothing speakable is null", () => {
    assert.equal(clean(""), null);
    assert.equal(clean("   "), null);
    assert.equal(clean("Arjun:"), null);
    assert.equal(clean("[pauses] *sighs*"), null);
    assert.equal(clean('""'), null);
  });
});

// ---------- Scoring prompt and assessment ----------

function metricsFixture(overrides: Partial<GDMetrics> = {}): GDMetrics {
  return {
    inputMode: "voice",
    openedDiscussion: false,
    firstEntrySec: 40,
    entries: 3,
    cutIns: 1,
    userAirtimeSec: 60,
    totalAirtimeSec: 400,
    airtimeShare: 0.15,
    airtimeBySpeaker: { user: 60, dominator: 150, data: 80, agreer: 40, drifter: 50, smart: 20 },
    longestSilenceSec: 120,
    userWords: 160,
    wordsPerMinute: 140,
    fillers: [{ word: "like", count: 3 }],
    fillerTotal: 3,
    fillersPer100: 1.9,
    interruptionsFaced: 1,
    interruptionsHeld: 0,
    interruptionsYielded: 1,
    referencesToOthers: 2,
    summaryGiven: false,
    summaryWords: 4,
    driftTurns: 0,
    ...overrides,
  };
}

describe("scoring", () => {
  test("transcript has mm:ss from discussion start, the candidate marker and turn markers", () => {
    const { system, user } = buildScoringPrompt(
      {
        config: { topic: TOPIC, userName: "Priya", minutes: 10, sttLang: "en-IN", inputMode: "voice" },
        discussionStartMs: 10_000,
        discussionEndMs: 610_000,
        transcript: [
          { id: "a", speaker: "moderator", text: "You may begin.", startMs: 0, endMs: 10_000, phase: "intro", kind: "moderator" },
          { id: "b", speaker: "dominator", text: "Gig work is freedom", startMs: 12_000, endMs: 20_000, phase: "discussion", kind: "turn", interrupted: true, interruptedBy: "user" },
          { id: "c", speaker: "user", text: "But freedom without security", startMs: 20_000, endMs: 75_000, phase: "discussion", kind: "turn", interrupted: true, interruptedBy: "dominator" },
          { id: "d", speaker: "dominator", text: "Sorry to cut in", startMs: 75_000, endMs: 79_000, phase: "discussion", kind: "interjection" },
          { id: "e", speaker: "user", text: "as I was saying", startMs: 79_000, endMs: 90_000, phase: "discussion", kind: "turn", continuation: true },
        ],
        interruptions: [
          { id: "i", atMs: 75_000, by: "dominator", interjectionTurnId: "d", userTextBefore: "But freedom without security", outcome: "held" },
        ],
      },
      metricsFixture(),
    );
    assert.match(system, /Indian B-school admissions/);
    assert.match(system, /45-65 overall/);
    assert.match(system, /drops "um" and "uh"/);
    assert.match(user, /\[00:00\] Moderator: You may begin\./);
    assert.match(user, /\[00:02\] Arjun: Gig work is freedom \[cut off\]/);
    assert.match(user, /\[00:10\] Priya \[CANDIDATE\]: But freedom without security \[cut off\]/);
    assert.match(user, /\[01:05\] Arjun \(interjection\): Sorry to cut in/);
    assert.match(user, /\[01:09\] Priya \[CANDIDATE\] \(continuing\): as I was saying/);
    assert.match(user, /Outcome: HELD/);
    assert.match(user, /"wordsPerMinute": 140/);
    assert.match(user, /drifter = Kabir \(The Drifter\)/);
  });

  test("assessment is clamped and trimmed; metrics settle summary and drift", () => {
    const section = (rating: number) => ({ rating, comment: " You did fine. " });
    const raw: Assessment = {
      overall: { score: 140, headline: " Strong ideas ", verdict: "You spoke well." },
      opening: section(-3),
      participation: section(14),
      content: { ...section(6), newPoints: Array.from({ length: 12 }, (_, i) => `point ${i}`), repeatedPoints: [" ", "x"] },
      evidence: { ...section(5), examples: [], references: ["Meera's stat"] },
      interruptions: section(7),
      drift: { ...section(6), pulledBack: true },
      summary: section(8),
      delivery: section(6.6),
      strengths: ["a", "b", "c", "d", "e"],
      improvements: ["x", "y", "z", "w"],
    };
    const out = normaliseAssessment(raw, metricsFixture({ summaryGiven: false, driftTurns: 0 }));
    assert.equal(out.overall.score, 100);
    assert.equal(out.overall.headline, "Strong ideas");
    assert.equal(out.opening.rating, 0);
    assert.equal(out.participation.rating, 10);
    assert.equal(out.delivery.rating, 7);
    assert.equal(out.opening.comment, "You did fine.");
    assert.equal(out.content.newPoints.length, 8);
    assert.deepEqual(out.content.repeatedPoints, ["x"]);
    assert.equal(out.strengths.length, 3);
    assert.equal(out.improvements.length, 3);
    assert.equal(out.summary.rating, 2);
    assert.equal(out.drift.pulledBack, null);

    const withSummary = normaliseAssessment(raw, metricsFixture({ summaryGiven: true, driftTurns: 2 }));
    assert.equal(withSummary.summary.rating, 8);
    assert.equal(withSummary.drift.pulledBack, true);
  });

  test("models and effort come from env with safe defaults", () => {
    assert.equal(turnModel({}), "claude-opus-5-5");
    assert.equal(scoringModel({}), "claude-opus-5-5");
    assert.equal(turnModel({ GD_MODEL: "claude-sonnet-5-5" }), "claude-sonnet-5-5");
    assert.equal(scoringModel({ GD_SCORING_MODEL: "  " }), "claude-opus-5-5");
    assert.equal(turnEffort({}), "low");
    assert.equal(turnEffort({ GD_TURN_EFFORT: "Medium" }), "medium");
    assert.equal(turnEffort({ GD_TURN_EFFORT: "turbo" }), "low");
  });
});

// ---------- Limits and counter store ----------

describe("limits", () => {
  const limits = { perDevice: 2, perIp: 3, global: 0, timeZone: "Asia/Kolkata" };
  const now = new Date("2026-10-15T10:00:00Z");

  test("device limit: third GD refused, and the refused attempt is not counted", async () => {
    const store = createMemoryStore();
    const who = { deviceId: "device-aaaaaaaaaaaa", ip: "1.2.3.4" };
    assert.deepEqual(await consumeDailyGD(store, who, now, limits), { ok: true, remainingToday: 1 });
    assert.deepEqual(await consumeDailyGD(store, who, now, limits), { ok: true, remainingToday: 0 });
    const refused = await consumeDailyGD(store, who, now, limits);
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && refused.scope === "device");
    assert.ok(!refused.ok && refused.message === "You've used today's 2 free GDs. Come back tomorrow.");
    // The IP was not charged for the refused attempt: another device on it still gets one.
    const other = await consumeDailyGD(store, { deviceId: "device-bbbbbbbbbbbb", ip: "1.2.3.4" }, now, limits);
    assert.deepEqual(other, { ok: true, remainingToday: 1 });
  });

  test("IP limit refusal undoes the device increment", async () => {
    const store = createMemoryStore();
    const ip = "5.6.7.8";
    for (const d of ["d1", "d2", "d3"]) {
      assert.equal((await consumeDailyGD(store, { deviceId: `device-${d}-xxxxxxxx`, ip }, now, limits)).ok, true);
    }
    const refused = await consumeDailyGD(store, { deviceId: "device-d4-xxxxxxxx", ip }, now, limits);
    assert.ok(!refused.ok && refused.scope === "ip");
    // device d4 was not charged: on a fresh IP it still has both GDs.
    const again = await consumeDailyGD(store, { deviceId: "device-d4-xxxxxxxx", ip: "9.9.9.9" }, now, limits);
    assert.deepEqual(again, { ok: true, remainingToday: 1 });
  });

  test("global limit and unlimited devices", async () => {
    const store = createMemoryStore();
    const open = { perDevice: 0, perIp: 0, global: 1, timeZone: "Asia/Kolkata" };
    assert.deepEqual(await consumeDailyGD(store, { deviceId: "device-cccccccccccc", ip: "1.1.1.1" }, now, open), {
      ok: true,
      remainingToday: null,
    });
    const refused = await consumeDailyGD(store, { deviceId: "device-dddddddddddd", ip: "2.2.2.2" }, now, open);
    assert.ok(!refused.ok && refused.scope === "global");
  });

  test("days roll over at midnight in the configured timezone", async () => {
    // 18:29 UTC is 23:59 IST; 18:31 UTC is 00:01 IST the next day.
    assert.equal(dayKey(new Date("2026-10-15T18:29:00Z"), "Asia/Kolkata"), "2026-10-15");
    assert.equal(dayKey(new Date("2026-10-15T18:31:00Z"), "Asia/Kolkata"), "2026-10-16");
    const store = createMemoryStore();
    const who = { deviceId: "device-eeeeeeeeeeee", ip: "3.3.3.3" };
    await consumeDailyGD(store, who, new Date("2026-10-15T10:00:00Z"), limits);
    await consumeDailyGD(store, who, new Date("2026-10-15T11:00:00Z"), limits);
    const nextDay = await consumeDailyGD(store, who, new Date("2026-10-15T18:31:00Z"), limits);
    assert.deepEqual(nextDay, { ok: true, remainingToday: 1 });
  });

  test("env parsing: defaults, 0 = off, junk falls back", () => {
    assert.deepEqual(readDailyLimits({}), { perDevice: 3, perIp: 30, global: 0, timeZone: "Asia/Kolkata" });
    assert.deepEqual(
      readDailyLimits({
        DAILY_GD_LIMIT: "0",
        DAILY_GD_LIMIT_PER_IP: "abc",
        DAILY_GD_LIMIT_GLOBAL: "500",
        LIMIT_TIMEZONE: "Not/AZone",
      }),
      { perDevice: 0, perIp: 30, global: 500, timeZone: "Asia/Kolkata" },
    );
    assert.equal(readDailyLimits({ LIMIT_TIMEZONE: "Europe/London" }).timeZone, "Europe/London");
  });

  test("a store failure part-way undoes the increments already made", async () => {
    const inner = createMemoryStore();
    let calls = 0;
    const flaky = {
      kind: "memory" as const,
      incr: async (key: string, ttl: number) => {
        calls += 1;
        if (calls === 2) throw new Error("store down");
        return inner.incr(key, ttl);
      },
      decr: (key: string) => inner.decr(key),
    };
    const who = { deviceId: "device-ffffffffffff", ip: "4.4.4.4" };
    await assert.rejects(consumeDailyGD(flaky, who, now, limits), /store down/);
    // The device increment was rolled back: both GDs are still available.
    assert.deepEqual(await consumeDailyGD(inner, who, now, limits), { ok: true, remainingToday: 1 });
  });

  test("per-session turn cap", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < TURN_CALLS_PER_SESSION; i++) assert.equal(await consumeSessionCall(store, "s1", "turn"), true);
    assert.equal(await consumeSessionCall(store, "s1", "turn"), false);
    assert.equal(await consumeSessionCall(store, "s2", "turn"), true);
    for (let i = 0; i < 3; i++) assert.equal(await consumeSessionCall(store, "s1", "score"), true);
    assert.equal(await consumeSessionCall(store, "s1", "score"), false);
  });

  test("memory counters expire", async () => {
    let t = 0;
    const store = createMemoryStore(() => t);
    assert.equal(await store.incr("k", 10), 1);
    assert.equal(await store.incr("k", 10), 2);
    t = 10_001;
    assert.equal(await store.incr("k", 10), 1);
  });

  test("Upstash store sends INCR+EXPIRE and DECR pipelines with the bearer token", async () => {
    const calls: { url: string; auth: string | null; body: unknown }[] = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as unknown[];
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
      return Response.json(body.length === 2 ? [{ result: 4 }, { result: 1 }] : [{ result: 3 }]);
    };
    const store = createUpstashStore("https://example.upstash.io/", "tok", fakeFetch);
    assert.equal(await store.incr("day:x", 60), 4);
    await store.decr("day:x");
    assert.equal(calls[0].url, "https://example.upstash.io/pipeline");
    assert.equal(calls[0].auth, "Bearer tok");
    assert.deepEqual(calls[0].body, [
      ["INCR", "gd-arena:day:x"],
      ["EXPIRE", "gd-arena:day:x", 60],
    ]);
    assert.deepEqual(calls[1].body, [["DECR", "gd-arena:day:x"]]);
  });

  test("Upstash errors surface as store errors", async () => {
    const failing = createUpstashStore("https://example.upstash.io", "tok", async () =>
      Response.json([{ error: "WRONGTYPE" }, { result: 0 }]),
    );
    await assert.rejects(failing.incr("k", 1), { name: "StoreError" });
    const down = createUpstashStore("https://example.upstash.io", "tok", async () => new Response("", { status: 401 }));
    await assert.rejects(down.incr("k", 1), { name: "StoreError" });
  });
});

// ---------- Validation and HTTP helpers ----------

describe("validation", () => {
  const valid = { token: "t", ...input() };

  test("accepts a well-formed turn request and trims the name", () => {
    const parsed = TurnRequestSchema.safeParse({ ...valid, userName: "  Priya  " });
    assert.ok(parsed.success);
    assert.equal(parsed.data.userName, "Priya");
  });

  test("rejects oversize transcripts, names and topics", () => {
    const turn = { speaker: "user", text: "hello" };
    assert.equal(TurnRequestSchema.safeParse({ ...valid, transcript: Array(81).fill(turn) }).success, false);
    assert.equal(TurnRequestSchema.safeParse({ ...valid, userName: "x".repeat(41) }).success, false);
    assert.equal(TurnRequestSchema.safeParse({ ...valid, userName: "   " }).success, false);
    assert.equal(TurnRequestSchema.safeParse({ ...valid, topic: { ...TOPIC, title: "x".repeat(201) } }).success, false);
    assert.equal(TurnRequestSchema.safeParse({ ...valid, speaker: "user" }).success, false);
  });

  test("clips long transcript text to 2,000 characters", () => {
    const parsed = TurnRequestSchema.safeParse({ ...valid, transcript: [{ speaker: "user", text: "a ".repeat(1500) }] });
    assert.ok(parsed.success);
    assert.ok(parsed.data.transcript[0].text.length <= 2001);
  });

  test("client IP: first x-forwarded-for entry, then x-real-ip", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
    assert.equal(clientIp(new Headers()), "unknown");
  });
});

// ---------- Routes (no network: limits, tokens and validation only) ----------

describe("routes", () => {
  const env = { ...process.env };
  const setEnv = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10", ...headers },
      body: JSON.stringify(body),
    });

  test("session: daily limit per device cookie, friendly 429, cookie attributes", async (t) => {
    t.after(() => setEnv(env));
    setEnv({
      ANTHROPIC_API_KEY: "sk-test",
      SESSION_SECRET: "route-test-secret",
      DAILY_GD_LIMIT: "2",
      DAILY_GD_LIMIT_PER_IP: "0",
      DAILY_GD_LIMIT_GLOBAL: "0",
      UPSTASH_REDIS_REST_URL: undefined,
      KV_REST_API_URL: undefined,
    });
    const first = await startSession(post("/api/session", {}));
    assert.equal(first.status, 200);
    const cookie = first.headers.get("set-cookie") ?? "";
    assert.match(cookie, /gd_device=[A-Za-z0-9-]+/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Max-Age=31536000/);
    const body = (await first.json()) as { token: string; remainingToday: number };
    assert.equal(body.remainingToday, 1);
    assert.ok(verifySessionToken(body.token));

    const device = cookie.match(/gd_device=([^;]+)/)?.[1] ?? "";
    const again = { cookie: `gd_device=${device}` };
    assert.equal((await startSession(post("/api/session", {}, again))).status, 200);
    const refused = await startSession(post("/api/session", {}, again));
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), {
      error: "You've used today's 2 free GDs. Come back tomorrow.",
      code: "daily_limit",
    });
  });

  test("session: missing API key is a config error and counts nothing", async (t) => {
    t.after(() => setEnv(env));
    setEnv({ ANTHROPIC_API_KEY: undefined, SESSION_SECRET: undefined });
    const res = await startSession(post("/api/session", {}));
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { code: string }).code, "config");
  });

  test("session: non-JSON posts are refused", async () => {
    const res = await startSession(post("/api/session", {}, { "content-type": "text/plain" }));
    assert.equal(res.status, 415);
  });

  test("turn: bad token is 401 bad_token; bad body is 400", async (t) => {
    t.after(() => setEnv(env));
    setEnv({ ANTHROPIC_API_KEY: "sk-test", SESSION_SECRET: "route-test-secret" });
    const unauthorised = await requestTurn(post("/api/turn", { token: "forged.token", ...input() }));
    assert.equal(unauthorised.status, 401);
    assert.equal(((await unauthorised.json()) as { code: string }).code, "bad_token");
    const invalid = await requestTurn(post("/api/turn", { token: "x", ...input(), mode: "shout" }));
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "Invalid request (mode).", code: "bad_request" });
  });
});

// ---------- Claude calls against a local stub of the Messages API ----------

describe("Claude calls (real SDK, stubbed API)", () => {
  type Captured = { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> };
  const captured: Captured[] = [];
  let reply: { status: number; body: unknown; headers?: Record<string, string> } = { status: 200, body: {} };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      captured.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> });
      res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
      res.end(JSON.stringify(reply.body));
    });
  });
  const env = { ...process.env };

  const message = (text: string, stop_reason = "end_turn") => ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: text ? [{ type: "text", text }] : [],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  const post = (path: string, body: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.20" },
      body: JSON.stringify(body),
    });
  let token = "";

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    process.env.ANTHROPIC_API_KEY = "sk-test-stub";
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.SESSION_SECRET = "stub-test-secret";
    delete process.env.GD_MODEL;
    delete process.env.GD_TURN_EFFORT;
    token = createSessionToken().token;
  });
  after(() => {
    server.close();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });

  test("turn: request shape, caching breakpoints and a cleaned line", async () => {
    captured.length = 0;
    reply = { status: 200, body: message('Meera: "Roughly half of gig workers, Priya, earn below minimum wage."') };
    const res = await requestTurn(post("/api/turn", { token, ...input() }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: "Roughly half of gig workers, Priya, earn below minimum wage." });

    const [call] = captured;
    assert.match(call.url, /^\/v1\/messages/);
    assert.match(String(call.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    const body = call.body;
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal(body.max_tokens, 2000);
    assert.equal(body.fallbacks, "default");
    assert.deepEqual(body.output_config, { effort: "low" });
    for (const banned of ["thinking", "temperature", "budget_tokens", "betas", "stream"]) {
      assert.equal(banned in body, false, `${banned} must not be sent`);
    }
    const messages = body.messages as { role: string; content: { text: string; cache_control?: unknown }[] }[];
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user"); // no assistant prefill
    const marks = messages[0].content.map((b) => Boolean(b.cache_control));
    assert.deepEqual(marks, [false, false, false, true, false]);
    assert.deepEqual((body.system as { cache_control?: unknown }[])[0].cache_control, { type: "ephemeral" });
  });

  test("turn: a refusal or empty output is text null", async () => {
    reply = { status: 200, body: message("I'd rather not continue.", "refusal") };
    assert.deepEqual(await (await requestTurn(post("/api/turn", { token, ...input() }))).json(), { text: null });
    reply = { status: 200, body: message("*nods*") };
    assert.deepEqual(await (await requestTurn(post("/api/turn", { token, ...input() }))).json(), { text: null });
  });

  test("turn: upstream rate limit is 503 busy and leaks nothing", async () => {
    reply = {
      status: 429,
      headers: { "x-should-retry": "false" },
      body: { type: "error", error: { type: "rate_limit_error", message: "secret upstream detail" } },
    };
    const res = await requestTurn(post("/api/turn", { token, ...input() }));
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.equal(JSON.parse(text).code, "busy");
    assert.doesNotMatch(text, /secret upstream detail|sk-test/);
  });

  test("turn: other upstream errors are 502", async () => {
    reply = {
      status: 400,
      body: { type: "error", error: { type: "invalid_request_error", message: "bad things" } },
    };
    const res = await requestTurn(post("/api/turn", { token, ...input() }));
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { code: string }).code, "upstream");
  });

  test("score: structured output is parsed, normalised and returned with metrics", async () => {
    captured.length = 0;
    const section = { rating: 6, comment: "You entered late but made a clear point." };
    const assessment = {
      overall: { score: 58, headline: "Clear points, late entry", verdict: "You made two good points." },
      opening: section,
      participation: { ...section, rating: 12 },
      content: { ...section, newPoints: ["Security over flexibility"], repeatedPoints: [] },
      evidence: { ...section, examples: [], references: ["Built on Arjun"] },
      interruptions: section,
      drift: { ...section, pulledBack: true },
      summary: { ...section, rating: 7 },
      delivery: section,
      strengths: ["Clarity"],
      improvements: ["Enter earlier"],
    };
    reply = { status: 200, body: message(JSON.stringify(assessment)) };
    const record = {
      config: { topic: TOPIC, userName: "Priya", minutes: 10, sttLang: "en-IN", inputMode: "voice" },
      transcript: [
        { id: "a", speaker: "dominator", text: "Gig work is freedom.", startMs: 12_000, endMs: 30_000, phase: "discussion", kind: "turn" },
        { id: "b", speaker: "user", text: "Arjun, freedom without security is not freedom.", startMs: 31_000, endMs: 45_000, phase: "discussion", kind: "turn" },
      ],
      interruptions: [],
      discussionStartMs: 10_000,
      discussionEndMs: 610_000,
    };
    const res = await requestScore(post("/api/score", { token, record }));
    assert.equal(res.status, 200);
    const out = (await res.json()) as { metrics: GDMetrics; assessment: Assessment };
    assert.equal(out.metrics.entries, 1);
    assert.equal(out.metrics.referencesToOthers, 1);
    assert.equal(out.assessment.participation.rating, 10); // clamped
    assert.equal(out.assessment.summary.rating, 2); // no summary was given
    assert.equal(out.assessment.drift.pulledBack, null); // there was no drift

    const body = captured[0].body;
    assert.equal(body.max_tokens, 16000);
    assert.equal(body.fallbacks, "default");
    const outputConfig = body.output_config as { effort: string; format: { type: string } };
    assert.equal(outputConfig.effort, "medium");
    assert.equal(outputConfig.format.type, "json_schema");
    assert.equal("thinking" in body, false);
  });

  test("score: a refusal is 502", async () => {
    reply = { status: 200, body: message("", "refusal") };
    const record = {
      config: { topic: TOPIC, userName: "Priya", minutes: 10, sttLang: "en-IN", inputMode: "voice" },
      transcript: [],
      interruptions: [],
      discussionStartMs: 0,
      discussionEndMs: 600_000,
    };
    const res = await requestScore(post("/api/score", { token, record }));
    assert.equal(res.status, 502);
  });
});
