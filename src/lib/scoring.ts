import { z } from "zod";
import type { GDRecord, PersonaId } from "./types";

// ---------- Deterministic metrics (computed from the transcript, no AI) ----------

export interface FillerCount {
  word: string;
  count: number;
}

export interface GDMetrics {
  inputMode: "voice" | "text";
  /** The candidate's first discussion contribution came before any AI participant's. */
  openedDiscussion: boolean;
  /** Seconds from the start of the discussion to the candidate's first entry; null if never. */
  firstEntrySec: number | null;
  /** Number of times the candidate took the floor in the discussion (continuations excluded). */
  entries: number;
  /** Times the candidate entered by cutting off a speaking AI. */
  cutIns: number;
  /** Candidate speaking time in the discussion phase (seconds). */
  userAirtimeSec: number;
  /** Speaking time of everyone except the moderator in the discussion phase (seconds). */
  totalAirtimeSec: number;
  /** userAirtimeSec / totalAirtimeSec, 0..1. */
  airtimeShare: number;
  /** Speaking seconds per participant in the discussion phase (for the airtime chart). */
  airtimeBySpeaker: Partial<Record<PersonaId | "user", number>>;
  /** Longest stretch (seconds) in the discussion without the candidate speaking. */
  longestSilenceSec: number;
  /** Words the candidate spoke (discussion + summary). */
  userWords: number;
  /** Words per minute while speaking; null in text mode or with < 20 s of speech. */
  wordsPerMinute: number | null;
  fillers: FillerCount[];
  fillerTotal: number;
  /** Fillers per 100 words. */
  fillersPer100: number;
  /** AI interjections while the candidate held the floor. */
  interruptionsFaced: number;
  interruptionsHeld: number;
  interruptionsYielded: number;
  /** The candidate named another participant (e.g. "as Meera said"). */
  referencesToOthers: number;
  summaryGiven: boolean;
  summaryWords: number;
  /** Turns by the drifter, so the UI can show "pulled back n of m". */
  driftTurns: number;
}

/** Signature implemented in src/lib/metrics.ts. */
export type ComputeMetrics = (record: GDRecord) => GDMetrics;

// ---------- AI assessment (structured output from Claude) ----------

const Rating = z
  .number()
  .int()
  .describe("Integer rating from 0 (very poor) to 10 (excellent).");

const Section = z.object({
  rating: Rating,
  comment: z
    .string()
    .describe("2-3 specific sentences addressed to the candidate as 'you', quoting their words where useful."),
});

export const AssessmentSchema = z.object({
  overall: z.object({
    score: z.number().int().describe("Overall GD score from 0 to 100."),
    headline: z.string().describe("A 4-8 word verdict, e.g. 'Strong ideas, late entry'."),
    verdict: z.string().describe("3-4 sentence overall assessment addressed to the candidate."),
  }),
  opening: Section.describe("Whether and how well the candidate opened the discussion."),
  participation: Section.describe("Number of entries, timing and share of airtime versus a fair share of about 1/6."),
  content: Section.extend({
    newPoints: z.array(z.string()).describe("Distinct new points the candidate contributed, each paraphrased in under 15 words."),
    repeatedPoints: z.array(z.string()).describe("Points the candidate repeated from earlier speakers or from themselves."),
  }),
  evidence: Section.extend({
    examples: z.array(z.string()).describe("Examples, data or cases the candidate used, each in under 15 words."),
    references: z.array(z.string()).describe("Times the candidate built on or referred to what others said, each in under 15 words."),
  }),
  interruptions: Section.describe("How the candidate handled being interrupted and how they cut in on others."),
  drift: Section.extend({
    pulledBack: z
      .boolean()
      .nullable()
      .describe("Did the candidate pull the discussion back after the drifter went off-topic? null if there was no chance to."),
  }),
  summary: Section.describe("Quality of the candidate's closing summary: balance, coverage, conclusion, brevity."),
  delivery: Section.describe("Filler words, speaking pace and clarity, using the measured metrics."),
  strengths: z.array(z.string()).describe("Up to 3 specific strengths."),
  improvements: z.array(z.string()).describe("Up to 3 specific, actionable improvements for the next GD."),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

export const ASSESSMENT_SECTIONS = [
  "opening",
  "participation",
  "content",
  "evidence",
  "interruptions",
  "drift",
  "summary",
  "delivery",
] as const;

export type AssessmentSection = (typeof ASSESSMENT_SECTIONS)[number];

export const SECTION_LABELS: Record<AssessmentSection, string> = {
  opening: "Opening the discussion",
  participation: "Entries & airtime",
  content: "New points vs repetition",
  evidence: "Examples, data & building on others",
  interruptions: "Handling interruptions",
  drift: "Pulling back the drift",
  summary: "Closing summary",
  delivery: "Fillers & pace",
};

// ---------- /api/score contract ----------

export interface ScoreRequest {
  token: string;
  record: GDRecord;
}

export interface ScoreResponse {
  metrics: GDMetrics;
  assessment: Assessment;
}

/** Everything the scorecard screen renders. */
export interface Scorecard extends ScoreResponse {
  record: GDRecord;
}
