// Browser speech for GD Arena: voices for the AI participants, speech-to-text for the
// candidate and a live mic level. Every export is safe to import during server rendering.

export type {
  Listener,
  ListenerCallbacks,
  ListenerErrorKind,
  MicMeter,
  SpeechHandle,
  Voice,
} from "./types";

export {
  createVoice,
  estimateDurationMs,
  isSpeechSynthesisSupported,
  panelAccent,
  pickVoices,
  prosodyFor,
  SENTENCE_PAUSE_MS,
  splitSentences,
  voiceGender,
  VOICE_SPEED_SCALE,
} from "./tts";
export type { Accent, PanelAccent, Prosody, TextChunk, VoiceInfo, VoiceOptions } from "./tts";
export { integerToWords, speechText } from "./spoken";

export { createListener, isRecognitionSupported } from "./stt";

export { createMicMeter, levelFromRms, requestMicPermission, smoothLevel } from "./mic";
export type { MicPermission } from "./mic";
