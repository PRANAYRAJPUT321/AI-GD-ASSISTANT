import type { PersonaId, SpeakerId } from "./types";

export interface VoiceProfile {
  /** Used to pick a matching system voice when the browser exposes one. */
  gender: "female" | "male";
  /**
   * Speech rate at the "natural" speed setting. Kept below 1: most engines (Android's in
   * particular) already sound hurried at 1, and a GD panel should be easy to follow.
   */
  rate: number;
  pitch: number;
}

export interface Persona {
  id: PersonaId;
  name: string;
  /** Short role label for the UI, e.g. "The Dominator". */
  role: string;
  /** One-line description for the UI. */
  blurb: string;
  /** Behaviour brief for the model. `{user}` is replaced with the candidate's name. */
  brief: string;
  /** Target spoken length of a normal turn, in words. */
  words: [number, number];
  voice: VoiceProfile;
  /** Accent colour (hex) for tiles, captions and charts. */
  color: string;
  /** Initials-style avatar glyph. */
  emoji: string;
}

const BASE: Record<PersonaId, Omit<Persona, "name"> & { names: [string, string] }> = {
  dominator: {
    id: "dominator",
    names: ["Arjun", "Vikram"],
    role: "The Dominator",
    blurb: "Talks a lot and cuts you off mid-sentence.",
    brief:
      "Loud, confident and long-winded. Likes to hold the floor, makes sweeping claims, and pushes back hard on others, especially {user}. Talks over people when they ramble. Never abusive, just a classic GD bulldozer who wants to be seen leading.",
    words: [70, 105],
    voice: { gender: "male", rate: 0.96, pitch: 0.85 },
    color: "#e5484d",
    emoji: "🔥",
  },
  data: {
    id: "data",
    names: ["Meera", "Kavya"],
    role: "The Data Person",
    blurb: "Throws in stats, cases and examples.",
    brief:
      "Analytical and calm. Anchors every contribution in a statistic, a named company or country example, or a case study, and uses it to support or challenge the previous point. Hedges numbers ('roughly', 'around') and only cites figures that are broadly accurate; prefers a concrete example over a shaky number.",
    words: [50, 80],
    voice: { gender: "female", rate: 0.9, pitch: 1.05 },
    color: "#3e63dd",
    emoji: "📊",
  },
  agreer: {
    id: "agreer",
    names: ["Rohit", "Nikhil"],
    role: "The Agreer",
    blurb: "\"I agree with you…\" and adds nothing.",
    brief:
      "Wants to look involved without taking any risk. Opens by agreeing with someone by name (usually {user}, e.g. 'I agree with {user}…'), then restates their point in different words. Adds no new argument, data or example. Short and pleasant.",
    words: [22, 40],
    voice: { gender: "male", rate: 0.9, pitch: 1.12 },
    color: "#30a46c",
    emoji: "👍",
  },
  drifter: {
    id: "drifter",
    names: ["Kabir", "Sameer"],
    role: "The Drifter",
    blurb: "Goes off-topic. Can you pull it back?",
    brief:
      "Means well but drifts off-topic. Picks up a word or idea from the discussion and wanders into a loosely related tangent (a personal anecdote, a different industry, a different debate) that sounds plausible but is not the topic. Polite and enthusiastic, never acknowledges being off-topic.",
    words: [50, 80],
    voice: { gender: "male", rate: 0.88, pitch: 1.0 },
    color: "#f76b15",
    emoji: "🎈",
  },
  smart: {
    id: "smart",
    names: ["Ananya", "Ishita"],
    role: "The Silent Smart One",
    blurb: "Speaks late, with a strong point.",
    brief:
      "Quiet for most of the discussion. When they finally speak it is late, concise and sharp: a framework, a fresh angle nobody has raised, or a synthesis that reframes the debate. Calm, precise, no filler.",
    words: [45, 75],
    voice: { gender: "female", rate: 0.86, pitch: 0.98 },
    color: "#8e4ec6",
    emoji: "🦉",
  },
};

export const MODERATOR = {
  id: "moderator" as const,
  name: "Moderator",
  role: "Moderator",
  voice: { gender: "female", rate: 0.88, pitch: 1.0 } satisfies VoiceProfile,
  color: "#6f6e77",
  emoji: "🎙️",
};

export const USER_COLOR = "#0090ff";

export type Cast = Record<PersonaId, Persona>;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/**
 * The five participants for a GD with this candidate. If the candidate shares a
 * first name with a persona, that persona uses its alternate name.
 * Deterministic: the browser and the server compute the same cast.
 */
export function castFor(userName: string): Cast {
  const taken = firstName(userName);
  const cast = {} as Cast;
  for (const id of Object.keys(BASE) as PersonaId[]) {
    const { names, ...rest } = BASE[id];
    const name = names[0].toLowerCase() === taken ? names[1] : names[0];
    cast[id] = { ...rest, name };
  }
  return cast;
}

export function speakerName(speaker: SpeakerId, cast: Cast, userName: string): string {
  if (speaker === "user") return userName;
  if (speaker === "moderator") return MODERATOR.name;
  return cast[speaker].name;
}

export function speakerColor(speaker: SpeakerId, cast: Cast): string {
  if (speaker === "user") return USER_COLOR;
  if (speaker === "moderator") return MODERATOR.color;
  return cast[speaker].color;
}

/** Fill `{user}` placeholders in a persona brief. */
export function briefFor(persona: Persona, userName: string): string {
  return persona.brief.replaceAll("{user}", userName);
}
