import type { VoiceSpeed } from "@/lib/types";
import type { SegmentOption } from "@/components/ui/SegmentedControl";

/** Discussion lengths offered on the setup screen (minutes). */
export const DURATION_OPTIONS: readonly SegmentOption<number>[] = [
  { value: 5, label: "5 min", description: "Quick round" },
  { value: 10, label: "10 min", description: "Standard" },
  { value: 12, label: "12 min", description: "Full length" },
];
export const DEFAULT_MINUTES = 10;

/** Speech-recognition accents (BCP-47 tags passed to SpeechRecognition.lang). */
export const ACCENT_OPTIONS = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
] as const;
export const DEFAULT_ACCENT = "en-IN";

/** How fast the AI panel speaks. */
export const VOICE_SPEED_OPTIONS: readonly SegmentOption<VoiceSpeed>[] = [
  { value: "relaxed", label: "Relaxed", description: "Slower" },
  { value: "natural", label: "Natural", description: "Recommended" },
  { value: "brisk", label: "Brisk", description: "Faster" },
];
export const DEFAULT_VOICE_SPEED: VoiceSpeed = "natural";

export function isKnownVoiceSpeed(value: string | null | undefined): value is VoiceSpeed {
  return VOICE_SPEED_OPTIONS.some((option) => option.value === value);
}

export function isKnownAccent(value: string | null | undefined): value is string {
  return ACCENT_OPTIONS.some((option) => option.value === value);
}

export function isKnownDuration(value: number | null | undefined): value is number {
  return DURATION_OPTIONS.some((option) => option.value === value);
}

export function accentLabel(value: string): string {
  return ACCENT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** localStorage keys for remembered preferences. */
export const STORAGE_KEYS = {
  name: "gd-arena:name",
  accent: "gd-arena:accent",
  voiceSpeed: "gd-arena:voice-speed",
} as const;

/** Server-side limit for the candidate's name (see validate.ts). */
export const MAX_NAME_LENGTH = 40;
/** Custom topics are trimmed to this length by customTopic(). */
export const MAX_CUSTOM_TOPIC_LENGTH = 160;
export const MIN_CUSTOM_TOPIC_LENGTH = 3;
