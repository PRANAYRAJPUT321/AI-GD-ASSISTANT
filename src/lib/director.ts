// The director: who speaks next in the live GD, and with what cue (DESIGN §4 "Director rules").
//
// Pure: the same transcript, context and random draws always give the same choice. Every
// random decision goes through ctx.random, so tests can seed it.

import { PERSONA_IDS, type Cue, type PersonaId, type SpeakerId, type Turn } from "./types";

export interface DirectorChoice {
  speaker: PersonaId;
  cue: Cue;
}

export interface DirectorContext {
  /** How far through the discussion the next line will be spoken, 0..1. */
  elapsedFrac: number;
  /** A choice that must win (the dominator after the candidate yielded to an interjection). */
  forced?: DirectorChoice;
  /** Uniform random number in [0, 1). */
  random(): number;
  /** Never pick this participant (their line just failed, so someone else is asked). */
  avoid?: PersonaId;
}

/** After a drift: who reacts, and how (weights sum to 1). */
const AFTER_DRIFT: readonly (readonly [PersonaId, Cue, number])[] = [
  ["agreer", "follow-drift", 0.6],
  ["data", "follow-drift", 0.15],
  ["dominator", "bring-back", 0.25],
];

const MAX_DRIFTS = 3;
const DRIFT_WINDOW: readonly [number, number] = [0.15, 0.85];
/** Discussion turns that must pass after a drift before the drifter may drift again. */
const TURNS_BETWEEN_DRIFTS = 4;
/** The drifter's first tangent is more likely once the discussion is under way. */
const FIRST_DRIFT_BOOST_AFTER = 0.3;
/** The Silent Smart One stays quiet until SMART_FROM, and may speak a second time only after SMART_SECOND_AFTER. */
const SMART_FROM = 0.55;
const SMART_SECOND_AFTER = 0.82;
const MAX_SMART_TURNS = 2;
const WRAP_UP_FROM = 0.9;

const isPersona = (speaker: SpeakerId): speaker is PersonaId => speaker !== "user" && speaker !== "moderator";

/** Picks an option with probability proportional to its weight; null if no weight is positive. */
function pickWeighted<T>(options: readonly (readonly [T, number])[], random: () => number): T | null {
  const live = options.filter(([, weight]) => weight > 0);
  if (live.length === 0) return null;
  const total = live.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [option, weight] of live) {
    roll -= weight;
    if (roll < 0) return option;
  }
  return live[live.length - 1][0]; // floating-point leftovers land on the last option
}

/**
 * The next AI participant and their cue. Looks only at discussion-phase turns and ignores the
 * moderator. The candidate may be the last speaker; an AI never follows itself.
 */
export function chooseNext(transcript: readonly Turn[], ctx: DirectorContext): DirectorChoice {
  if (ctx.forced) return { speaker: ctx.forced.speaker, cue: ctx.forced.cue };

  const turns = transcript.filter((turn) => turn.phase === "discussion" && turn.speaker !== "moderator");
  const allowed = (id: PersonaId) => id !== ctx.avoid;
  const last = turns.at(-1);

  // Nobody has spoken: the dominator opens.
  if (!last) return { speaker: allowed("dominator") ? "dominator" : "data", cue: "open" };

  // The drifter just went off on a tangent: someone follows it, or the dominator pulls it back.
  if (last.speaker === "drifter") {
    const options = AFTER_DRIFT.filter(([id]) => allowed(id));
    const pick = pickWeighted(
      options.map(([id, cue, weight]) => [{ speaker: id, cue }, weight] as const),
      ctx.random,
    );
    if (pick) return pick;
  }

  // Someone followed the drift: time to bring the discussion back.
  if (isPersona(last.speaker) && last.cue === "follow-drift") {
    const order: PersonaId[] = last.speaker === "dominator" ? ["data", "dominator"] : ["dominator", "data"];
    const speaker = order.find((id) => allowed(id) && id !== last.speaker);
    if (speaker) return { speaker, cue: "bring-back" };
  }

  const speaker = weightedSpeaker(turns, last, ctx) ?? fallbackSpeaker(last, ctx);
  return { speaker, cue: cueFor(speaker, turns, last, ctx.elapsedFrac) };
}

/** The weighted draw for an ordinary turn (never the previous speaker). */
function weightedSpeaker(turns: readonly Turn[], last: Turn, ctx: DirectorContext): PersonaId | null {
  const f = ctx.elapsedFrac;
  const userJustSpoke = last.speaker === "user";
  const count = (id: PersonaId) => turns.filter((turn) => turn.speaker === id).length;

  const drifts = count("drifter");
  const lastDrift = turns.map((turn) => turn.speaker).lastIndexOf("drifter");
  const turnsSinceDrift = lastDrift < 0 ? turns.length : turns.length - 1 - lastDrift;
  const mayDrift =
    drifts < MAX_DRIFTS && f >= DRIFT_WINDOW[0] && f <= DRIFT_WINDOW[1] && turnsSinceDrift >= TURNS_BETWEEN_DRIFTS;

  const smartTurns = count("smart");
  let smart = 0;
  if (f >= SMART_FROM && smartTurns < MAX_SMART_TURNS) {
    if (smartTurns === 0) smart = 5.0;
    else if (f > SMART_SECOND_AFTER) smart = 0.8;
  }

  const weights: Record<PersonaId, number> = {
    dominator: userJustSpoke ? 3.5 : 3.0,
    data: 2.2,
    agreer: userJustSpoke ? 3.0 : 1.2,
    drifter: mayDrift ? (drifts === 0 && f > FIRST_DRIFT_BOOST_AFTER ? 2.5 : 1.3) : 0,
    smart,
  };

  return pickWeighted(
    PERSONA_IDS.filter((id) => id !== last.speaker && id !== ctx.avoid).map((id) => [id, weights[id]] as const),
    ctx.random,
  );
}

/** Only reachable if every weighted option were excluded; keeps the result total anyway. */
function fallbackSpeaker(last: Turn, ctx: DirectorContext): PersonaId {
  return PERSONA_IDS.find((id) => id !== last.speaker && id !== ctx.avoid) ?? "data";
}

function cueFor(speaker: PersonaId, turns: readonly Turn[], last: Turn, elapsedFrac: number): Cue {
  if (speaker === "drifter") return "drift";
  if (speaker === "smart" && !turns.some((turn) => turn.speaker === "smart")) return "late-strong";
  if (speaker === "agreer") return turns.some((turn) => turn.speaker === "user") ? "agree-user" : "agree-last";
  if (last.speaker === "user") return "respond-user";
  if (elapsedFrac >= WRAP_UP_FROM) return "wrap-up";
  return "normal";
}
