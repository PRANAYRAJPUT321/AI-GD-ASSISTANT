// Request validation for the API routes (zod). Everything the browser sends is
// untrusted: sizes are bounded so a single request cannot run up a large Claude bill.

import { z } from "zod";
import type { ScoreRequest } from "../scoring";
import { PERSONA_IDS, type TurnRequest } from "../types";
import { jsonError, readJsonBody } from "./http";

export const LIMITS = {
  topicTitle: 200,
  userName: 40,
  turnTranscript: 80,
  /** Characters of a transcript line used in a turn prompt. */
  turnText: 2000,
  partialUserText: 3000,
  scoreTranscript: 300,
  /** A single candidate turn can run 150 s (~2,500 characters); allow headroom. */
  scoreText: 8000,
  /** Request body caps (bytes). */
  turnBodyBytes: 512 * 1024,
  scoreBodyBytes: 4 * 1024 * 1024,
} as const;

const SPEAKER_IDS = [...PERSONA_IDS, "user", "moderator"] as const;
const CUES = [
  "open",
  "respond-user",
  "agree-user",
  "agree-last",
  "drift",
  "follow-drift",
  "bring-back",
  "late-strong",
  "continue-after-interjection",
  "wrap-up",
  "normal",
] as const;
const TURN_KINDS = ["turn", "interjection", "summary", "moderator"] as const;

/**
 * Clips long text instead of rejecting it: a candidate who talks for two minutes
 * should not break every later turn request. Absurd sizes are still refused.
 */
const clippedText = (keep: number, reject: number) =>
  z
    .string()
    .max(reject)
    .transform((s) => (s.length > keep ? `${s.slice(0, keep).trimEnd()}…` : s));

const TopicSchema = z.object({
  id: z.string().max(300),
  title: z.string().trim().min(1).max(LIMITS.topicTitle),
  category: z.enum(["business", "current-affairs", "abstract"]),
  hint: z.string().trim().max(300).optional(),
});

const UserNameSchema = z.string().trim().min(1).max(LIMITS.userName);

const WireTurnSchema = z.object({
  speaker: z.enum(SPEAKER_IDS),
  text: clippedText(LIMITS.turnText, LIMITS.turnText * 4),
  interrupted: z.boolean().optional(),
  kind: z.enum(TURN_KINDS).optional(),
  continuation: z.boolean().optional(),
});

export const TurnRequestSchema = z.object({
  token: z.string().min(1).max(2000),
  topic: TopicSchema,
  userName: UserNameSchema,
  speaker: z.enum(PERSONA_IDS),
  mode: z.enum(["turn", "interject", "summary"]),
  cue: z.enum(CUES),
  elapsedSec: z.number().min(0).max(4 * 3600),
  totalSec: z.number().min(0).max(4 * 3600),
  transcript: z.array(WireTurnSchema).max(LIMITS.turnTranscript),
  partialUserText: clippedText(LIMITS.partialUserText, LIMITS.partialUserText * 4).optional(),
}) satisfies z.ZodType<TurnRequest>;

const MsSchema = z.number().min(-1e9).max(1e10);

const TurnSchema = z.object({
  id: z.string().max(100),
  speaker: z.enum(SPEAKER_IDS),
  text: z.string().max(LIMITS.scoreText),
  startMs: MsSchema,
  endMs: MsSchema,
  phase: z.enum(["intro", "discussion", "summary"]),
  kind: z.enum(TURN_KINDS),
  cue: z.enum(CUES).optional(),
  interrupted: z.boolean().optional(),
  interruptedBy: z.enum(SPEAKER_IDS).optional(),
  continuation: z.boolean().optional(),
  typed: z.boolean().optional(),
});

const InterruptionSchema = z.object({
  id: z.string().max(100),
  atMs: MsSchema,
  by: z.enum(PERSONA_IDS),
  interjectionTurnId: z.string().max(100),
  userTextBefore: z.string().max(LIMITS.scoreText),
  outcome: z.enum(["held", "yielded", "pending"]),
});

export const ScoreRequestSchema = z.object({
  token: z.string().min(1).max(2000),
  record: z.object({
    config: z.object({
      topic: TopicSchema,
      userName: UserNameSchema,
      minutes: z.number().min(1).max(60),
      sttLang: z.string().max(35),
      inputMode: z.enum(["voice", "text"]),
    }),
    transcript: z.array(TurnSchema).max(LIMITS.scoreTranscript),
    interruptions: z.array(InterruptionSchema).max(50),
    discussionStartMs: MsSchema,
    discussionEndMs: MsSchema,
  }),
}) satisfies z.ZodType<ScoreRequest>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Reads, size-checks and validates a JSON body. Responds 400/413/415 on failure. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes: number,
): Promise<ParseResult<z.output<S>>> {
  const body = await readJsonBody(request, maxBytes);
  if (!body.ok) return body;
  const result = schema.safeParse(body.body);
  if (result.success) return { ok: true, data: result.data };
  // Name the first offending field (never echo values back).
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  return { ok: false, response: jsonError(400, `Invalid request${where}.`, "bad_request") };
}
