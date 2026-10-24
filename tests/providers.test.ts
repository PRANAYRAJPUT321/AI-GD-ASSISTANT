import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as requestScore } from "@/app/api/score/route";
import { POST as startSession } from "@/app/api/session/route";
import { POST as requestTurn } from "@/app/api/turn/route";
import type { Assessment } from "@/lib/scoring";
import { GET as health } from "@/app/api/health/route";
import { resetAiAvailability } from "@/lib/server/ai";
import { resetChatCheck, resetChatModelState, setChatDeadlines } from "@/lib/server/chat";
import { ConfigError } from "@/lib/server/http";
import { findProvider, requireProvider } from "@/lib/server/provider";
import { createSessionToken } from "@/lib/server/session";
import type { Topic } from "@/lib/types";

const TOPIC: Topic = {
  id: "business:gig",
  title: "Is the gig economy good for India's workforce?",
  category: "business",
};

// ---------- Choosing the provider ----------

describe("provider selection", () => {
  test("no key at all is null, and requireProvider is a config error", () => {
    assert.equal(findProvider({}), null);
    assert.throws(() => requireProvider({}), ConfigError);
  });

  test("auto: Claude first, then Gemini, then Groq", () => {
    assert.equal(findProvider({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })?.id, "claude");
    assert.equal(findProvider({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })?.id, "gemini");
    assert.equal(findProvider({ GROQ_API_KEY: "q" })?.id, "groq");
    assert.equal(findProvider({ GOOGLE_API_KEY: "g" })?.id, "gemini");
  });

  test("presets carry the endpoint, ordered default models and a low reasoning effort for lines", () => {
    const gemini = findProvider({ GEMINI_API_KEY: "g" });
    assert.ok(gemini && gemini.id === "gemini");
    assert.equal(gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
    assert.deepEqual(gemini.turnModels, [
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
    ]);
    assert.equal(gemini.scoringModels[0], "gemini-flash-latest");
    assert.deepEqual(gemini.turnExtra, { reasoning_effort: "low" });
    const groq = findProvider({ GROQ_API_KEY: "q" });
    assert.ok(groq && groq.id === "groq");
    assert.equal(groq.baseUrl, "https://api.groq.com/openai/v1");
    assert.deepEqual(groq.turnModels, ["openai/gpt-oss-120b"]);
    assert.deepEqual(groq.scoringModels, ["openai/gpt-oss-120b"]);
  });

  test("GD_PROVIDER wins over the auto order, and needs its own key", () => {
    assert.equal(findProvider({ GD_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" })?.id, "gemini");
    assert.equal(findProvider({ GD_PROVIDER: " Groq ", GROQ_API_KEY: "q" })?.id, "groq");
    assert.throws(() => findProvider({ GD_PROVIDER: "groq", ANTHROPIC_API_KEY: "a" }), /GROQ_API_KEY is not set/);
    assert.throws(() => findProvider({ GD_PROVIDER: "openrouter", GROQ_API_KEY: "q" }), /must be one of/);
  });

  test("GD_MODEL, GD_SCORING_MODEL and LLM_BASE_URL override a preset", () => {
    const p = findProvider({
      GROQ_API_KEY: "q",
      GD_MODEL: "openai/gpt-oss-20b",
      GD_SCORING_MODEL: "openai/gpt-oss-120b",
      LLM_BASE_URL: "http://localhost:9999/v1/",
    });
    assert.ok(p && p.id === "groq");
    assert.deepEqual(p.turnModels, ["openai/gpt-oss-20b"]);
    assert.deepEqual(p.scoringModels, ["openai/gpt-oss-120b"]);
    assert.equal(p.baseUrl, "http://localhost:9999/v1");
  });

  test("GD_MODEL takes a comma-separated list, which scoring also uses unless GD_SCORING_MODEL is set", () => {
    const p = findProvider({ GEMINI_API_KEY: "g", GD_MODEL: " gemini-a , ,gemini-b " });
    assert.ok(p && p.id === "gemini");
    assert.deepEqual(p.turnModels, ["gemini-a", "gemini-b"]);
    assert.deepEqual(p.scoringModels, ["gemini-a", "gemini-b"]);
    const blank = findProvider({ GEMINI_API_KEY: "g", GD_MODEL: " , " });
    assert.ok(blank && blank.id === "gemini");
    assert.equal(blank.turnModels[0], "gemini-flash-lite-latest");
  });

  test("a generic OpenAI-compatible endpoint needs a base URL and a model", () => {
    assert.throws(() => findProvider({ GD_PROVIDER: "openai", LLM_API_KEY: "k" }), /LLM_BASE_URL/);
    assert.throws(
      () => findProvider({ GD_PROVIDER: "openai", LLM_API_KEY: "k", LLM_BASE_URL: "https://x.example/v1" }),
      /GD_MODEL/,
    );
    const p = findProvider({ LLM_API_KEY: "k", LLM_BASE_URL: "https://x.example/v1", GD_MODEL: "m" });
    assert.equal(p?.id, "openai");
  });
});

// ---------- The routes against a local stub of a chat completions API ----------

describe("chat provider routes (stubbed OpenAI-compatible API)", () => {
  type Captured = { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> };
  const captured: Captured[] = [];
  let replies: { status: number; body: unknown; headers?: Record<string, string>; delayMs?: number }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      captured.push({ url: req.url ?? "", headers: req.headers, body });
      const reply = replies.length > 1 ? replies.shift()! : replies[0];
      setTimeout(() => {
        if (res.destroyed) return; // the caller gave up waiting
        res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
        res.end(JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
  });
  const env = { ...process.env };
  const completion = (content: string, finish_reason = "stop") => ({
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }],
  });
  const post = (path: string, body: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.40" },
      body: JSON.stringify(body),
    });
  const turnBody = (token: string) => ({
    token,
    topic: TOPIC,
    userName: "Priya",
    speaker: "data",
    mode: "turn",
    cue: "respond-user",
    elapsedSec: 95,
    totalSec: 600,
    transcript: [
      { speaker: "moderator", text: "Today's topic: the gig economy. You may begin." },
      { speaker: "user", text: "Gig work gives flexibility but no security." },
    ],
  });
  let token = "";

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    for (const key of ["ANTHROPIC_API_KEY", "pranay_api_key", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GD_MODEL", "GD_SCORING_MODEL"]) {
      delete process.env[key];
    }
    process.env.GD_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gsk-test-stub";
    process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/openai/v1`;
    process.env.SESSION_SECRET = "chat-stub-test-secret";
    token = createSessionToken().token;
  });
  beforeEach(() => {
    captured.length = 0;
    delete process.env.GD_MODEL;
    delete process.env.GD_SCORING_MODEL;
    setChatDeadlines();
    resetAiAvailability();
    resetChatModelState();
    resetChatCheck();
  });
  after(() => {
    server.close();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });

  test("session: a chat provider key alone is enough to start a GD", async () => {
    const res = await startSession(post("/api/session", {}));
    assert.equal(res.status, 200);
    assert.ok(((await res.json()) as { token: string }).token);
  });

  test("turn: request shape and a cleaned line", async () => {
    replies = [{ status: 200, body: completion('Meera: "Roughly half of gig workers, Priya, have no social security."') }];
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: "Roughly half of gig workers, Priya, have no social security." });

    const [call] = captured;
    assert.equal(call.url, "/openai/v1/chat/completions");
    assert.equal(call.headers.authorization, "Bearer gsk-test-stub");
    assert.equal(call.body.model, "openai/gpt-oss-120b");
    assert.equal(call.body.max_tokens, 4000);
    assert.equal(call.body.reasoning_effort, "low");
    assert.equal("response_format" in call.body, false);
    const messages = call.body.messages as { role: string; content: string }[];
    assert.deepEqual(
      messages.map((m) => m.role),
      ["system", "user"],
    );
    assert.match(messages[0].content, /gig economy/);
    assert.match(messages[1].content, /Gig work gives flexibility but no security/);
    assert.match(messages[1].content, /Meera/, "the instruction names the speaker");
  });

  test("turn: a line cut off by the token limit is not spoken", async () => {
    replies = [{ status: 200, body: completion("I think the real issue here is that", "length") }];
    assert.deepEqual(await (await requestTurn(post("/api/turn", turnBody(token)))).json(), { text: null });
  });

  test("turn: one rate limit is retried; a second falls back to a practice line", async () => {
    replies = [
      { status: 429, headers: { "retry-after": "0" }, body: { error: { message: "Rate limit reached" } } },
      { status: 200, body: completion("Sorry, Priya, but the data says otherwise.") },
    ];
    const ok = await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(ok.status, 200);
    assert.equal(captured.length, 2);

    captured.length = 0;
    replies = [{ status: 429, headers: { "retry-after": "0" }, body: { error: { message: "Rate limit reached" } } }];
    const busy = await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(busy.status, 200);
    assert.equal(((await busy.json()) as { offline?: boolean }).offline, true);
    assert.equal(captured.length, 2, "exactly one retry");
  });

  test("turn: a rejected key falls back to practice lines, leaks nothing and pauses the AI", async () => {
    replies = [{ status: 401, body: { error: { message: "Invalid API Key gsk-test-stub" } } }];
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as { text: string; offline?: boolean };
    assert.equal(body.offline, true);
    assert.match(body.text, /Priya/, "the practice line uses the candidate's name");
    assert.doesNotMatch(text, /gsk-test-stub|Invalid API Key/);
    await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(captured.length, 1, "the rejected key isn't tried again straight away");
  });

  test("turn: a missing model hands over to the next one, which is then used straight away", async () => {
    process.env.GD_MODEL = "model-a,model-b";
    replies = [
      { status: 404, body: [{ error: { code: 404, message: "models/model-a is not found for API version v1beta" } }] },
      { status: 200, body: completion("Priya, the numbers tell a different story.") },
    ];
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.deepEqual(await res.json(), { text: "Priya, the numbers tell a different story." });
    assert.deepEqual(
      captured.map((c) => c.body.model),
      ["model-a", "model-b"],
    );

    captured.length = 0;
    replies = [{ status: 200, body: completion("Let me add one more number, Priya.") }];
    await requestTurn(post("/api/turn", turnBody(token)));
    assert.deepEqual(
      captured.map((c) => c.body.model),
      ["model-b"],
      "the missing model is passed over",
    );
  });

  test("turn: a model out of quota hands over to the next without waiting", async () => {
    process.env.GD_MODEL = "model-a,model-b";
    replies = [
      { status: 429, body: [{ error: { code: 429, message: "Quota exceeded. Please retry in 41.2s." } }] },
      { status: 200, body: completion("Priya, the data says otherwise.") },
    ];
    const started = Date.now();
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(((await res.json()) as { offline?: boolean }).offline, undefined);
    assert.ok(Date.now() - started < 2_000, "no wait before the next model");
    assert.deepEqual(
      captured.map((c) => c.body.model),
      ["model-a", "model-b"],
    );
  });

  test("turn: when every model is out of quota the GD carries on with a practice line", async () => {
    process.env.GD_MODEL = "model-a,model-b";
    replies = [{ status: 429, body: { error: { message: "Daily limit reached: GenerateRequestsPerDayPerProjectPerModel" } } }];
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { offline?: boolean }).offline, true);
    assert.equal(captured.length, 2, "each model once; a daily limit isn't retried");
  });

  test("turn: a model that rejects the reasoning setting is retried without it", async () => {
    replies = [
      { status: 400, body: { error: { message: "Thinking level LOW is not supported for this model." } } },
      { status: 200, body: completion("Priya, here is a number for you.") },
    ];
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.deepEqual(await res.json(), { text: "Priya, here is a number for you." });
    assert.equal(captured.length, 2);
    assert.equal(captured[0].body.reasoning_effort, "low");
    assert.equal("reasoning_effort" in captured[1].body, false);
    assert.equal(captured[1].body.model, captured[0].body.model);

    captured.length = 0;
    await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal("reasoning_effort" in captured[0].body, false, "remembered for the next line");
  });

  test("turn: a model too slow to answer hands over to the next within the deadline", async () => {
    process.env.GD_MODEL = "model-a,model-b";
    setChatDeadlines({ turnMs: 600 });
    replies = [
      { status: 200, body: completion("Too late, Priya."), delayMs: 2_000 },
      { status: 200, body: completion("Priya, the quicker answer is this.") },
    ];
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.deepEqual(await res.json(), { text: "Priya, the quicker answer is this." });
    assert.deepEqual(
      captured.map((c) => c.body.model),
      ["model-a", "model-b"],
    );
  });

  test("turn: a reply that isn't JSON falls back to a practice line", async () => {
    replies = [{ status: 200, body: "<html>gateway</html>" }];
    const res = await requestTurn(post("/api/turn", turnBody(token)));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { offline?: boolean }).offline, true);
  });

  test("health: ?check=1 reports which models the key can use and a test line, without the key", async () => {
    process.env.GD_MODEL = "model-a,model-b";
    replies = [
      { status: 200, body: { object: "list", data: [{ id: "models/model-b" }, { id: "models/other" }] } },
      { status: 404, body: { error: { message: "model-a not found" } } },
      { status: 200, body: completion("Hello everyone.") },
    ];
    const res = await health(new NextRequest("http://localhost/api/health?check=1"));
    const text = await res.text();
    const body = JSON.parse(text) as {
      ai: { provider: string; turnModels: string[] };
      check: { models: Record<string, boolean | null>; available: string[] | null; line: { ok: boolean; model?: string } };
    };
    assert.equal(body.ai.provider, "groq");
    assert.deepEqual(body.ai.turnModels, ["model-a", "model-b"]);
    assert.deepEqual(body.check.models, { "model-a": false, "model-b": true });
    assert.deepEqual(body.check.available, ["model-b", "other"]);
    assert.equal(body.check.line.ok, true);
    assert.equal(body.check.line.model, "model-b");
    assert.equal(captured[0].url, "/openai/v1/models");
    assert.doesNotMatch(text, /gsk-test-stub/);

    captured.length = 0;
    await health(new NextRequest("http://localhost/api/health?check=1"));
    assert.equal(captured.length, 0, "the check is cached");
    const plain = (await (await health(new NextRequest("http://localhost/api/health"))).json()) as { check?: unknown };
    assert.equal(plain.check, undefined);
  });

  test("health: a failed check line reports the service's message with the key removed", async () => {
    replies = [
      { status: 401, body: { error: { message: "Invalid API Key gsk-test-stub" } } },
    ];
    const res = await health(new NextRequest("http://localhost/api/health?check=1"));
    const text = await res.text();
    const body = JSON.parse(text) as { check: { models: Record<string, unknown>; line: { ok: boolean; status: number; detail: string } } };
    assert.deepEqual(body.check.models, { "openai/gpt-oss-120b": null });
    assert.equal(body.check.line.ok, false);
    assert.equal(body.check.line.status, 401);
    assert.equal(body.check.line.detail, "Invalid API Key [key]");
    assert.doesNotMatch(text, /gsk-test-stub/);
  });

  test("score: JSON (even in a code fence) is parsed, validated and normalised", async () => {
    const section = { rating: 6, comment: "You entered late but made a clear point." };
    const assessment: Assessment = {
      overall: { score: 58, headline: "Clear points, late entry", verdict: "You made two good points." },
      opening: section,
      participation: { ...section, rating: 12 },
      content: { ...section, newPoints: ["Security over flexibility"], repeatedPoints: [] },
      evidence: { ...section, examples: [], references: [] },
      interruptions: section,
      drift: { ...section, pulledBack: true },
      summary: { ...section, rating: 7 },
      delivery: section,
      strengths: ["Clarity"],
      improvements: ["Enter earlier"],
    };
    replies = [{ status: 200, body: completion("```json\n" + JSON.stringify(assessment) + "\n```") }];
    const record = {
      config: { topic: TOPIC, userName: "Priya", minutes: 10, sttLang: "en-IN", inputMode: "voice" },
      transcript: [
        { id: "a", speaker: "dominator", text: "Gig work is freedom.", startMs: 12_000, endMs: 30_000, phase: "discussion", kind: "turn" },
        { id: "b", speaker: "user", text: "Freedom without security is not freedom.", startMs: 31_000, endMs: 45_000, phase: "discussion", kind: "turn" },
      ],
      interruptions: [],
      discussionStartMs: 10_000,
      discussionEndMs: 610_000,
    };
    const res = await requestScore(post("/api/score", { token, record }));
    assert.equal(res.status, 200);
    const out = (await res.json()) as { assessment: Assessment };
    assert.equal(out.assessment.participation.rating, 10); // clamped
    assert.equal(out.assessment.summary.rating, 2); // no summary was given
    assert.equal(out.assessment.drift.pulledBack, null); // there was no drift

    const body = captured[0].body;
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.reasoning_effort, "medium");
    const messages = body.messages as { content: string }[];
    assert.match(messages[1].content, /JSON Schema/);
  });

  test("score: an unusable reply from one model hands over to the next", async () => {
    process.env.GD_SCORING_MODEL = "model-a,model-b";
    const section = { rating: 6, comment: "Clear." };
    const assessment: Assessment = {
      overall: { score: 55, headline: "Steady", verdict: "You held your ground." },
      opening: section,
      participation: section,
      content: { ...section, newPoints: [], repeatedPoints: [] },
      evidence: { ...section, examples: [], references: [] },
      interruptions: section,
      drift: { ...section, pulledBack: null },
      summary: section,
      delivery: section,
      strengths: ["Calm"],
      improvements: ["Use data"],
    };
    replies = [
      { status: 200, body: completion('{"overall": {"score": 55, "headline": "Ste', "length") },
      { status: 200, body: completion(JSON.stringify(assessment)) },
    ];
    const record = {
      config: { topic: TOPIC, userName: "Priya", minutes: 10, sttLang: "en-IN", inputMode: "voice" },
      transcript: [],
      interruptions: [],
      discussionStartMs: 0,
      discussionEndMs: 600_000,
    };
    const res = await requestScore(post("/api/score", { token, record }));
    const out = (await res.json()) as { assessment: Assessment; offline?: boolean };
    assert.equal(out.offline, undefined);
    assert.equal(out.assessment.overall.headline, "Steady");
    assert.deepEqual(
      captured.map((c) => c.body.model),
      ["model-a", "model-b"],
    );
    assert.equal(captured[0].body.max_tokens, 8000);
  });

  test("score: a reply that isn't a valid assessment falls back to a practice scorecard", async () => {
    replies = [{ status: 200, body: completion('{"overall": "great"}') }];
    const record = {
      config: { topic: TOPIC, userName: "Priya", minutes: 10, sttLang: "en-IN", inputMode: "voice" },
      transcript: [],
      interruptions: [],
      discussionStartMs: 0,
      discussionEndMs: 600_000,
    };
    const res = await requestScore(post("/api/score", { token, record }));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { offline?: boolean }).offline, true);
  });
});
