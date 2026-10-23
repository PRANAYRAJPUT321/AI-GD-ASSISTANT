// POST /api/turn: generates one AI participant's next line.

import type { NextRequest } from "next/server";
import type { TurnResponse } from "@/lib/types";
import { assertAiConfigured, generateLine } from "@/lib/server/ai";
import { errorResponse, jsonError, jsonOk } from "@/lib/server/http";
import { consumeSessionCall } from "@/lib/server/limits";
import { verifySessionToken } from "@/lib/server/session";
import { getStore } from "@/lib/server/store";
import { LIMITS, parseBody, TurnRequestSchema } from "@/lib/server/validate";

export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<Response> {
  const parsed = await parseBody(request, TurnRequestSchema, LIMITS.turnBodyBytes);
  if (!parsed.ok) return parsed.response;
  const { token, ...input } = parsed.data;
  try {
    assertAiConfigured();
    const claims = verifySessionToken(token);
    if (!claims) {
      return jsonError(401, "Your session has expired. Start a new GD.", "bad_token");
    }
    if (!(await consumeSessionCall(getStore(), claims.sid, "turn"))) {
      return jsonError(429, "This GD has used all of its AI turns.", "turn_limit");
    }
    // request.signal: a dropped prefetch in the browser cancels the upstream call.
    const text = await generateLine(input, request.signal);
    return jsonOk<TurnResponse>({ text });
  } catch (err) {
    return errorResponse(err, "/api/turn", request.signal);
  }
}
