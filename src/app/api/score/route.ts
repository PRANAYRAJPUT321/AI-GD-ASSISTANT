// POST /api/score: computes the deterministic metrics for a finished GD and asks
// the evaluator model for the structured assessment (or builds one from the metrics in
// practice mode, when no AI evaluator is available).

import type { NextRequest } from "next/server";
import { computeMetrics } from "@/lib/metrics";
import type { ScoreResponse } from "@/lib/scoring";
import { assessOrPractice } from "@/lib/server/ai";
import { errorResponse, jsonError, jsonOk } from "@/lib/server/http";
import { consumeSessionCall } from "@/lib/server/limits";
import { verifySessionToken } from "@/lib/server/session";
import { getStore } from "@/lib/server/store";
import { LIMITS, parseBody, ScoreRequestSchema } from "@/lib/server/validate";

export const maxDuration = 120;

export async function POST(request: NextRequest): Promise<Response> {
  const parsed = await parseBody(request, ScoreRequestSchema, LIMITS.scoreBodyBytes);
  if (!parsed.ok) return parsed.response;
  const { token, record } = parsed.data;
  try {
    const claims = verifySessionToken(token);
    if (!claims) {
      return jsonError(401, "Your session has expired, so this GD can't be scored.", "bad_token");
    }
    if (!(await consumeSessionCall(getStore(), claims.sid, "score"))) {
      return jsonError(429, "This GD has already been scored the maximum number of times.", "score_limit");
    }
    const metrics = computeMetrics(record);
    const { assessment, offline } = await assessOrPractice(record, metrics, request.signal);
    return jsonOk<ScoreResponse>(offline ? { metrics, assessment, offline } : { metrics, assessment });
  } catch (err) {
    return errorResponse(err, "/api/score", request.signal);
  }
}
